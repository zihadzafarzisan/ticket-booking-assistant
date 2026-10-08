/**
 * Result Ranking Algorithm
 *
 * Scores and ranks discovered ticket options based on configurable weights.
 */

import { Showtime, ScreenType } from '../../types/cinema';
import { SeatBlock } from '../../types/seat';

/**
 * Configurable ranking weights
 * All values should sum to 1.0
 */
export interface RankingWeights {
  seatQuality: number;    // 0-1
  showtime: number;       // 0-1
  cinema: number;         // 0-1
  hallFormat: number;     // 0-1
  price: number;          // 0-1
}

/**
 * Ranking criteria/inputs
 */
export interface RankingCriteria {
  preferredTime?: string;         // 'morning' | 'afternoon' | 'evening'
  preferredCinemaIds?: string[];
  preferredScreenTypes?: ScreenType[];
  maxPrice?: number;
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
  seatQuality: 0.40,
  showtime: 0.20,
  cinema: 0.15,
  hallFormat: 0.15,
  price: 0.10,
};

/**
 * Screen type quality scores (higher = better experience)
 */
const SCREEN_TYPE_SCORES: Record<ScreenType, number> = {
  imax: 1.0,
  dolby_atmos: 0.95,
  '4dx': 0.9,
  premium: 0.8,
  laser: 0.75,
  '3d': 0.6,
  standard: 0.4,
};

/**
 * Time period scores
 */
const TIME_PERIOD_SCORES: Record<string, number> = {
  evening: 0.9,    // Most people prefer evening shows
  afternoon: 0.7,
  morning: 0.5,
};

/**
 * Human-readable labels for screen types (used in reasoning)
 */
const SCREEN_TYPE_LABELS: Record<ScreenType, string> = {
  imax: 'IMAX',
  dolby_atmos: 'Dolby Atmos',
  '4dx': '4DX',
  premium: 'Premium',
  laser: 'Laser',
  '3d': '3D',
  standard: 'Standard',
};

/**
 * Score a single result
 */
export function scoreResult(
  showtime: Showtime,
  seatBlock: SeatBlock,
  weights: RankingWeights,
  criteria: RankingCriteria = {}
): RankedResult {
  const seatQualityScore = calculateSeatQualityScore(seatBlock);
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

/**
 * Calculate seat quality score (0-1)
 * Based on center score and block capacity
 */
function calculateSeatQualityScore(block: SeatBlock): number {
  // Primary factor: center score from the block detection
  const centerWeight = 0.7;
  const capacityWeight = 0.3;

  // Capacity bonus: larger blocks score slightly higher
  const capacityScore = Math.min(block.capacity / 8, 1);

  return block.centerScore * centerWeight + capacityScore * capacityWeight;
}

/**
 * Calculate showtime score (0-1)
 */
function calculateShowtimeScore(
  showtime: Showtime,
  criteria: RankingCriteria
): number {
  // Check preferred time
  if (criteria.preferredTime) {
    const hour = parseInt(showtime.time.split(':')[0]);

    let period: string;
    if (hour < 12) period = 'morning';
    else if (hour < 18) period = 'afternoon';
    else period = 'evening';

    if (period === criteria.preferredTime) {
      return TIME_PERIOD_SCORES[period] || 1;
    }
  }

  // Default: slightly favor evening, penalize very early/late
  const hour = parseInt(showtime.time.split(':')[0]);
  if (hour >= 18 && hour <= 21) return 0.9;
  if (hour >= 12 && hour <= 23) return 0.7;
  return 0.5;
}

/**
 * Calculate cinema score (0-1)
 */
function calculateCinemaScore(
  showtime: Showtime,
  criteria: RankingCriteria
): number {
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
  criteria: RankingCriteria
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
  criteria: RankingCriteria
): number {
  const maxPrice = criteria.maxPrice || showtime.price * 2;
  const minPrice = showtime.price * 0.5;

  // Normalize price to 0-1 score
  // Lower is better, so invert the range
  const priceRange = maxPrice - minPrice;
  if (priceRange <= 0) return 1;

  const normalizedPrice = (maxPrice - showtime.price) / priceRange;
  return Math.max(0, Math.min(1, normalizedPrice));
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
    positives.push('excellent center seats');
  } else if (params.seatQualityScore >= 0.6) {
    positives.push('good seat placement');
  }

  if (params.showtimeScore >= 0.8) {
    positives.push('preferred time slot');
  }

  if (params.hallFormatScore >= 0.9) {
    positives.push(`${SCREEN_TYPE_LABELS[params.showtime.screenType] || params.showtime.screenType} format`);
  } else if (params.hallFormatScore >= 0.7) {
    positives.push('premium hall experience');
  }

  if (params.priceScore >= 0.8) {
    positives.push('great value');
  } else if (params.priceScore >= 0.6) {
    positives.push('reasonable price');
  }

  if (positives.length === 0) {
    return 'Available seating option';
  }

  return positives.join(', ').replace(/,([^,]*)$/, ' and$1');
}

/**
 * Rank multiple results
 */
export function rankResults(
  results: Array<{ showtime: Showtime; seatBlock: SeatBlock }>,
  weights: RankingWeights = DEFAULT_WEIGHTS,
  criteria: RankingCriteria = {}
): RankedResult[] {
  const ranked = results.map(r =>
    scoreResult(r.showtime, r.seatBlock, weights, criteria)
  );

  // Sort by overall score descending
  ranked.sort((a, b) => b.overallScore - a.overallScore);

  return ranked;
}