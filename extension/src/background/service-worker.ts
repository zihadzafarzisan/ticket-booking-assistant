/**
 * Background Service Worker
 *
 * Orchestrates the discovery and booking flows.
 * This is the extension's entry point and single source of truth.
 */

import { adapterRegistry } from '../adapters/base-adapter';
import { StarCineplexAdapter } from '../adapters/star-cineplex/adapter';
import { DemoAdapter } from '../adapters/demo/adapter';
import { detectSeatBlocks, filterBlocksByRequirement } from '../algorithms/seat-block/index';
import { rankResults, RankingCriteria, RankingWeights } from '../algorithms/ranking/scorer';
import { Movie, Showtime } from '../types/cinema';
import { SeatBlock, SeatMap } from '../types/seat';

// Message type definitions
export interface DiscoveryRequest {
  movieName: string;
  requiredSeats: number;
  criteria: RankingCriteria;
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

// Register adapters.
// Star Cineplex is a scaffold that currently falls back to empty (its live
// site blocks automated access). DemoAdapter yields simulated results so the
// full pipeline is always exercisable until a real accessible source exists.
adapterRegistry.register(new StarCineplexAdapter());
adapterRegistry.register(new DemoAdapter());

/**
 * Main discovery orchestration
 * 1. Search movie across all adapters
 * 2. Get showtimes concurrently
 * 3. Fetch seat maps concurrently
 * 4. Detect seat blocks
 * 5. Filter by requirement
 * 6. Rank results
 */
async function runDiscovery(request: DiscoveryRequest): Promise<DiscoveryResponse> {
  const startTime = Date.now();
  const results: RankedResult[] = [];
  const errors: Array<{ cinemaId: string; error: string }> = [];

  const adapters = adapterRegistry.getEnabled();

  // Step 1: Search for movies across all adapters
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

  // Step 2: Get showtimes for found movies
  const showtimePromises = searchResults.flatMap(({ adapterId, movies }) => {
    if (movies.length === 0) {
      // Report the miss so the UI can explain why an adapter contributed nothing.
      errors.push({
        cinemaId: adapterId,
        error: `No showtimes found for "${request.movieName}"`,
      });
      return [];
    }

    const adapter = adapterRegistry.get(adapterId)!;
    return movies.map(movie => adapter.getShowtimes(movie).catch((e: Error) => {
      errors.push({ cinemaId: adapterId, error: `Showtime fetch failed: ${e.message}` });
      return [] as Showtime[];
    }));
  });

  const allShowtimes = (await Promise.all(showtimePromises)).flat();

  // Step 3: Fetch seat maps for each showtime
  const seatMapPromises = allShowtimes.map(showtime => {
    const adapter = adapterRegistry.get(showtime.cinema.id)!;
    return adapter.getSeatMap(showtime)
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

  // Step 4 & 5: Detect blocks and filter by requirement
  const eligible = seatMapResults.flatMap(({ showtime, seatMap }) => {
    const blocks = detectSeatBlocks(seatMap, { requiredSeats: request.requiredSeats });
    const eligibleBlocks = filterBlocksByRequirement(blocks, request.requiredSeats);

    return eligibleBlocks.map(block => ({ showtime, seatBlock: block }));
  });

  // Step 6: Rank results
  const ranked = rankResults(eligible, request.weights, request.criteria);

  results.push(...ranked);

  return {
    results,
    errors,
    duration: Date.now() - startTime,
  };
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DISCOVER') {
    runDiscovery(message.request)
      .then(sendResponse)
      .catch(e => sendResponse({
        results: [],
        errors: [{ cinemaId: 'core', error: e.message }],
        duration: 0,
      }));
    return true; // Keep message channel open for async response
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
});

console.log('Movie Ticket Assistant service worker loaded');
console.log(`Registered ${adapterRegistry.listIds().length} adapter(s)`);