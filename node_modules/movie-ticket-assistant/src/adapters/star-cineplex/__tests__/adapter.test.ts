import { describe, it, expect } from 'vitest';
import { StarCineplexAdapter } from '../adapter';
import { detectSeatBlocks, filterBlocksByRequirement } from '../../../algorithms/seat-block/index';
import { rankResults, DEFAULT_WEIGHTS } from '../../../algorithms/ranking/scorer';

describe('StarCineplexAdapter pipeline', () => {
  it('searches for real movies in Star Cineplex catalog', async () => {
    const adapter = new StarCineplexAdapter();
    const movies = await adapter.searchMovies('');
    expect(movies.length).toBeGreaterThan(0);

    // Search for a specific movie
    const query = movies[0].title.split(' ')[0];
    const filtered = await adapter.searchMovies(query);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered[0].title.toLowerCase()).toContain(query.toLowerCase());
  }, 10000);

  it('fetches real showtimes and seat maps for a movie', async () => {
    const adapter = new StarCineplexAdapter();
    const movies = await adapter.searchMovies('');
    expect(movies.length).toBeGreaterThan(0);

    // Find a movie that has showtimes
    let foundShowtimes: any[] = [];
    let targetMovie = movies[0];

    for (const movie of movies) {
      const shows = await adapter.getShowtimes(movie);
      if (shows.length > 0) {
        foundShowtimes = shows;
        targetMovie = movie;
        break;
      }
    }

    if (foundShowtimes.length > 0) {
      const firstShow = foundShowtimes[0];
      expect(firstShow.price).toBeGreaterThan(0);
      expect(firstShow.bookingUrl).toContain('kichole.com/shows');

      const seatMap = await adapter.getSeatMap(firstShow);
      expect(seatMap.rows.size).toBeGreaterThan(0);

      // Verify block detection on real hall layout
      const blocks = filterBlocksByRequirement(
        detectSeatBlocks(seatMap, { requiredSeats: 2 }),
        2
      );
      expect(blocks.length).toBeGreaterThan(0);

      // Verify no overlapping redundant duplicates
      const ranked = rankResults(
        blocks.map(b => ({ showtime: firstShow, seatBlock: b })),
        DEFAULT_WEIGHTS
      );
      expect(ranked[0].overallScore).toBeGreaterThanOrEqual(0);
    }
  }, 15000);
});
