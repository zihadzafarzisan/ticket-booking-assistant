/**
 * Ranking weights configuration
 */

export const DEFAULT_RANKING_WEIGHTS = {
  seatQuality: 0.40,
  showtime: 0.20,
  cinema: 0.15,
  hallFormat: 0.15,
  price: 0.10,
};

export const RANKING_PRESETS = {
  bestValue: {
    seatQuality: 0.30,
    showtime: 0.15,
    cinema: 0.10,
    hallFormat: 0.15,
    price: 0.30,
  },
  bestExperience: {
    seatQuality: 0.45,
    showtime: 0.15,
    cinema: 0.15,
    hallFormat: 0.20,
    price: 0.05,
  },
  closestCinema: {
    seatQuality: 0.30,
    showtime: 0.15,
    cinema: 0.35,
    hallFormat: 0.10,
    price: 0.10,
  },
};

export type RankingWeightPreset = keyof typeof RANKING_PRESETS;