/**
 * Tests for Seat Block Detection Algorithm
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectSeatBlocks, filterBlocksByRequirement, selectOptimalSeats, fulfillRequiredSeats } from '../index';
import { Seat, SeatMap, SeatStatus } from '../../../types/seat';

function createMockSeat(row: string, number: number, status: SeatStatus = 'available'): Seat {
  return {
    id: `${row}${number}`,
    row,
    number,
    label: `${row}${number}`,
    status,
  };
}

function createMockSeatMap(rows: Record<string, Seat[]>): SeatMap {
  const rowsMap = new Map(Object.entries(rows));
  return {
    cinemaId: 'test-cinema',
    movieId: 'test-movie',
    showtimeId: 'test-showtime',
    rows: rowsMap,
    blocks: [],
    hallName: 'Test Hall',
    screenType: 'standard',
    totalSeats: 0,
    availableSeats: 0,
    fetchedAt: new Date(),
  };
}

describe('detectSeatBlocks', () => {
  it('should detect a single continuous block', () => {
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'available'),
        createMockSeat('A', 2, 'available'),
        createMockSeat('A', 3, 'available'),
        createMockSeat('A', 4, 'available'),
        createMockSeat('A', 5, 'available'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 3 });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].row).toBe('A');
    expect(blocks[0].capacity).toBe(5);
    expect(blocks[0].startSeat).toBe('A1');
    expect(blocks[0].endSeat).toBe('A5');
  });

  it('should detect multiple separate blocks when seats are occupied', () => {
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'available'),
        createMockSeat('A', 2, 'available'),
        createMockSeat('A', 3, 'available'),
        createMockSeat('A', 4, 'occupied'),
        createMockSeat('A', 5, 'available'),
        createMockSeat('A', 6, 'available'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 2 });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].capacity).toBe(3); // A1-A3
    expect(blocks[1].capacity).toBe(2); // A5-A6
  });

  it('should NOT create overlapping blocks for a large available section', () => {
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'available'),
        createMockSeat('A', 2, 'available'),
        createMockSeat('A', 3, 'available'),
        createMockSeat('A', 4, 'available'),
        createMockSeat('A', 5, 'available'),
        createMockSeat('A', 6, 'available'),
        createMockSeat('A', 7, 'available'),
        createMockSeat('A', 8, 'available'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 3 });

    // Should return ONE block of 8 seats, NOT multiple overlapping 3-seat combinations
    expect(blocks).toHaveLength(1);
    expect(blocks[0].capacity).toBe(8);
  });

  it('should handle aisle gaps correctly', () => {
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'available'),
        createMockSeat('A', 2, 'available'),
        createMockSeat('A', 3, 'available'),
        // Gap represents aisle (A4-A6)
        createMockSeat('A', 7, 'available'),
        createMockSeat('A', 8, 'available'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, {
      requiredSeats: 2,
      allowNumericGaps: false,
    });

    expect(blocks).toHaveLength(2);
  });

  it('should respect seat categories when configured', () => {
    const seatMap = createMockSeatMap({
      A: [
        { ...createMockSeat('A', 1, 'available'), category: 'vip' },
        { ...createMockSeat('A', 2, 'available'), category: 'vip' },
        { ...createMockSeat('A', 3, 'available'), category: 'standard' },
        { ...createMockSeat('A', 4, 'available'), category: 'standard' },
      ],
    });

    const blocksVip = detectSeatBlocks(seatMap, {
      requiredSeats: 2,
      respectCategories: true,
      preferredCategories: ['vip'],
    });

    // Should only include VIP seats
    expect(blocksVip).toHaveLength(1);
    expect(blocksVip[0].capacity).toBe(2);
  });

  it('should calculate center score correctly', () => {
    // Middle of the row should have highest center score
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'available'),
        createMockSeat('A', 2, 'available'),
        createMockSeat('A', 3, 'available'),
        createMockSeat('A', 4, 'available'),
        createMockSeat('A', 5, 'available'),
        createMockSeat('A', 6, 'available'),
        createMockSeat('A', 7, 'available'),
        createMockSeat('A', 8, 'available'),
        createMockSeat('A', 9, 'available'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 3 });

    // Blocks should be sorted by center score (highest first)
    expect(blocks[0].centerScore).toBeGreaterThan(0);
    expect(blocks[0].centerScore).toBeLessThanOrEqual(1);
  });

  it('should mark blocks as meeting requirement when capacity is sufficient', () => {
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'available'),
        createMockSeat('A', 2, 'available'),
        createMockSeat('A', 3, 'available'),
      ],
      B: [
        createMockSeat('B', 1, 'available'),
        createMockSeat('B', 2, 'available'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 3 });

    expect(blocks.find(b => b.row === 'A')?.meetsRequirement).toBe(true);
    expect(blocks.find(b => b.row === 'B')?.meetsRequirement).toBe(false);
  });
});

describe('filterBlocksByRequirement', () => {
  it('should filter blocks to only those meeting the requirement', () => {
    const blocks = [
      { id: '1', row: 'A', seats: [], startSeat: 'A1', endSeat: 'A5', capacity: 5, availableCount: 5, centerScore: 0.8, meetsRequirement: true },
      { id: '2', row: 'B', seats: [], startSeat: 'B1', endSeat: 'B2', capacity: 2, availableCount: 2, centerScore: 0.7, meetsRequirement: false },
    ];

    const filtered = filterBlocksByRequirement(blocks as any, 3);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].row).toBe('A');
  });
});

describe('selectOptimalSeats', () => {
  it('should select center seats when possible', () => {
    const seats = [
      createMockSeat('A', 1),
      createMockSeat('A', 2),
      createMockSeat('A', 3),
      createMockSeat('A', 4),
      createMockSeat('A', 5),
    ];

    const block = {
      id: 'test',
      row: 'A',
      seats,
      startSeat: 'A1',
      endSeat: 'A5',
      capacity: 5,
      availableCount: 5,
      centerScore: 0.9,
      meetsRequirement: true,
    };

    const selected = selectOptimalSeats(block, 3);

    // Should select A2, A3, A4 (centered)
    expect(selected).toHaveLength(3);
    expect(selected.map(s => s.number)).toEqual([2, 3, 4]);
  });

  it('should handle requests larger than available seats', () => {
    const seats = [
      createMockSeat('A', 1),
      createMockSeat('A', 2),
    ];

    const block = {
      id: 'test',
      row: 'A',
      seats,
      startSeat: 'A1',
      endSeat: 'A2',
      capacity: 2,
      availableCount: 2,
      centerScore: 0.8,
      meetsRequirement: true,
    };

    const selected = selectOptimalSeats(block, 5);

    expect(selected).toHaveLength(2);
  });
});

describe('Edge Cases', () => {
  it('should handle empty seat map', () => {
    const seatMap = createMockSeatMap({});

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 3 });

    expect(blocks).toHaveLength(0);
  });

  it('should handle all seats occupied', () => {
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'occupied'),
        createMockSeat('A', 2, 'occupied'),
        createMockSeat('A', 3, 'occupied'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 2 });

    expect(blocks).toHaveLength(0);
  });

  it('should handle mixed seat statuses', () => {
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'available'),
        createMockSeat('A', 2, 'occupied'),
        createMockSeat('A', 3, 'blocked'),
        createMockSeat('A', 4, 'available'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 1 });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].capacity).toBe(1);
    expect(blocks[1].capacity).toBe(1);
  });

  it('should handle multiple rows', () => {
    const seatMap = createMockSeatMap({
      A: [
        createMockSeat('A', 1, 'available'),
        createMockSeat('A', 2, 'available'),
      ],
      B: [
        createMockSeat('B', 1, 'available'),
        createMockSeat('B', 2, 'available'),
        createMockSeat('B', 3, 'available'),
      ],
    });

    const blocks = detectSeatBlocks(seatMap, { requiredSeats: 2 });

    expect(blocks).toHaveLength(2);
  });
});

describe('selectOptimalSeats', () => {
  it('should select center seats when block capacity exceeds required seats', () => {
    const seats = [
      createMockSeat('F', 1, 'available'),
      createMockSeat('F', 2, 'available'),
      createMockSeat('F', 3, 'available'),
      createMockSeat('F', 4, 'available'),
      createMockSeat('F', 5, 'available'),
    ];

    const block = {
      id: 'F1-F5',
      row: 'F',
      seats,
      startSeat: 'F1',
      endSeat: 'F5',
      capacity: 5,
      availableCount: 5,
      centerScore: 0.9,
      meetsRequirement: true,
    };

    // Asking for 3 seats from a 5-seat block F1..F5 should center-allocate F2, F3, F4
    const selected = selectOptimalSeats(block, 3);
    expect(selected).toHaveLength(3);
    expect(selected.map(s => s.label)).toEqual(['F2', 'F3', 'F4']);
  });

  it('should return all available seats when requested count equals or exceeds available count', () => {
    const seats = [
      createMockSeat('B', 10, 'available'),
      createMockSeat('B', 11, 'available'),
    ];

    const block = {
      id: 'B10-B11',
      row: 'B',
      seats,
      startSeat: 'B10',
      endSeat: 'B11',
      capacity: 2,
      availableCount: 2,
      centerScore: 0.8,
      meetsRequirement: true,
    };

    const selected = selectOptimalSeats(block, 2);
    expect(selected).toHaveLength(2);
    expect(selected.map(s => s.label)).toEqual(['B10', 'B11']);
  });

  describe('Row filtering (B, C, D, E, F restriction)', () => {
    it('should only search for B, C, D, E, F rows and exclude back rows like L, N and front row A', () => {
      const seatMap = createMockSeatMap({
        A: [createMockSeat('A', 1), createMockSeat('A', 2), createMockSeat('A', 3)],
        B: [createMockSeat('B', 1), createMockSeat('B', 2), createMockSeat('B', 3)],
        C: [createMockSeat('C', 1), createMockSeat('C', 2), createMockSeat('C', 3)],
        D: [createMockSeat('D', 1), createMockSeat('D', 2), createMockSeat('D', 3)],
        E: [createMockSeat('E', 1), createMockSeat('E', 2), createMockSeat('E', 3)],
        F: [createMockSeat('F', 1), createMockSeat('F', 2), createMockSeat('F', 3)],
        L: [createMockSeat('L', 1), createMockSeat('L', 2), createMockSeat('L', 3), createMockSeat('L', 4)],
        N: [createMockSeat('N', 1), createMockSeat('N', 2), createMockSeat('N', 3), createMockSeat('N', 4)],
      });

      const blocks = detectSeatBlocks(seatMap, {
        requiredSeats: 2,
        allowedRows: ['B', 'C', 'D', 'E', 'F'],
      });

      expect(blocks.length).toBeGreaterThan(0);
      const rowsFound = blocks.map(b => b.row);

      // Verify no back rows (L, N) or screen-front row A
      expect(rowsFound).not.toContain('A');
      expect(rowsFound).not.toContain('L');
      expect(rowsFound).not.toContain('N');

      // Verify only allowed rows are present
      expect(rowsFound.every(r => ['B', 'C', 'D', 'E', 'F'].includes(r))).toBe(true);
    });

    it('should match row labels case-insensitively and handle prefixes', () => {
      const seatMap = createMockSeatMap({
        'Row B': [createMockSeat('Row B', 1), createMockSeat('Row B', 2)],
        'Row L': [createMockSeat('Row L', 1), createMockSeat('Row L', 2)],
      });

      const blocks = detectSeatBlocks(seatMap, {
        requiredSeats: 2,
        allowedRows: ['B', 'C', 'D', 'E', 'F'],
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].row).toBe('Row B');
    });
  });

  describe('fulfillRequiredSeats and large seat counts (9 seats)', () => {
    it('should select exactly 9 continuous centered seats when a single row has >= 9 seats', () => {
      const seatsRowC = Array.from({ length: 18 }, (_, i) => createMockSeat('C', i + 1));
      const seatMap = createMockSeatMap({ C: seatsRowC });
      const blocks = detectSeatBlocks(seatMap, { requiredSeats: 9, allowedRows: ['B', 'C', 'D', 'E', 'F'] });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].capacity).toBe(18);

      const fulfilled = fulfillRequiredSeats(blocks, 9, ['B', 'C', 'D', 'E', 'F']);
      expect(fulfilled).toHaveLength(9);
      // Verify contiguous center seats
      const numbers = fulfilled.map(s => s.number);
      for (let i = 1; i < numbers.length; i++) {
        expect(numbers[i] - numbers[i - 1]).toBe(1);
      }
    });

    it('should combine blocks across rows B-F to return exactly 9 seats when single blocks are smaller', () => {
      // Row C has 5 seats, Row D has 6 seats (neither can fulfill 9 alone)
      const seatsRowC = Array.from({ length: 5 }, (_, i) => createMockSeat('C', i + 1));
      const seatsRowD = Array.from({ length: 6 }, (_, i) => createMockSeat('D', i + 1));
      const seatMap = createMockSeatMap({ C: seatsRowC, D: seatsRowD });
      const blocks = detectSeatBlocks(seatMap, { requiredSeats: 5, allowedRows: ['B', 'C', 'D', 'E', 'F'] });

      expect(blocks).toHaveLength(2);

      const fulfilled = fulfillRequiredSeats(blocks, 9, ['B', 'C', 'D', 'E', 'F']);
      expect(fulfilled).toHaveLength(9);

      // Verify no duplicates
      const uniqueIds = new Set(fulfilled.map(s => s.id));
      expect(uniqueIds.size).toBe(9);

      // Seats are only from allowed rows C and D
      expect(fulfilled.every(s => s.row === 'C' || s.row === 'D')).toBe(true);
    });

    it('should safely clamp selectOptimalSeats when count equals block capacity', () => {
      const seats = Array.from({ length: 9 }, (_, i) => createMockSeat('B', i + 1));
      const seatMap = createMockSeatMap({ B: seats });
      const blocks = detectSeatBlocks(seatMap, { requiredSeats: 9 });

      const optimal = selectOptimalSeats(blocks[0], 9);
      expect(optimal).toHaveLength(9);
    });
  });
});