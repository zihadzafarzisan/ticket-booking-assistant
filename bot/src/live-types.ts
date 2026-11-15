import type { Movie, Showtime } from "../../packages/core/src";

export type TicketStatus =
  | "open"
  | "sold_out"
  | "not_open"
  | "closed"
  | "counter_only"
  | "started"
  | "unknown";
export interface LiveMovie extends Movie {
  isNowShowing: boolean;
  isUpcoming: boolean;
  formats: string[];
}
export interface LiveBranch {
  id: string;
  locationId: string;
  name: string;
  city: string;
  address: string;
  active: boolean;
}
export interface LiveShow extends Showtime {
  sourceStatus: string;
  salesChannel: string;
  startsAt?: string;
  onlineSalesCloseAt?: string;
  availableKnown: boolean;
  priceKnown: boolean;
  hallNameResolved: boolean;
  branchActive: boolean;
  ticketStatus: TicketStatus;
}
export interface LiveHall {
  key: string;
  id: string;
  name: string;
  nameResolved: boolean;
  branchId: string;
  branchName: string;
  scheduledShows: number;
  openShows: number;
  reportedAvailableSeats: number;
}
export interface InventoryChange {
  id: string;
  showId: string;
  movieTitle: string;
  branchName: string;
  hallName: string;
  date: string;
  time: string;
  type: "sales_opened" | "tickets_reopened";
  detectedAt: string;
}
export interface LiveInventory {
  status: "loading" | "live" | "stale" | "error";
  refreshing: boolean;
  fetchedAt?: string;
  lastAttemptAt?: string;
  nextRefreshAt?: string;
  refreshIntervalSeconds: number;
  sourceUrl: string;
  error?: string;
  warnings: string[];
  movies: LiveMovie[];
  branches: LiveBranch[];
  shows: LiveShow[];
  halls: LiveHall[];
  changes: InventoryChange[];
  counts: {
    nowShowingMovies: number;
    openShows: number;
    hallsWithOpenTickets: number;
    reportedAvailableSeats: number;
  };
}
