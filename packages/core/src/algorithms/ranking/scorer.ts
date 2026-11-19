/**
 * Result Ranking Algorithm
 *
 * Scores and ranks discovered ticket options based on configurable weights.
 */

import { Showtime, ScreenType, matchesLocation } from "../../types/cinema";
import { SeatBlock } from "../../types/seat";
import { getTimeSlot, isRowAllowed, normalizeRowLabel } from "../../utils/date";

/**
 * Configurable ranking weights
 * All values should sum to 1.0
 */
export interface RankingWeights {
  seatQuality: number; // 0-1
  showtime: number; // 0-1
  cinema: number; // 0-1
  hallFormat: number; // 0-1
  price: number; // 0-1
}

/**
 * Ranking criteria/inputs
 */
export interface RankingCriteria {
  preferredTime?: string; // 'morning' | 'afternoon' | 'evening' | 'night'
  preferredTimes?: string[]; // Multiple time slots e.g. ['afternoon', 'evening']
  allowedRows?: string[]; // e.g. ['B', 'C', 'D', 'E', 'F']
  preferredCinemaIds?: string[];
  preferredLocationIds?: string[]; // Multiple branch IDs e.g. ['bashundhara', 'sony-square']
  preferredScreenTypes?: ScreenType[];
  maxPrice?: number;
  priceRange?: { min: number; max: number };
  preferredSeatSection?: string;
}

/**
 * A ranked discovery result
 */
export interface RankedResult {
  // Original data
  showtime: Showtime;
  seatBlock: SeatBlock;

  // Scores
  overallScore: number;
  seatQualityScore: number;
  showtimeScore: number;
  cinemaScore: number;
  hallFormatScore: number;
  priceScore: number;

  // Human-readable reasoning
  reasoning: string;
}

/**
 * Default ranking weights
 */
export const DEFAULT_WEIGHTS: RankingWeights = {
  seatQuality: 0.4,
  showtime: 0.2,
  cinema: 0.15,
  hallFormat: 0.15,
  price: 0.1,
};

/**
 * Screen type quality scores (higher = better experience)
 */
const SCREEN_TYPE_SCORES: Record<ScreenType, number> = {
  imax: 1.0,
  dolby_atmos: 0.95,
  "4dx": 0.9,
  premium: 0.8,
  laser: 0.75,
  "3d": 0.6,
  "2d": 0.45,
  standard: 0.4,
};

/**
 * Human-readable labels for screen types (used in reasoning)
 */
const SCREEN_TYPE_LABELS: Record<ScreenType, string> = {
  imax: "IMAX",
  dolby_atmos: "Dolby Atmos",
  "4dx": "4DX",
  premium: "Premium",
  laser: "Laser",
  "3d": "3D",
  "2d": "2D",
  standard: "Standard",
};

/**
 * Score a single result
 */
export function scoreResult(
  showtime: Showtime,
  seatBlock: SeatBlock,
  weights: RankingWeights,
  criteria: RankingCriteria = {},
): RankedResult {
  const seatQualityScore = calculateSeatQualityScore(seatBlock, criteria);
  const showtimeScore = calculateShowtimeScore(showtime, criteria);
  const cinemaScore = calculateCinemaScore(showtime, criteria);
  const hallFormatScore = calculateHallFormatScore(showtime, criteria);
  const priceScore = calculatePriceScore(showtime, criteria);

  const overallScore =
    seatQualityScore * weights.seatQuality +
    showtimeScore * weights.showtime +
    cinemaScore * weights.cinema +
    hallFormatScore * weights.hallFormat +
    priceScore * weights.price;

  const reasoning = generateReasoning({
    seatQualityScore,
    showtimeScore,
    cinemaScore,
    hallFormatScore,
    priceScore,
    seatBlock,
    showtime,
  });

  return {
    showtime,
    seatBlock,
    overallScore: Math.round(overallScore * 100) / 100,
    seatQualityScore: Math.round(seatQualityScore * 100) / 100,
    showtimeScore: Math.round(showtimeScore * 100) / 100,
    cinemaScore: Math.round(cinemaScore * 100) / 100,
    hallFormatScore: Math.round(hallFormatScore * 100) / 100,
    priceScore: Math.round(priceScore * 100) / 100,
    reasoning,
  };
}

export function calculateRowPositionScore(rowLabel: string): number {
  const normRow = normalizeRowLabel(rowLabel);
  if (["C", "D", "E"].includes(normRow)) return 1.0;
  if (["B", "F"].includes(normRow)) return 0.85;
  if (["G", "H"].includes(normRow)) return 0.7;
  if (normRow === "A") return 0.35;
  return 0.5;
}

/**
 * Calculate seat quality score (0-1)
 * Based on center score, block capacity, and row positioning
 */
function calculateSeatQualityScore(
  block: SeatBlock,
  criteria?: RankingCriteria,
): number {
  // If allowedRows is specified and block is not in it, penalize to 0
  if (criteria?.allowedRows && criteria.allowedRows.length > 0) {
    if (!isRowAllowed(block.row, criteria.allowedRows)) {
      return 0;
    }
  }

  // Weighted components so prime rows (C/D/E) clearly outscore front/back rows even on open rows
  const centerWeight = 0.55;
  const capacityWeight = 0.25;
  const rowWeight = 0.2;

  // Capacity bonus: larger blocks score slightly higher
  const capacityScore = Math.min(block.capacity / 8, 1);
  const clampedCenter = Math.max(0, Math.min(1, block.centerScore));
  const rowScore = calculateRowPositionScore(block.row);
  const score =
    clampedCenter * centerWeight +
    capacityScore * capacityWeight +
    rowScore * rowWeight;

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate showtime score (0-1)
 */
function calculateShowtimeScore(
  showtime: Showtime,
  criteria: RankingCriteria,
): number {
  // Check multiple preferred times
  if (criteria.preferredTimes && criteria.preferredTimes.length > 0) {
    const slot = getTimeSlot(showtime.time);
    if (criteria.preferredTimes.includes(slot)) {
      return 1.0;
    }
    return 0.3;
  }

  // Check single preferred time
  if (criteria.preferredTime && criteria.preferredTime !== "any") {
    const slot = getTimeSlot(showtime.time);
    if (slot === criteria.preferredTime) {
      return 1.0;
    }
    return 0.3;
  }

  // Default: slightly favor evening, penalize very early/late
  const hour = parseInt(showtime.time.split(":")[0]);
  if (hour >= 17 && hour <= 21) return 0.9;
  if (hour >= 12 && hour < 17) return 0.8;
  return 0.5;
}

/**
 * Calculate cinema score (0-1)
 */
function calculateCinemaScore(
  showtime: Showtime,
  criteria: RankingCriteria,
): number {
  if (
    criteria.preferredLocationIds &&
    criteria.preferredLocationIds.length > 0
  ) {
    if (matchesLocation(showtime, criteria.preferredLocationIds)) {
      return 1.0;
    }
    return 0.2;
  }
  if (criteria.preferredCinemaIds?.includes(showtime.cinema.id)) {
    return 1.0;
  }
  // Default moderate score for non-preferred cinemas
  return 0.6;
}

/**
 * Calculate hall/format score (0-1)
 */
function calculateHallFormatScore(
  showtime: Showtime,
  criteria: RankingCriteria,
): number {
  const baseScore = SCREEN_TYPE_SCORES[showtime.screenType] || 0.5;

  // Bonus for preferred formats
  if (criteria.preferredScreenTypes?.includes(showtime.screenType)) {
    return Math.min(baseScore * 1.1, 1);
  }

  return baseScore;
}

/**
 * Calculate price score (0-1)
 * Lower price = higher score
 */
function calculatePriceScore(
  showtime: Showtime,
  criteria: RankingCriteria,
): number {
  if (showtime.price <= 0) return 0.5;
  if (criteria.maxPrice !== undefined && criteria.maxPrice > 0) {
    if (showtime.price > criteria.maxPrice) return 0;
    const minPrice = Math.min(
      criteria.priceRange?.min ?? criteria.maxPrice * 0.25,
      criteria.maxPrice,
    );
    const range = criteria.maxPrice - minPrice;
    if (range <= 0) return 1;
    return Math.max(
      0,
      Math.min(1, (criteria.maxPrice - showtime.price) / range),
    );
  }
  if (criteria.priceRange && criteria.priceRange.max > criteria.priceRange.min) {
    const range = criteria.priceRange.max - criteria.priceRange.min;
    return Math.max(
      0,
      Math.min(1, (criteria.priceRange.max - showtime.price) / range),
    );
  }
  // Neutral score when comparing a single price with no reference range
  return 0.67;
}

/**
 * Generate human-readable reasoning
 */
function generateReasoning(params: {
  seatQualityScore: number;
  showtimeScore: number;
  cinemaScore: number;
  hallFormatScore: number;
  priceScore: number;
  seatBlock: SeatBlock;
  showtime: Showtime;
}): string {
  const positives: string[] = [];

  if (params.seatQualityScore >= 0.8) {
    positives.push("excellent center seats");
  } else if (params.seatQualityScore >= 0.6) {
    positives.push("good seat placement");
  }

  if (params.showtimeScore >= 0.8) {
    positives.push("preferred time slot");
  }

  if (params.hallFormatScore >= 0.9) {
    positives.push(
      `${SCREEN_TYPE_LABELS[params.showtime.screenType] || params.showtime.screenType} format`,
    );
  } else if (params.hallFormatScore >= 0.7) {
    positives.push("premium hall experience");
  }

  if (params.priceScore >= 0.8) {
    positives.push("great value");
  } else if (params.priceScore >= 0.6) {
    positives.push("reasonable price");
  }

  if (positives.length === 0) {
    return "Available seating option";
  }

  return positives.join(", ").replace(/,([^,]*)$/, " and$1");
}

/**
 * Rank multiple results
 */
export function rankResults(
  results: Array<{ showtime: Showtime; seatBlock: SeatBlock }>,
  weights: RankingWeights = DEFAULT_WEIGHTS,
  criteria: RankingCriteria = {},
): RankedResult[] {
  const positivePrices = results
    .map((r) => r.showtime.price)
    .filter((p) => Number.isFinite(p) && p > 0);
  const effectiveCriteria: RankingCriteria =
    !criteria.priceRange && positivePrices.length > 1
      ? {
          ...criteria,
          priceRange: {
            min: Math.min(...positivePrices),
            max: Math.max(...positivePrices),
          },
        }
      : criteria;

  const ranked = results.map((r) =>
    scoreResult(r.showtime, r.seatBlock, weights, effectiveCriteria),
  );

  // Sort by overall score descending
  ranked.sort((a, b) => b.overallScore - a.overallScore);

  return ranked;
}
