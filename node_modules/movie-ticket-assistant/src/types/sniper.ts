/**
 * Seat Drop Sniper Type Definitions
 *
 * Types for automated scheduled ticket drops, target date monitoring,
 * auto-refresh polling, and instant seat reservation.
 */

import { Showtime } from './cinema';
import { SeatBlock, Seat } from './seat';
import { TimeSlot } from '../utils/date';

export interface RankedResult {
  showtime: Showtime;
  seatBlock: SeatBlock;
  overallScore: number;
  reasoning: string;
}

export type SniperStatus =
  | 'idle'
  | 'waiting_schedule'
  | 'refreshing'
  | 'seats_found'
  | 'booked'
  | 'stopped'
  | 'error';

export interface SniperConfig {
  id: string;
  active: boolean;
  movieName: string;
  movieId?: string;
  targetDate: string; // ISO date format YYYY-MM-DD (e.g., "2026-10-13")
  requiredSeats: number;
  intervalSeconds: number; // e.g. 2, 2.5, 3, 5
  preferredCategory?: 'any' | 'regular' | 'premium' | 'vip' | 'lounger';
  preferredTime?: 'any' | 'morning' | 'afternoon' | 'evening' | 'night';
  preferredTimes?: TimeSlot[];
  preferredRow?: 'any' | 'center' | 'back' | 'front';
  allowedRows?: string[]; // e.g. ['B', 'C', 'D', 'E', 'F']
  preferredCinemaId?: string;
  preferredLocationIds?: string[]; // Multiple branch IDs e.g. ['bashundhara', 'sony-square']
  dropTime?: string; // Optional ISO datetime string when drop starts (e.g. "2026-10-09T23:55:00")
  autoOpenTab: boolean;
  autoRefreshPage: boolean;
  targetTabId?: number;
  createdAt: number;
}

export interface SniperLogEntry {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface SniperState {
  config: SniperConfig | null;
  status: SniperStatus;
  refreshCount: number;
  lastCheckTime: number;
  nextCheckTime?: number;
  logs: SniperLogEntry[];
  result?: RankedResult;
  bookedSeats?: string[];
  bookingUrl?: string;
  targetTabId?: number;
  errorMessage?: string;
}

export interface SniperCheckResult {
  found: boolean;
  showtime?: Showtime;
  seatBlock?: SeatBlock;
  selectedSeats?: Seat[];
  seatLabels?: string[];
  bookingUrl?: string;
  error?: string;
}
