/**
 * Background Service Worker
 *
 * Orchestrates cross-cinema discovery, maximal seat block ranking,
 * real-time availability rechecking, and automated booking reservation.
 */

import { adapterRegistry } from '../adapters/base-adapter';
import { StarCineplexAdapter } from '../adapters/star-cineplex/adapter';
import { DemoAdapter } from '../adapters/demo/adapter';
import {
  detectSeatBlocks,
  filterBlocksByRequirement,
  selectOptimalSeats,
  fulfillRequiredSeats,
} from '../algorithms/seat-block/index';
import { rankResults, RankingCriteria, RankingWeights } from '../algorithms/ranking/scorer';
import { Showtime, matchesLocation, getShowtimeLocationId, STAR_CINEPLEX_LOCATIONS } from '../types/cinema';
import { Seat, SeatBlock, SeatMap } from '../types/seat';
import { SniperEngine } from '../services/sniper-engine';
import { SniperConfig } from '../types/sniper';
import { getTimeSlot, DEFAULT_ALLOWED_ROWS } from '../utils/date';

export interface DiscoveryRequest {
  movieName: string;
  requiredSeats: number;
  criteria?: RankingCriteria;
  weights?: RankingWeights;
}

export interface DiscoveryResponse {
  results: RankedResult[];
  errors: Array<{ cinemaId: string; error: string }>;
  duration: number;
}

export interface RankedResult {
  showtime: Showtime;
  seatBlock: SeatBlock;
  overallScore: number;
  reasoning: string;
}

export interface ReserveRequest {
  showtime: Showtime;
  seatBlock: SeatBlock;
  requiredSeats: number;
  candidateBlocks?: SeatBlock[];
  allowedRows?: string[];
  openTabActive?: boolean;
}

export interface ReserveResponse {
  success: boolean;
  error?: string;
  optimalSeats: Seat[];
  seatLabels: string[];
  bookingUrl: string;
  tabId?: number;
}

// Register cinema adapters
// Star Cineplex is primary with live catalog/inventory API
const starAdapter = new StarCineplexAdapter();
starAdapter.config.priority = 10;
adapterRegistry.register(starAdapter);

// Demo adapter available as fallback for offline testing
const demoAdapter = new DemoAdapter();
demoAdapter.config.priority = 1;
adapterRegistry.register(demoAdapter);

// Initialize background seat sniper engine
const sniperEngine = new SniperEngine();

/**
 * Main discovery orchestration
 */
async function runDiscovery(request: DiscoveryRequest): Promise<DiscoveryResponse> {
  const startTime = Date.now();
  const results: RankedResult[] = [];
  const errors: Array<{ cinemaId: string; error: string }> = [];

  const adapters = adapterRegistry.getEnabled();

  // Step 1: Search for movies across all adapters concurrently
  const searchPromises = adapters.map(async adapter => {
    try {
      const movies = await adapter.searchMovies(request.movieName);
      return { adapterId: adapter.id, movies };
    } catch (e) {
      errors.push({ cinemaId: adapter.id, error: `Search failed: ${(e as Error).message}` });
      return { adapterId: adapter.id, movies: [] };
    }
  });

  const searchResults = await Promise.all(searchPromises);

  // Step 2: Get showtimes for found movies concurrently
  const showtimePromises = searchResults.flatMap(({ adapterId, movies }) => {
    if (movies.length === 0) {
      errors.push({
        cinemaId: adapterId,
        error: `No showtimes found for "${request.movieName}"`,
      });
      return [];
    }

    const adapter = adapterRegistry.get(adapterId)!;
    return movies.map(movie =>
      adapter.getShowtimes(movie).catch((e: Error) => {
        errors.push({ cinemaId: adapterId, error: `Showtime fetch failed: ${e.message}` });
        return [] as Showtime[];
      })
    );
  });

  const allShowtimes = (await Promise.all(showtimePromises)).flat();

  // If Star Cineplex has matching showtimes, prioritize live cinema results
  const starShowtimes = allShowtimes.filter(s => s.cinema.id === starAdapter.id);
  let targetShowtimes = starShowtimes.length > 0 ? starShowtimes : allShowtimes;

  // Filter for showtimes that match preferred multiple locations (e.g. Bashundhara City, Sony Square)
  if (request.criteria?.preferredLocationIds && request.criteria.preferredLocationIds.length > 0) {
    const locMatches = targetShowtimes.filter(s =>
      matchesLocation(s, request.criteria!.preferredLocationIds)
    );
    if (locMatches.length > 0) {
      targetShowtimes = locMatches;
    }
  }

  // Filter for showtimes that match preferred multiple time slots (e.g. afternoon, evening)
  if (request.criteria?.preferredTimes && request.criteria.preferredTimes.length > 0) {
    const timeMatches = targetShowtimes.filter(s =>
      request.criteria!.preferredTimes!.includes(getTimeSlot(s.time))
    );
    if (timeMatches.length > 0) {
      targetShowtimes = timeMatches;
    }
  } else if (request.criteria?.preferredTime && request.criteria.preferredTime !== 'any') {
    const timeMatches = targetShowtimes.filter(s =>
      getTimeSlot(s.time) === request.criteria!.preferredTime
    );
    if (timeMatches.length > 0) {
      targetShowtimes = timeMatches;
    }
  }

  // Filter for showtimes that have at least the required seats available
  const availableShowtimes = targetShowtimes.filter(s => s.availableSeats >= request.requiredSeats);
  const eligibleShowtimes = availableShowtimes.length > 0 ? availableShowtimes : targetShowtimes;

  // Sort by date, then time, and take top 25 candidate shows for fast seat-map discovery
  const sortedShowtimes = eligibleShowtimes
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .slice(0, 25);

  // Step 3: Fetch physical seat maps for each candidate showtime concurrently
  const seatMapPromises = sortedShowtimes.map(showtime => {
    const adapter = adapterRegistry.get(showtime.cinema.id) || adapterRegistry.findForUrl(showtime.bookingUrl) || starAdapter;
    return adapter
      .getSeatMap(showtime)
      .then(seatMap => ({ showtime, seatMap }))
      .catch((e: Error) => {
        errors.push({ cinemaId: showtime.cinema.id, error: `Seat map failed: ${e.message}` });
        return null;
      });
  });

  const seatMapResults = (await Promise.all(seatMapPromises)).filter(Boolean) as Array<{
    showtime: Showtime;
    seatMap: SeatMap;
  }>;

  // Allowed rows: default strictly to B, C, D, E, F rows (excludes front row A and back rows L, N, etc.)
  const allowedRows = request.criteria?.allowedRows && request.criteria.allowedRows.length > 0
    ? request.criteria.allowedRows
    : DEFAULT_ALLOWED_ROWS;

  // Step 4 & 5: Detect maximal continuous blocks and filter by requirement
  // Zero overlapping combinations: each maximal block is presented once
  const eligible = seatMapResults.flatMap(({ showtime, seatMap }) => {
    const blocks = detectSeatBlocks(seatMap, {
      requiredSeats: request.requiredSeats,
      allowedRows,
    });
    let eligibleBlocks = filterBlocksByRequirement(blocks, request.requiredSeats);

    // If no single continuous block has requiredSeats, but available seats exist in allowed rows
    if (eligibleBlocks.length === 0 && blocks.length > 0) {
      const fulfilled = fulfillRequiredSeats(blocks, request.requiredSeats, allowedRows);
      if (fulfilled.length >= Math.min(request.requiredSeats, showtime.availableSeats)) {
        eligibleBlocks = [blocks[0]];
      }
    }

    return eligibleBlocks.map(block => ({ showtime, seatBlock: block }));
  });

  // Step 6: Rank results by multi-factor weighted scoring
  const ranked = rankResults(eligible, request.weights, request.criteria);
  results.push(...ranked);

  return {
    results,
    errors,
    duration: Date.now() - startTime,
  };
}

/**
 * Handle re-checking real-time availability and automating seat reservation
 */
async function handleRecheckAndReserve(req: ReserveRequest): Promise<ReserveResponse> {
  const { showtime, seatBlock, requiredSeats } = req;

  // 1. Re-check real-time availability with the cinema adapter
  if (
    showtime.cinema.id === starAdapter.id ||
    showtime.bookingUrl?.includes('kichole.com') ||
    showtime.bookingUrl?.includes('starcineplex.com')
  ) {
    const check = await starAdapter.recheckAvailability(showtime.id, requiredSeats);
    if (!check.available) {
      return {
        success: false,
        error: `Seats in this show are no longer available (only ${check.remainingSeats} remaining). Please choose another showtime.`,
        optimalSeats: [],
        seatLabels: [],
        bookingUrl: showtime.bookingUrl,
      };
    }
  }

  // 2. Select the optimal seats (strictly fulfilling requiredSeats)
  const candidateBlocks = req.candidateBlocks && req.candidateBlocks.length > 0
    ? req.candidateBlocks
    : [seatBlock];
  const optimalSeats = fulfillRequiredSeats(
    candidateBlocks,
    requiredSeats,
    req.allowedRows || DEFAULT_ALLOWED_ROWS
  );
  const seatLabels = optimalSeats.map(s => s.label);

  // 3. Save pending reservation into local storage for guaranteed pickup by content script
  try {
    const stored = await chrome.storage.local.get(['pendingReservations', 'pendingReservation']);
    const pendingMap = stored?.pendingReservations || {};
    pendingMap[showtime.id] = {
      showId: showtime.id,
      seatLabels,
      requiredSeats,
      allowedRows: req.allowedRows || DEFAULT_ALLOWED_ROWS,
      autoProceed: true,
      timestamp: Date.now(),
    };
    await chrome.storage.local.set({
      pendingReservations: pendingMap,
      pendingReservation: {
        showId: showtime.id,
        seatLabels,
        requiredSeats,
        allowedRows: req.allowedRows || DEFAULT_ALLOWED_ROWS,
        autoProceed: true,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    console.warn('[Movie Assistant] Could not store pending reservation:', err);
  }

  // 4. Open cinema booking tab
  let tabId: number | undefined;
  if (showtime.bookingUrl) {
    try {
      const shouldActivate = req.openTabActive !== false;
      const tab = await chrome.tabs.create({ url: showtime.bookingUrl, active: shouldActivate });
      tabId = tab.id;

      // When the tab finishes loading, trigger the content script to select seats
      if (tabId) {
        chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            // Brief pause for client hydration
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId!, {
                type: 'SELECT_AND_RESERVE',
                payload: {
                  seatLabels,
                  requiredSeats,
                  allowedRows: req.allowedRows || DEFAULT_ALLOWED_ROWS,
                  autoProceed: true,
                },
              }).catch(err => {
                console.log('[Movie Assistant] Content script ping queued:', err);
              });
            }, 1200);
          }
        });
      }
    } catch (tabErr) {
      console.warn('[Movie Assistant] Could not open booking tab:', tabErr);
    }
  }

  return {
    success: true,
    optimalSeats,
    seatLabels,
    bookingUrl: showtime.bookingUrl,
    tabId,
  };
}

let currentDiscoveryId = 0;
let activePopoutWindowId: number | null = null;

/**
 * Perform end-to-end background discovery and auto-reservation so execution
 * completes reliably even if the user closes or clicks outside the popup.
 * Supports multi-location selection by opening separate tabs for each location!
 */
async function handleAutoDiscoverAndReserve(request: DiscoveryRequest): Promise<{
  discovery: DiscoveryResponse;
  reservation?: ReserveResponse;
  reservations?: ReserveResponse[];
  results?: RankedResult[];
}> {
  const opId = ++currentDiscoveryId;
  const discovery = await runDiscovery(request);

  // If a reset was requested while discovery was in flight, abort!
  if (opId !== currentDiscoveryId) {
    return {
      discovery: {
        results: [],
        errors: [{ cinemaId: 'core', error: 'Discovery reset by user' }],
        duration: 0,
      },
    };
  }

  if (discovery.results.length === 0) {
    return { discovery };
  }

  const allowedRows = request.criteria?.allowedRows || DEFAULT_ALLOWED_ROWS;
  const preferredLocationIds = request.criteria?.preferredLocationIds;

  // Group discovery results by cinema location
  const resultsByLocation = new Map<string, RankedResult[]>();
  for (const res of discovery.results) {
    const locId = getShowtimeLocationId(res.showtime);
    const list = resultsByLocation.get(locId) || [];
    list.push(res);
    resultsByLocation.set(locId, list);
  }

  // Determine which results to book:
  // If multiple locations were selected, pick the #1 top show for EACH selected location!
  const targetResults: RankedResult[] = [];

  if (preferredLocationIds && preferredLocationIds.length > 1) {
    for (const locId of preferredLocationIds) {
      const locList = resultsByLocation.get(locId);
      if (locList && locList.length > 0) {
        targetResults.push(locList[0]);
      }
    }
  }

  // Fallback: if no multi-location matches or only 1 location was selected, pick the single top result
  if (targetResults.length === 0) {
    targetResults.push(discovery.results[0]);
  }

  // Open multiple tabs for the selected locations, each reserving the requested seats!
  const reservations: ReserveResponse[] = [];

  for (let i = 0; i < targetResults.length; i++) {
    const res = targetResults[i];
    try {
      const candidateBlocks = discovery.results
        .filter(r => r.showtime.id === res.showtime.id)
        .map(r => r.seatBlock);

      const rsv = await handleRecheckAndReserve({
        showtime: res.showtime,
        seatBlock: res.seatBlock,
        requiredSeats: request.requiredSeats,
        candidateBlocks,
        allowedRows,
        openTabActive: i === 0, // Keep first opened tab in focus
      });
      reservations.push(rsv);
    } catch (reserveErr) {
      console.warn(`[Movie Assistant] Auto-reserve error for ${res.showtime.cinema.name}:`, reserveErr);
    }
  }

  if (opId !== currentDiscoveryId) {
    return {
      discovery,
      reservation: reservations[0],
      reservations,
      results: targetResults,
    };
  }

  const primaryReservation = reservations.find(r => r.success) || reservations[0];
  const primaryResult = targetResults[0];

  try {
    await chrome.storage.local.set({
      lastAutoBooked: {
        result: primaryResult,
        reservation: primaryReservation,
        results: targetResults,
        reservations,
        timestamp: Date.now(),
      },
    });
  } catch (storageErr) {
    console.warn('[Movie Assistant] Storage save error:', storageErr);
  }

  return {
    discovery,
    reservation: primaryReservation,
    reservations,
    results: targetResults,
  };
}

// Runtime message routing
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'AUTO_DISCOVER_AND_RESERVE') {
    handleAutoDiscoverAndReserve(message.request)
      .then(sendResponse)
      .catch(err => {
        sendResponse({
          discovery: {
            results: [],
            errors: [{ cinemaId: 'core', error: err.message }],
            duration: 0,
          },
        });
      });
    return true;
  }

  if (message.type === 'DISCOVER') {
    runDiscovery(message.request)
      .then(sendResponse)
      .catch(e =>
        sendResponse({
          results: [],
          errors: [{ cinemaId: 'core', error: e.message }],
          duration: 0,
        })
      );
    return true;
  }

  if (message.type === 'RECHECK_AND_RESERVE') {
    handleRecheckAndReserve(message.payload)
      .then(sendResponse)
      .catch(err =>
        sendResponse({
          success: false,
          error: err.message,
          optimalSeats: [],
          seatLabels: [],
          bookingUrl: message.payload?.showtime?.bookingUrl || '',
        })
      );
    return true;
  }

  if (message.type === 'GET_SEAT_MAP') {
    const { showtime } = message.payload;
    const adapter = adapterRegistry.get(showtime.cinema.id) || starAdapter;
    adapter
      .getSeatMap(showtime)
      .then(map => {
        // Convert Map to array of entries for JSON serialization
        const rowsArray = Array.from(map.rows.entries());
        sendResponse({ ...map, rows: rowsArray });
      })
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (message.type === 'CHECK_ADAPTERS') {
    const statuses = adapterRegistry.getEnabled().map(adapter => ({
      id: adapter.id,
      name: adapter.name,
      status: adapter.getStatus(),
    }));
    sendResponse({ adapters: statuses });
    return true;
  }

  // Seat Drop Sniper message routing
  if (message.type === 'START_SNIPER') {
    sniperEngine
      .start(message.config)
      .then(state => {
        if (typeof chrome !== 'undefined' && chrome.alarms) {
          chrome.alarms.create('sniper-heartbeat', { periodInMinutes: 0.1 });
        }
        sendResponse({ success: true, state });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'STOP_SNIPER') {
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear('sniper-heartbeat');
    }
    const state = sniperEngine.stop(message.reason);
    sendResponse({ success: true, state });
    return true;
  }

  if (message.type === 'GET_SNIPER_STATE') {
    sendResponse(sniperEngine.getState());
    return true;
  }

  if (message.type === 'SNIPER_CHECK_NOW') {
    sniperEngine
      .checkNow()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ found: false, error: err.message }));
    return true;
  }

  if (message.type === 'SNIPER_HEARTBEAT') {
    const state = sniperEngine.getState();
    if (state.config?.active && state.status === 'refreshing') {
      const elapsed = Date.now() - (state.lastCheckTime || 0);
      const threshold = (state.config.intervalSeconds || 2.5) * 1500;
      if (elapsed > threshold) {
        sniperEngine.tick().catch(() => {});
      }
    }
    sendResponse({ alive: true, state });
    return true;
  }

  if (message.type === 'OPEN_POPOUT_WINDOW') {
    if (typeof chrome !== 'undefined' && chrome.windows) {
      chrome.windows.create(
        {
          url: chrome.runtime.getURL('popup/index.html?window=1'),
          type: 'popup',
          width: 420,
          height: 680,
          focused: true,
        },
        win => {
          if (win?.id) {
            activePopoutWindowId = win.id;
          }
        }
      );
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'POPOUT_CLOSED') {
    activePopoutWindowId = null;
    currentDiscoveryId++;
    sniperEngine.stop('Popout window closed by user');
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear('sniper-heartbeat');
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove(['lastAutoBooked', 'sniperState', 'pendingReservation']).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESET_AND_START_OVER') {
    currentDiscoveryId++;
    const state = sniperEngine.stop('User refreshed and started over');
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear('sniper-heartbeat');
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove(['lastAutoBooked', 'sniperState', 'pendingReservation']).catch(() => {});
    }
    sendResponse({ success: true, state });
    return true;
  }
});

// Window listener to auto-stop tasks when user closes the popout window
if (typeof chrome !== 'undefined' && chrome.windows?.onRemoved) {
  chrome.windows.onRemoved.addListener(closedWindowId => {
    if (closedWindowId === activePopoutWindowId) {
      activePopoutWindowId = null;
      console.log('[Movie Assistant] Popout window closed. Stopping background tasks.');
      currentDiscoveryId++;
      sniperEngine.stop('Popout window closed');
      if (chrome.alarms) {
        chrome.alarms.clear('sniper-heartbeat');
      }
      chrome.storage.local.remove(['lastAutoBooked', 'sniperState', 'pendingReservation']).catch(() => {});
    }
  });
}

// Port listener for background keepalive from content scripts
if (typeof chrome !== 'undefined' && chrome.runtime?.onConnect) {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'sniper-keepalive') {
      port.onDisconnect.addListener(() => {
        // Disconnect handled
      });
    }
  });
}

// Setup alarm listener for background keepalive
if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'sniper-heartbeat') {
      const state = sniperEngine.getState();
      if (state.config?.active) {
        sniperEngine.tick().catch(console.error);
      }
    }
  });
}

console.log('Movie Ticket Assistant service worker loaded.');
console.log(`Registered ${adapterRegistry.listIds().length} cinema adapter(s).`);