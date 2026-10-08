/**
 * Deterministic demo seat-map generator.
 *
 * Produces a realistic seat grid whose availability is a pure function of the
 * showtime id — the same showtime always yields the same seat map. This makes
 * demo results stable across searches (unlike Math.random) while still
 * exercising the real block-detection and ranking pipeline.
 *
 * A tiny PRNG (mulberry32) is seeded from the showtime id so the layout is
 * reproducible between sessions.
 */
import { Seat, SeatMap } from '../../types/seat';

/** Rows of the demo hall, back rows first (A = front). */
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
/** Seats per row; an aisle splits the row into two arms. */
const SEATS_PER_ROW = 14;
/** Numeric positions that are an aisle gap (not bookable). */
const AISLES = new Set([5, 11]);
/** Front two rows treated as premium, rear as standard. */
const PREMIUM_ROWS = new Set(['A', 'B']);

/** Deterministic PRNG: mulberry32. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit seed. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Generate a seeded, realistic seat map for a showtime. */
export function generateDemoSeatMap(showtimeId: string): SeatMap {
  const rand = mulberry32(hashSeed(showtimeId));
  const rowsMap = new Map<string, Seat[]>();
  const allSeats: Seat[] = [];

  for (const row of ROWS) {
    const seats: Seat[] = [];
    for (let num = 1; num <= SEATS_PER_ROW; num++) {
      if (AISLES.has(num)) continue; // aisle gap

      // ~35% of seats are taken in the demo hall
      const available = rand() > 0.35;
      const category = PREMIUM_ROWS.has(row) ? 'premium' : 'standard';

      seats.push({
        id: `${row}${num}`,
        row,
        number: num,
        label: `${row}${num}`,
        status: available ? 'available' : 'occupied',
        category,
        x: num,
        y: 0,
        // Pre-computed adjacency: neighbours without traversing an aisle gap
        adjacentSeatIds: [num - 1, num + 1]
          .filter(n => n >= 1 && n <= SEATS_PER_ROW && !AISLES.has(n))
          .map(n => `${row}${n}`),
      });
    }
    rowsMap.set(row, seats);
    allSeats.push(...seats);
  }

  return {
    cinemaId: 'demo-cineplex',
    movieId: 'demo-movie',
    showtimeId,
    rows: rowsMap,
    blocks: [],
    hallName: 'Demo Hall 1',
    screenType: 'standard',
    totalSeats: allSeats.length,
    availableSeats: allSeats.filter(s => s.status === 'available').length,
    fetchedAt: new Date(),
  };
}