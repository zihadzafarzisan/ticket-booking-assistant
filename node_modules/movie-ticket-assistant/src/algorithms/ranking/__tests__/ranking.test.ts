/**
 * Tests for the result ranking algorithm
 */
import { describe, it, expect } from 'vitest';
import { rankResults, scoreResult, DEFAULT_WEIGHTS } from '../scorer';
import { Showtime, ScreenType } from '../../../types/cinema';
import { SeatBlock } from '../../../types/seat';

function createShowtime(overrides: Partial<Showtime> = {}): Showtime {
  return {
    id: 'show-1',
    movie: { id: 'm1', title: 'Avatar' },
    cinema: {
      id: 'cine-1',
      name: 'Star Cineplex',
      location: 'Bashundhara',
    },
    hall: { id: 'h1', name: 'Hall 4', screenType: 'imax', capacity: 100 },
    date: '2026-09-10',
    time: '19:30',
    screenType: 'imax',
    price: 800,
    currency: 'BDT',
    availableSeats: 50,
    totalSeats: 100,
    bookingUrl: 'https://starcineplex.com/book',
    ...overrides,
  };
}

function createBlock(capacity: number, centerScore: number): SeatBlock {
  const seats = Array.from({ length: capacity }, (_, i) => ({
    id: `F${i + 1}`,
    row: 'F',
    number: i + 1,
    label: `F${i + 1}`,
    status: 'available' as const,
  }));
  return {
    id: 'block-1',
    row: 'F',
    seats,
    startSeat: 'F1',
    endSeat: `F${capacity}`,
    capacity,
    availableCount: capacity,
    centerScore,
    meetsRequirement: true,
  };
}

describe('scoreResult', () => {
  it('scores premier center-seat IMAX showtimes highest', () => {
    const showtime = createShowtime({ screenType: 'imax', price: 800, time: '19:30' });
    const block = createBlock(6, 0.95);

    const result = scoreResult(showtime, block, DEFAULT_WEIGHTS, {
      preferredTime: 'evening',
    });

    expect(result.overallScore).toBeGreaterThan(0.8);
    expect(result.hallFormatScore).toBeCloseTo(1.0);
    expect(result.seatQualityScore).toBeGreaterThan(0.7);
  });

  it('scores lower for cheap seats in a bad position', () => {
    const showtime = createShowtime({ screenType: 'standard', price: 450, time: '09:00' });
    const block = createBlock(2, 0.2);

    const result = scoreResult(showtime, block, DEFAULT_WEIGHTS);

    expect(result.overallScore).toBeLessThan(0.5);
  });

  it('rewards matching the preferred cinema', () => {
    const showtime = createShowtime({});
    const block = createBlock(4, 0.6);

    const result = scoreResult(showtime, block, DEFAULT_WEIGHTS, {
      preferredCinemaIds: ['cine-1'],
    });

    expect(result.cinemaScore).toBe(1.0);
  });

  it('generates human-readable reasoning', () => {
    const showtime = createShowtime({ screenType: 'imax', price: 800, time: '19:30' });
    const block = createBlock(6, 0.95);

    const result = scoreResult(showtime, block, DEFAULT_WEIGHTS, {
      preferredTime: 'evening',
    });

    expect(result.reasoning).toContain('center');
    expect(result.reasoning).toContain('IMAX');
  });
});

describe('rankResults', () => {
  it('sorts results by overall score descending', () => {
    const results = [
      {
        showtime: createShowtime({ screenType: 'standard', price: 900, time: '09:00' }),
        seatBlock: createBlock(2, 0.2),
      },
      {
        showtime: createShowtime({ screenType: 'imax', price: 800, time: '19:30' }),
        seatBlock: createBlock(6, 0.95),
      },
    ];

    const ranked = rankResults(results, DEFAULT_WEIGHTS, { preferredTime: 'evening' });

    expect(ranked[0].overallScore).toBeGreaterThanOrEqual(ranked[1].overallScore);
  });
});