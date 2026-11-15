/**
 * Ranking weights configuration
 */

export const DEFAULT_RANKING_WEIGHTS = {
  seatQuality: 0.4,
  showtime: 0.2,
  cinema: 0.15,
  hallFormat: 0.15,
  price: 0.1,
};

export const RANKING_PRESETS = {
  bestValue: {
    seatQuality: 0.3,
    showtime: 0.15,
    cinema: 0.1,
    hallFormat: 0.15,
    price: 0.3,
  },
  bestExperience: {
    seatQuality: 0.45,
    showtime: 0.15,
    cinema: 0.15,
    hallFormat: 0.2,
    price: 0.05,
  },
  closestCinema: {
    seatQuality: 0.3,
    showtime: 0.15,
    cinema: 0.35,
    hallFormat: 0.1,
    price: 0.1,
  },
};

export type RankingWeightPreset = keyof typeof RANKING_PRESETS;
