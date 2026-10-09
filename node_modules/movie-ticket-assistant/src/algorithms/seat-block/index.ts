/**
 * Seat Block Detection Algorithm
 *
 * Identifies maximal contiguous available seat blocks in a seat map.
 * This is the core algorithm that powers the "no redundant results" feature.
 */

import { Seat, SeatBlock, SeatMap, SeatStatus, createSeatBlock } from '../../types/seat';
import { isRowAllowed, DEFAULT_ALLOWED_ROWS, normalizeRowLabel } from '../../utils/date';

export { isRowAllowed, DEFAULT_ALLOWED_ROWS, normalizeRowLabel };

/**
 * Configuration for block detection
 */
export interface BlockDetectionConfig {
  /** Minimum number of seats required */
  requiredSeats: number;

  /** Allowed row labels to search (e.g. ['B', 'C', 'D', 'E', 'F']) */
  allowedRows?: string[];

  /** Whether to consider seat categories (VIP, couple, etc.) */
  respectCategories?: boolean;

  /** Preferred seat categories */
  preferredCategories?: string[];

  /** Whether seats with numeric gaps should be considered contiguous */
  allowNumericGaps?: boolean;
}

/**
 * Detect all maximal contiguous blocks of available seats in a seat map
 *
 * @param seatMap - The parsed seat map
 * @param config - Detection configuration
 * @returns Array of seat blocks that meet the requirement
 */
export function detectSeatBlocks(
  seatMap: SeatMap,
  config: BlockDetectionConfig
): SeatBlock[] {
  const allBlocks: SeatBlock[] = [];

  // Process each row
  seatMap.rows.forEach((seats, rowLabel) => {
    // If allowedRows is specified, only process matching rows (e.g. B, C, D, E, F)
    if (config.allowedRows && config.allowedRows.length > 0) {
      if (!isRowAllowed(rowLabel, config.allowedRows)) {
        return;
      }
    }

    const rowBlocks = detectRowBlocks(seats, rowLabel, config);
    allBlocks.push(...rowBlocks);
  });

  // Sort by center score (best seats first)
  allBlocks.sort((a, b) => b.centerScore - a.centerScore);

  return allBlocks;
}

/**
 * Detect blocks within a single row
 */
function detectRowBlocks(
  seats: Seat[],
  rowLabel: string,
  config: BlockDetectionConfig
): SeatBlock[] {
  if (seats.length === 0) return [];

  // Sort seats by number
  const sortedSeats = [...seats].sort((a, b) => a.number - b.number);

  const blocks: SeatBlock[] = [];
  let currentBlock: Seat[] = [];

  for (let i = 0; i < sortedSeats.length; i++) {
    const seat = sortedSeats[i];

    // Skip non-available seats (except if we're at the start of a potential block)
    if (!isAvailable(seat, config)) {
      // If we have a current block, finalize it
      if (currentBlock.length > 0) {
        const block = createSeatBlock(rowLabel, currentBlock);
        block.meetsRequirement = block.capacity >= config.requiredSeats;
        blocks.push(block);
        currentBlock = [];
      }
      continue;
    }

    // Check if this seat is contiguous with the previous one
    if (currentBlock.length > 0) {
      const prevSeat = currentBlock[currentBlock.length - 1];

      if (!isContiguous(prevSeat, seat, config)) {
        // Gap detected - finalize current block and start new one
        const block = createSeatBlock(rowLabel, currentBlock);
        block.meetsRequirement = block.capacity >= config.requiredSeats;
        blocks.push(block);
        currentBlock = [];
      }
    }

    currentBlock.push(seat);
  }

  // Don't forget the last block
  if (currentBlock.length > 0) {
    const block = createSeatBlock(rowLabel, currentBlock);
    block.meetsRequirement = block.capacity >= config.requiredSeats;
    blocks.push(block);
  }

  return blocks;
}

/**
 * Check if a seat is considered available
 */
function isAvailable(seat: Seat, config: BlockDetectionConfig): boolean {
  if (seat.status !== 'available' && seat.status !== 'selected') {
    return false;
  }

  // Check category preferences if enabled
  if (config.respectCategories && config.preferredCategories && seat.category) {
    // Include preferred categories, include standard as fallback
    if (!config.preferredCategories.includes(seat.category) && seat.category !== 'regular') {
      return false;
    }
  }

  return true;
}

/**
 * Check if two seats are contiguous (adjacent)
 */
function isContiguous(seat1: Seat, seat2: Seat, config: BlockDetectionConfig): boolean {
  // If seats have explicit adjacency data, use it
  if (seat1.adjacentSeatIds?.includes(seat2.id)) {
    return true;
  }

  // Check numeric adjacency with optional gap tolerance
  const numericGap = seat2.number - seat1.number;

  if (numericGap === 1) {
    // Consecutive numbers - definitely adjacent
    return true;
  }

  if (config.allowNumericGaps && numericGap <= 2) {
    // Allow small gaps (handles some aisle numbering schemes)
    return true;
  }

  // Check visual coordinates if available
  if (seat1.x !== undefined && seat1.y !== undefined &&
      seat2.x !== undefined && seat2.y !== undefined) {
    const distance = Math.sqrt(
      Math.pow(seat2.x - seat1.x, 2) +
      Math.pow(seat2.y - seat1.y, 2)
    );
    // Assume seats are ~40px apart in visual representation
    return distance < 50;
  }

  return false;
}

/**
 * Get only the blocks that meet the seat requirement
 */
export function filterBlocksByRequirement(
  blocks: SeatBlock[],
  requiredSeats: number
): SeatBlock[] {
  return blocks.filter(block => block.capacity >= requiredSeats);
}

/**
 * Group blocks by quality tier
 */
export function tierBlocks(blocks: SeatBlock[]): {
  excellent: SeatBlock[];
  good: SeatBlock[];
  fair: SeatBlock[];
  poor: SeatBlock[];
} {
  return {
    excellent: blocks.filter(b => b.centerScore >= 0.8),
    good: blocks.filter(b => b.centerScore >= 0.6 && b.centerScore < 0.8),
    fair: blocks.filter(b => b.centerScore >= 0.4 && b.centerScore < 0.6),
    poor: blocks.filter(b => b.centerScore < 0.4),
  };
}

/**
 * Select optimal seats within a block
 * Prefers the center of the block
 */
export function selectOptimalSeats(
  block: SeatBlock,
  count: number
): Seat[] {
  const available = block.seats.filter(s => s.status === 'available');

  if (available.length <= count) {
    return available;
  }

  // Find the center of the block
  const centerIndex = Math.floor(available.length / 2);

  // Select seats centered around the middle
  const result: Seat[] = [];
  const startIndex = centerIndex - Math.floor(count / 2);

  for (let i = 0; i < count; i++) {
    const idx = startIndex + i;
    if (idx >= 0 && idx < available.length) {
      result.push(available[idx]);
    }
  }

  return result;
}