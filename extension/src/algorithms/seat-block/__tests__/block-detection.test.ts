/**
 * Tests for Seat Block Detection Algorithm
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectSeatBlocks, filterBlocksByRequirement, selectOptimalSeats } from '../index';
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