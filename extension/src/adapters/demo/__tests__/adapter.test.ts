/**
 * Integration test: demo adapter → seat map → block detection → ranking.
 *
 * Verifies the full pipeline the popup depends on returns non-empty, ranked
 * results for any query — i.e. a search never silently yields "no results".
 */
import { describe, it, expect } from 'vitest';
import { DemoAdapter } from '../adapter';
import { detectSeatBlocks, filterBlocksByRequirement } from '../../../algorithms/seat-block/index';
import { rankResults, DEFAULT_WEIGHTS } from '../../../algorithms/ranking/scorer';

describe('DemoAdapter pipeline', () => {
  it('returns a matching movie for any query', async () => {
    const adapter = new DemoAdapter();
    const movies = await adapter.searchMovies('Inception');
    expect(movies).toHaveLength(1);
    expect(movies[0].title).toBe('Inception');
  });

  it('generates showtimes across multiple cinema halls', async () => {
    const adapter = new DemoAdapter();
    const [movie] = await adapter.searchMovies('Oppenheimer');
    const shows = await adapter.getShowtimes(movie);
    expect(shows.length).toBeGreaterThanOrEqual(5);
    // Distinct formats are present
    const formats = new Set(shows.map(s => s.screenType));
    expect(formats.has('imax')).toBe(true);
    expect(formats.has('standard')).toBe(true);
  });

  it('produces seat maps that are deterministic per showtime', async () => {
    const adapter = new DemoAdapter();
    const [movie] = await adapter.searchMovies('Dune');
    const [show] = await adapter.getShowtimes(movie);

    const mapA = await adapter.getSeatMap(show);
    const mapB = await adapter.getSeatMap(show);

    const statusOf = (map: typeof mapA) =>
      map.rows.get('C')?.map(s => `${s.number}:${s.status}`).join(',');

    expect(statusOf(mapA)).toBe(statusOf(mapB));
  });

  it('yields at least one viable seat block for a 3-seat search', async () => {
    const adapter = new DemoAdapter();
    const [movie] = await adapter.searchMovies('Avatar');

    const results = await Promise.all(
      (await adapter.getShowtimes(movie)).map(async show => {
        const seatMap = await adapter.getSeatMap(show);
        const blocks = filterBlocksByRequirement(
          detectSeatBlocks(seatMap, { requiredSeats: 3 }),
          3
        );
        return blocks.map(block => ({ showtime: show, seatBlock: block }));
      })
    );

    const flat = results.flat();
    expect(flat.length).toBeGreaterThan(0);

    // Ranking orders them by score
    const ranked = rankResults(flat, DEFAULT_WEIGHTS);
    expect(ranked[0].overallScore).toBeGreaterThanOrEqual(ranked[ranked.length - 1].overallScore);
  });
});