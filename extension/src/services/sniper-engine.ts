/**
 * Seat Drop Sniper Engine
 *
 * Background orchestration engine that monitors target dates, handles
 * high-frequency automated page & inventory rechecking, detects newly opened
 * seat drops, and instantly reserves optimal continuous blocks.
 */

import { adapterRegistry } from '../adapters/base-adapter';
import { StarCineplexAdapter } from '../adapters/star-cineplex/adapter';
import {
  detectSeatBlocks,
  filterBlocksByRequirement,
  selectOptimalSeats,
  fulfillRequiredSeats,
  createCompositeSeatBlock,
} from '../algorithms/seat-block/index';
import { rankResults, DEFAULT_WEIGHTS } from '../algorithms/ranking/scorer';
import { Showtime, matchesLocation } from '../types/cinema';
import { SeatBlock, Seat } from '../types/seat';
import {
  SniperConfig,
  SniperState,
  SniperLogEntry,
  SniperCheckResult,
  RankedResult,
} from '../types/sniper';
import { playSuccessChime } from '../utils/audio';
import { showDesktopNotification } from '../utils/notifications';
import { normalizeToIsoDate, formatDateDisplay, getTimeSlot, DEFAULT_ALLOWED_ROWS, isRowAllowed } from '../utils/date';

export class SniperEngine {
  private state: SniperState = {
    config: null,
    status: 'idle',
    refreshCount: 0,
    lastCheckTime: 0,
    logs: [],
  };

  private timerId: any = null;
  private isChecking = false;
  private stateListeners: Array<(state: SniperState) => void> = [];

  constructor() {
    this.restoreFromStorage().catch(err => {
      console.warn('[SniperEngine] Storage restore failed:', err);
    });
  }

  /**
   * Register a state change listener
   */
  public onStateChange(listener: (state: SniperState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  private notifyStateChange(): void {
    const cloned = this.getState();
    this.stateListeners.forEach(listener => {
      try {
        listener(cloned);
      } catch (err) {
        console.error('[SniperEngine] Listener error:', err);
      }
    });
    this.saveToStorage().catch(() => {});
  }

  public getState(): SniperState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Start or arm the sniper with the given configuration
   */
  public async start(config: SniperConfig): Promise<SniperState> {
    this.stop('Restarting with new configuration');

    // Normalize target date to ISO string (YYYY-MM-DD)
    const normalizedTargetDate = normalizeToIsoDate(config.targetDate);

    this.state = {
      config: {
        ...config,
        targetDate: normalizedTargetDate,
        active: true,
        createdAt: Date.now(),
      },
      status: config.dropTime && new Date(config.dropTime).getTime() > Date.now()
        ? 'waiting_schedule'
        : 'refreshing',
      refreshCount: 0,
      lastCheckTime: 0,
      nextCheckTime: Date.now() + config.intervalSeconds * 1000,
      logs: [],
      bookedSeats: undefined,
      bookingUrl: undefined,
      result: undefined,
      errorMessage: undefined,
    };

    const targetFormatted = formatDateDisplay(normalizedTargetDate);
    this.addLog(
      `🎯 Sniper armed for "${config.movieName}" on ${targetFormatted} (${normalizedTargetDate}). Required: ${config.requiredSeats} seats. Polling every ${config.intervalSeconds}s.`,
      'info'
    );

    // If scheduled drop time is provided
    if (config.dropTime && new Date(config.dropTime).getTime() > Date.now()) {
      const dropDate = new Date(config.dropTime);
      this.addLog(
        `⏳ Scheduled drop time set for ${dropDate.toLocaleTimeString()} on ${dropDate.toLocaleDateString()}. Waiting for countdown...`,
        'info'
      );
    }

    // Auto-open or locate cinema tab if requested
    if (config.autoOpenTab && typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        const tabs = await chrome.tabs.query({ url: ['*://*.starcineplex.com/*', '*://*.kichole.com/*'] });
        if (tabs.length > 0 && tabs[0].id) {
          this.state.targetTabId = tabs[0].id;
          this.addLog(`Attached to active cinema tab #${tabs[0].id}.`, 'info');
        } else {
          const newTab = await chrome.tabs.create({
            url: 'https://starcineplex.com',
            active: false,
          });
          if (newTab.id) {
            this.state.targetTabId = newTab.id;
            this.addLog(`Opened cinema monitor tab #${newTab.id}.`, 'info');
          }
        }
      } catch (err) {
        console.warn('[SniperEngine] Could not attach/open tab:', err);
      }
    }

    this.notifyStateChange();
    this.scheduleNextTick(100); // Trigger first check almost immediately

    return this.getState();
  }

  /**
   * Disarm / stop the sniper
   */
  public stop(reason = 'User stopped sniper'): SniperState {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.state.config) {
      this.state.config.active = false;
    }

    if (this.state.status !== 'booked') {
      this.state.status = 'stopped';
    }

    this.addLog(`🛑 ${reason}`, 'warning');
    this.notifyStateChange();

    return this.getState();
  }

  /**
   * Schedule the next execution tick
   */
  private scheduleNextTick(delayMs?: number): void {
    if (!this.state.config?.active) return;

    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    const intervalMs = delayMs !== undefined
      ? delayMs
      : Math.max(1000, (this.state.config.intervalSeconds || 2.5) * 1000);

    this.state.nextCheckTime = Date.now() + intervalMs;

    this.timerId = setTimeout(async () => {
      await this.tick();
    }, intervalMs);
  }

  /**
   * Periodic tick execution
   */
  public async tick(): Promise<void> {
    if (!this.state.config?.active || this.isChecking) return;

    // Check if waiting for scheduled drop time
    if (this.state.config.dropTime) {
      const dropMs = new Date(this.state.config.dropTime).getTime();
      const now = Date.now();
      if (now < dropMs) {
        this.state.status = 'waiting_schedule';
        const remainingSec = Math.ceil((dropMs - now) / 1000);
        if (this.state.refreshCount % 10 === 0) {
          this.addLog(`⏳ Countdown to drop: ${remainingSec}s remaining. Will auto-refresh when seats open.`, 'info');
        }
        this.state.refreshCount++;
        this.scheduleNextTick(1000);
        return;
      } else if (this.state.status === 'waiting_schedule') {
        this.state.status = 'refreshing';
        this.addLog('⚡ Drop time reached! Actively refreshing and scanning for newly opened seats...', 'info');
      }
    }

    this.state.status = 'refreshing';
    this.isChecking = true;
    this.state.refreshCount++;
    this.state.lastCheckTime = Date.now();

    try {
      // 1. Auto-refresh page in connected tab if configured
      if (this.state.config.autoRefreshPage && this.state.targetTabId && typeof chrome !== 'undefined' && chrome.tabs) {
        try {
          chrome.tabs.reload(this.state.targetTabId, { bypassCache: true }).catch(() => {});
        } catch {}
      }

      // 2. Perform live check for target date shows
      const result = await this.performCheck();

      if (result.found && result.showtime && result.seatBlock) {
        // Target date seats found!
        await this.handleSeatFound(result);
        return;
      } else {
        const count = this.state.refreshCount;
        const targetDate = this.state.config.targetDate;
        this.addLog(
          `[Check #${count}] Target date ${targetDate} not yet opened. Auto-rechecking in ${this.state.config.intervalSeconds}s...`,
          'info'
        );
      }
    } catch (err) {
      console.error('[SniperEngine] Tick error:', err);
      this.addLog(`Error during check #${this.state.refreshCount}: ${(err as Error).message}`, 'error');
    } finally {
      this.isChecking = false;
      if (this.state.config?.active && this.state.status === 'refreshing') {
        this.notifyStateChange();
        this.scheduleNextTick();
      }
    }
  }

  /**
   * Immediate manual check triggered by user
   */
  public async checkNow(): Promise<SniperCheckResult> {
    if (!this.state.config) {
      return { found: false, error: 'No active sniper configuration' };
    }
    return this.performCheck();
  }

  /**
   * Search adapter catalog and shows for the target date
   */
  public async performCheck(): Promise<SniperCheckResult> {
    const config = this.state.config;
    if (!config) return { found: false };

    const targetDate = config.targetDate;
    const movieQuery = config.movieName.trim();
    const requiredSeats = config.requiredSeats;

    // Retrieve active cinema adapters
    const adapters = adapterRegistry.getEnabled();
    const starAdapter = adapters.find(a => a.id === 'star-cineplex') || adapters[0];
    if (!starAdapter) {
      return { found: false, error: 'No cinema adapter available' };
    }

    // Step 1: Find matching movie
    const movies = await starAdapter.searchMovies(movieQuery);
    if (!movies || movies.length === 0) {
      return { found: false, error: `Movie "${movieQuery}" not found in cinema catalog.` };
    }

    const targetMovie = movies[0];

    // Step 2: Fetch showtimes
    const showtimes = await starAdapter.getShowtimes(targetMovie);
    if (!showtimes || showtimes.length === 0) {
      return { found: false };
    }

    // Step 3: Filter for showtimes matching the target date
    const dateMatches = showtimes.filter(s => {
      if (s.date !== targetDate) return false;
      if (s.availableSeats < requiredSeats) return false;

      // Filter by multiple preferred time slots (e.g. afternoon, evening)
      if (config.preferredTimes && config.preferredTimes.length > 0) {
        const slot = getTimeSlot(s.time);
        if (!config.preferredTimes.includes(slot)) return false;
      } else if (config.preferredTime && config.preferredTime !== 'any') {
        // Fallback for single preferred time
        const slot = getTimeSlot(s.time);
        if (slot !== config.preferredTime) return false;
      }

      // Filter by preferred cinema branch or locations if set
      if (config.preferredLocationIds && config.preferredLocationIds.length > 0) {
        if (!matchesLocation(s, config.preferredLocationIds)) return false;
      } else if (config.preferredCinemaId && s.cinema.id !== config.preferredCinemaId) {
        return false;
      }

      return true;
    });

    if (dateMatches.length === 0) {
      return { found: false };
    }

    // Sort shows by time
    dateMatches.sort((a, b) => a.time.localeCompare(b.time));

    // Step 4: Inspect seat maps for candidate shows to locate maximal continuous block
    for (const show of dateMatches) {
      try {
        const seatMap = await starAdapter.getSeatMap(show);

        // Filter rows: default to B, C, D, E, F rows (excludes backrows like L, N)
        const allowedRows = config.allowedRows && config.allowedRows.length > 0
          ? config.allowedRows
          : (config.preferredRow && config.preferredRow !== 'any' && config.preferredRow !== 'center'
              ? undefined
              : DEFAULT_ALLOWED_ROWS);

        const allBlocksInMap = detectSeatBlocks(seatMap, {
          requiredSeats,
        });
        const blocksInAllowedRows = allBlocksInMap.filter(b => isRowAllowed(b.row, allowedRows));

        let eligibleBlocks = filterBlocksByRequirement(blocksInAllowedRows, requiredSeats);
        if (eligibleBlocks.length === 0) {
          eligibleBlocks = filterBlocksByRequirement(allBlocksInMap, requiredSeats);
        }

        // Apply seat category preference if set
        if (config.preferredCategory && config.preferredCategory !== 'any') {
          const catBlocks = eligibleBlocks.filter(b =>
            b.seats.some(s => s.category === config.preferredCategory)
          );
          if (catBlocks.length > 0) {
            eligibleBlocks = catBlocks;
          }
        }

        // Apply row preference if set
        if (config.preferredRow && config.preferredRow !== 'any') {
          if (config.preferredRow === 'back') {
            eligibleBlocks.sort((a, b) => b.row.localeCompare(a.row));
          } else if (config.preferredRow === 'front') {
            eligibleBlocks.sort((a, b) => a.row.localeCompare(b.row));
          } else if (config.preferredRow === 'center') {
            eligibleBlocks.sort((a, b) => b.centerScore - a.centerScore);
          }
        }

        if (eligibleBlocks.length > 0) {
          const bestBlock = eligibleBlocks[0];
          const optimalSeats = selectOptimalSeats(bestBlock, requiredSeats);

          return {
            found: true,
            showtime: show,
            seatBlock: bestBlock,
            selectedSeats: optimalSeats,
            seatLabels: optimalSeats.map(s => s.label),
            bookingUrl: show.bookingUrl,
          };
        } else if (allBlocksInMap.length > 0) {
          const optimalSeats = fulfillRequiredSeats(allBlocksInMap, requiredSeats, allowedRows);
          if (optimalSeats.length > 0) {
            const composite = createCompositeSeatBlock(optimalSeats, requiredSeats);
            return {
              found: true,
              showtime: show,
              seatBlock: composite,
              selectedSeats: optimalSeats,
              seatLabels: optimalSeats.map(s => s.label),
              bookingUrl: show.bookingUrl,
            };
          }
        }
      } catch (seatErr) {
        console.warn('[SniperEngine] Seat map fetch failure for show:', show.id, seatErr);
      }
    }

    return { found: false };
  }

  /**
   * Action when newly opened seats for the target date are secured
   */
  private async handleSeatFound(result: SniperCheckResult): Promise<void> {
    const { showtime, seatBlock, selectedSeats, seatLabels, bookingUrl } = result;
    if (!showtime || !seatBlock || !selectedSeats || !seatLabels) return;

    this.state.status = 'seats_found';
    this.addLog(`🎉 SUCCESS! Newly opened seats found for ${showtime.date} at ${showtime.time}!`, 'success');
    this.addLog(
      `💺 Locking continuous seats: Row ${seatBlock.row} • ${seatLabels.join(', ')} at ${showtime.cinema.name} (${showtime.hall.name})`,
      'success'
    );

    // Build RankedResult
    const ranked: RankedResult = {
      showtime,
      seatBlock,
      overallScore: 1.0,
      reasoning: `🎯 Target Date Drop Captured! Row ${seatBlock.row} (${seatLabels.join(', ')})`,
    };

    this.state.result = ranked;
    this.state.bookedSeats = seatLabels;
    this.state.bookingUrl = bookingUrl;

    // Disarm continuous refreshing
    if (this.state.config) {
      this.state.config.active = false;
    }
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    // Save pending reservation for content script pickup
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const stored = await chrome.storage.local.get(['pendingReservations', 'pendingReservation']);
        const pendingMap = stored?.pendingReservations || {};
        pendingMap[showtime.id] = {
          showId: showtime.id,
          seatLabels,
          requiredSeats: this.state.config?.requiredSeats || seatLabels.length,
          allowedRows: this.state.config?.allowedRows || DEFAULT_ALLOWED_ROWS,
          autoProceed: true,
          timestamp: Date.now(),
        };
        await chrome.storage.local.set({
          pendingReservations: pendingMap,
          pendingReservation: {
            showId: showtime.id,
            seatLabels,
            requiredSeats: this.state.config?.requiredSeats || seatLabels.length,
            allowedRows: this.state.config?.allowedRows || DEFAULT_ALLOWED_ROWS,
            autoProceed: true,
            timestamp: Date.now(),
          },
        });
      } catch (err) {
        console.warn('[SniperEngine] Storage save error:', err);
      }
    }

    // Play victory audio alert chime
    playSuccessChime();

    // Trigger desktop notification
    showDesktopNotification(
      '🎉 Seats Captured on Target Date!',
      `Secured seats ${seatLabels.join(', ')} for ${showtime.movie.title} on ${showtime.date} at ${showtime.time}!`
    );

    // Open or focus the booking window
    if (bookingUrl && typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        let tab: chrome.tabs.Tab;
        if (this.state.targetTabId) {
          tab = await chrome.tabs.update(this.state.targetTabId, {
            url: bookingUrl,
            active: true,
          });
        } else {
          tab = await chrome.tabs.create({ url: bookingUrl, active: true });
          this.state.targetTabId = tab.id;
        }

        const tabId = tab.id;
        if (tabId) {
          // Listen for tab load completion to trigger content script seat selection
          const onUpdatedListener = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
            if (updatedId === tabId && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onUpdatedListener);
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, {
                  type: 'SELECT_AND_RESERVE',
                  payload: {
                    seatLabels,
                    requiredSeats: this.state.config?.requiredSeats || seatLabels.length,
                    allowedRows: this.state.config?.allowedRows || DEFAULT_ALLOWED_ROWS,
                    autoProceed: true,
                  },
                }).catch(() => {});
              }, 1000);
            }
          };
          chrome.tabs.onUpdated.addListener(onUpdatedListener);
        }
      } catch (tabErr) {
        console.warn('[SniperEngine] Tab navigation error:', tabErr);
      }
    }

    this.state.status = 'booked';
    this.addLog(`✅ Seats reserved & navigated to checkout. Complete payment on screen.`, 'success');
    this.notifyStateChange();
  }

  /**
   * Append an activity log entry
   */
  public addLog(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    const entry: SniperLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      message,
      type,
    };
    this.state.logs = [entry, ...this.state.logs.slice(0, 49)]; // Keep latest 50 logs
    this.notifyStateChange();
  }

  /**
   * Restore state from chrome.storage.local
   */
  public async restoreFromStorage(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    try {
      const data = await chrome.storage.local.get('sniperState');
      if (data?.sniperState) {
        const saved: SniperState = data.sniperState;
        this.state = saved;

        // If it was actively running when service worker died, resume loop
        if (saved.config?.active && (saved.status === 'refreshing' || saved.status === 'waiting_schedule')) {
          this.addLog('Resuming active seat sniper loop...', 'info');
          this.scheduleNextTick(1500);
        }
      }
    } catch (err) {
      console.warn('[SniperEngine] Restore error:', err);
    }
  }

  /**
   * Persist state to chrome.storage.local
   */
  public async saveToStorage(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    try {
      await chrome.storage.local.set({ sniperState: this.state });
    } catch (err) {
      console.warn('[SniperEngine] Save error:', err);
    }
  }
}
