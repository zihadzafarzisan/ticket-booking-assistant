/**
 * Tests for Seat Drop Sniper Engine & Date Utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SniperEngine } from '../sniper-engine';
import { normalizeToIsoDate, formatDateDisplay, formatCountdown } from '../../utils/date';
import { CinemaAdapter, adapterRegistry } from '../../adapters/base-adapter';
import { Movie, Showtime } from '../../types/cinema';
import { SeatMap, Seat } from '../../types/seat';
import { SniperConfig } from '../../types/sniper';

class MockDropAdapter extends CinemaAdapter {
  readonly id = 'star-cineplex';
  readonly name = 'Star Cineplex (Mock)';
  readonly supportedDomains = ['starcineplex.com', 'kichole.com'];

  // Toggle to simulate whether the drop for 13 Oct has opened or not
  public isDropOpen = false;

  async searchMovies(query: string): Promise<Movie[]> {
    return [
      {
        id: 'movie-101',
        title: query || 'Avengers: Doomsday',
        duration: 160,
      },
    ];
  }

  async getShowtimes(movie: Movie): Promise<Showtime[]> {
    const shows: Showtime[] = [
      // Regular show on 10 Oct
      {
        id: 'show-1',
        movie,
        cinema: { id: 'star-cineplex', name: 'Star Cineplex (Sony Square)', location: 'Mirpur' },
        hall: { id: 'h1', name: 'Hall 1', screenType: 'imax', capacity: 100 },
        date: '2026-10-10',
        time: '14:30',
        screenType: 'imax',
        price: 600,
        currency: 'BDT',
        availableSeats: 50,
        totalSeats: 100,
        bookingUrl: 'https://kichole.com/shows/show-1/seats',
      },
    ];

    // If drop for 13 Oct has opened:
    if (this.isDropOpen) {
      shows.push({
        id: 'show-drop-13',
        movie,
        cinema: { id: 'star-cineplex', name: 'Star Cineplex (Sony Square)', location: 'Mirpur' },
        hall: { id: 'h2', name: 'Hall 2 (IMAX)', screenType: 'imax', capacity: 100 },
        date: '2026-10-13',
        time: '19:00',
        screenType: 'imax',
        price: 650,
        currency: 'BDT',
        availableSeats: 80,
        totalSeats: 100,
        bookingUrl: 'https://kichole.com/shows/show-drop-13/seats',
      });
    }

    return shows;
  }

  async getSeatMap(showtime: Showtime): Promise<SeatMap> {
    const rowsMap = new Map<string, Seat[]>();
    const rows = ['A', 'B', 'C', 'D', 'E', 'F'];

    rows.forEach(row => {
      const seats: Seat[] = [];
      for (let n = 1; n <= 10; n++) {
        seats.push({
          id: `${row}${n}`,
          row,
          number: n,
          label: `${row}${n}`,
          status: 'available',
          category: row >= 'E' ? 'premium' : 'regular',
          price: showtime.price,
        });
      }
      // Populate adjacencies
      for (let i = 0; i < seats.length; i++) {
        const adj: string[] = [];
        if (i > 0) adj.push(seats[i - 1].id);
        if (i < seats.length - 1) adj.push(seats[i + 1].id);
        seats[i].adjacentSeatIds = adj;
      }
      rowsMap.set(row, seats);
    });

    return {
      cinemaId: showtime.cinema.id,
      movieId: showtime.movie.id,
      showtimeId: showtime.id,
      rows: rowsMap,
      blocks: [],
      hallName: showtime.hall.name,
      screenType: showtime.screenType,
      totalSeats: 60,
      availableSeats: 60,
      fetchedAt: new Date(),
    };
  }

  async selectSeats(): Promise<any> { return { success: true }; }
  async addToCart(): Promise<any> { return { success: true }; }
  async checkout(): Promise<any> { return { success: true }; }
}

describe('Seat Drop Sniper Engine', () => {
  let mockAdapter: MockDropAdapter;

  beforeEach(() => {
    mockAdapter = new MockDropAdapter();
    mockAdapter.config.priority = 100;
    adapterRegistry.register(mockAdapter);
  });

  describe('Date Utilities', () => {
    it('normalizes various date formats to YYYY-MM-DD', () => {
      expect(normalizeToIsoDate('2026-10-13')).toBe('2026-10-13');
      expect(normalizeToIsoDate('13-10-2026')).toBe('2026-10-13');
      expect(normalizeToIsoDate('13/10/2026')).toBe('2026-10-13');
      expect(normalizeToIsoDate('13th October 2026')).toBe('2026-10-13');
    });

    it('formats ISO dates for display', () => {
      const display = formatDateDisplay('2026-10-13');
      expect(display).toContain('13');
      expect(display).toContain('Oct');
      expect(display).toContain('2026');
    });

    it('formats countdown milliseconds to MM:SS or HH:MM:SS', () => {
      expect(formatCountdown(65000)).toBe('01:05');
      expect(formatCountdown(3665000)).toBe('01:01:05');
      expect(formatCountdown(0)).toBe('00:00');
    });
  });

  describe('Sniper Drop Detection and Seat Acquisition', () => {
    it('returns found: false when target date tickets are not yet released', async () => {
      mockAdapter.isDropOpen = false;

      const engine = new SniperEngine();
      const config: SniperConfig = {
        id: 'test-sniper-1',
        active: true,
        movieName: 'Avengers',
        targetDate: '2026-10-13',
        requiredSeats: 2,
        intervalSeconds: 2,
        preferredRow: 'center',
        autoOpenTab: false,
        autoRefreshPage: false,
        createdAt: Date.now(),
      };

      await engine.start(config);
      const checkRes = await engine.performCheck();

      expect(checkRes.found).toBe(false);
      engine.stop();
    });

    it('detects newly opened target date seats the moment drop opens and selects continuous block', async () => {
      const engine = new SniperEngine();
      const config: SniperConfig = {
        id: 'test-sniper-2',
        active: true,
        movieName: 'Avengers',
        targetDate: '2026-10-13',
        requiredSeats: 3,
        intervalSeconds: 2,
        preferredRow: 'center',
        autoOpenTab: false,
        autoRefreshPage: false,
        createdAt: Date.now(),
      };

      await engine.start(config);

      // Phase 1: Before drop (11:55 PM) -> not found
      mockAdapter.isDropOpen = false;
      const check1 = await engine.performCheck();
      expect(check1.found).toBe(false);

      // Phase 2: Midnight (12:00 AM) -> newly opened seats for 13 Oct become available!
      mockAdapter.isDropOpen = true;
      const check2 = await engine.performCheck();

      expect(check2.found).toBe(true);
      expect(check2.showtime?.date).toBe('2026-10-13');
      expect(check2.selectedSeats).toHaveLength(3);
      expect(check2.seatLabels).toHaveLength(3);

      // Continuous seats verification
      const labels = check2.seatLabels!;
      const rowLetter = labels[0][0];
      expect(labels.every(l => l.startsWith(rowLetter))).toBe(true);

      engine.stop();
    });

    it('respects seat tier preferences (e.g. Premium tier)', async () => {
      mockAdapter.isDropOpen = true;

      const engine = new SniperEngine();
      const config: SniperConfig = {
        id: 'test-sniper-3',
        active: true,
        movieName: 'Avengers',
        targetDate: '2026-10-13',
        requiredSeats: 2,
        intervalSeconds: 2,
        preferredCategory: 'premium',
        preferredRow: 'center',
        autoOpenTab: false,
        autoRefreshPage: false,
        createdAt: Date.now(),
      };

      await engine.start(config);
      const check = await engine.performCheck();

      expect(check.found).toBe(true);
      expect(check.seatBlock?.seats.some(s => s.category === 'premium')).toBe(true);

      engine.stop();
    });

    it('disarms when user stops the sniper', async () => {
      const engine = new SniperEngine();
      const config: SniperConfig = {
        id: 'test-sniper-4',
        active: true,
        movieName: 'Avengers',
        targetDate: '2026-10-13',
        requiredSeats: 2,
        intervalSeconds: 2,
        autoOpenTab: false,
        autoRefreshPage: false,
        createdAt: Date.now(),
      };

      await engine.start(config);
      expect(engine.getState().config?.active).toBe(true);

      const stopped = engine.stop('User cancelled');
      expect(stopped.config?.active).toBe(false);
      expect(stopped.status).toBe('stopped');
      expect(stopped.logs[0].message).toContain('User cancelled');
    });

    it('filters shows by multiple preferred time slots (e.g. afternoon + evening)', async () => {
      mockAdapter.isDropOpen = true; // Drop is open at 19:00 (evening)
      const engine = new SniperEngine();

      // Configure for morning only (should not match 19:00 show)
      const configMorning: SniperConfig = {
        id: 'test-sniper-morning',
        active: true,
        movieName: 'Avengers',
        targetDate: '2026-10-13',
        requiredSeats: 2,
        intervalSeconds: 2,
        preferredTimes: ['morning'],
        autoOpenTab: false,
        autoRefreshPage: false,
        createdAt: Date.now(),
      };
      await engine.start(configMorning);
      const resMorning = await engine.performCheck();
      expect(resMorning.found).toBe(false);
      engine.stop();

      // Configure for afternoon + evening (should match 19:00 show)
      const configEvening: SniperConfig = {
        id: 'test-sniper-multi',
        active: true,
        movieName: 'Avengers',
        targetDate: '2026-10-13',
        requiredSeats: 2,
        intervalSeconds: 2,
        preferredTimes: ['afternoon', 'evening'],
        autoOpenTab: false,
        autoRefreshPage: false,
        createdAt: Date.now(),
      };
      await engine.start(configEvening);
      const resEvening = await engine.performCheck();
      expect(resEvening.found).toBe(true);
      expect(resEvening.showtime?.time).toBe('19:00');
      engine.stop();
    });

    it('searches strictly in allowed rows (B, C, D, E, F) and excludes others', async () => {
      mockAdapter.isDropOpen = true;
      const engine = new SniperEngine();

      const config: SniperConfig = {
        id: 'test-sniper-rows',
        active: true,
        movieName: 'Avengers',
        targetDate: '2026-10-13',
        requiredSeats: 2,
        intervalSeconds: 2,
        allowedRows: ['B', 'C', 'D', 'E', 'F'],
        autoOpenTab: false,
        autoRefreshPage: false,
        createdAt: Date.now(),
      };

      await engine.start(config);
      const check = await engine.performCheck();

      expect(check.found).toBe(true);
      const seatRow = check.seatBlock?.row;
      expect(['B', 'C', 'D', 'E', 'F']).toContain(seatRow);
      expect(seatRow).not.toBe('A');
      expect(seatRow).not.toBe('L');
      expect(seatRow).not.toBe('N');
      engine.stop();
    });
  });
});
