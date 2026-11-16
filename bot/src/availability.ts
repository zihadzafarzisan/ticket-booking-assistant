import type { LiveBranch, LiveShow } from "./live-types";

export type AvailabilityState =
  | "available"
  | "insufficient"
  | "sold_out"
  | "not_open"
  | "unpublished"
  | "closed"
  | "unknown";
export interface DateAvailability {
  state: AvailabilityState;
  shows: LiveShow[];
  bookableShows: LiveShow[];
  reportedSeats: number;
  openingAt?: string;
}
export function movieDateAvailability(
  shows: LiveShow[],
  branches: LiveBranch[],
  movieId: string,
  date: string,
  locations: string[],
  requiredSeats: number,
): DateAvailability {
  const venueIds = new Set(
    branches
      .filter(
        (branch) =>
          !locations.length ||
          locations.includes(branch.locationId) ||
          locations.includes(branch.id),
      )
      .map((branch) => branch.id),
  );
  const selected = shows.filter(
    (show) =>
      show.movie.id === movieId &&
      show.date === date &&
      (!locations.length || venueIds.has(show.venueId || "")),
  );
  const open = selected.filter(
    (show) =>
      show.ticketStatus === "open" && show.branchActive && show.availableKnown,
  );
  const bookableShows = open.filter(
    (show) => show.availableSeats >= requiredSeats,
  );
  const openingAt = selected
    .filter((show) => show.ticketStatus === "not_open")
    .map((show) => show.onlineSalesOpenAt)
    .filter(
      (value): value is string => !!value && Number.isFinite(Date.parse(value)),
    )
    .sort()[0];
  let state: AvailabilityState = "unknown";
  if (!selected.length) state = "unpublished";
  else if (bookableShows.length) state = "available";
  else if (open.length) state = "insufficient";
  else if (selected.some((show) => show.ticketStatus === "not_open"))
    state = "not_open";
  else if (selected.every((show) => show.ticketStatus === "sold_out"))
    state = "sold_out";
  else if (
    selected.every((show) =>
      ["closed", "counter_only", "started"].includes(show.ticketStatus),
    )
  )
    state = "closed";
  return {
    state,
    shows: selected,
    bookableShows,
    reportedSeats: open.reduce((sum, show) => sum + show.availableSeats, 0),
    openingAt,
  };
}
export const availabilityLabels: Record<AvailabilityState, string> = {
  available: "Tickets available",
  insufficient: "Not enough seats in one show",
  sold_out: "Sold out on this date",
  not_open: "Tickets not open yet",
  unpublished: "Shows not published for this date",
  closed: "Online sales unavailable on this date",
  unknown: "Availability not confirmed",
};
