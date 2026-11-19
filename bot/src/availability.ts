import type { LiveBranch, LiveMovie, LiveShow } from "./live-types";
import type { TaskInput } from "./contracts";
import { getTimeSlot } from "../../packages/core/src";

export function movieCatalogState(
  movie: LiveMovie,
  shows: LiveShow[],
  today: string,
): "showing" | "upcoming" | "unpublished" {
  const futureShows = shows.filter(
    (show) =>
      show.movie.id === movie.id &&
      show.date >= today &&
      show.ticketStatus !== "started" &&
      show.branchActive,
  );
  const hasOpenSales = futureShows.some((show) => show.ticketStatus === "open");
  if (
    hasOpenSales ||
    (futureShows.length > 0 && (movie.isNowShowing || !movie.isUpcoming))
  )
    return "showing";
  if (movie.isUpcoming || (movie.releaseDate?.slice(0, 10) || "") > today)
    return "upcoming";
  return "unpublished";
}

export function explainMovieAvailability(
  movies: LiveMovie[],
  shows: LiveShow[],
  branches: LiveBranch[],
  input: Pick<
    TaskInput,
    | "targetMovieId"
    | "movieName"
    | "targetDate"
    | "locationIds"
    | "requiredSeats"
    | "preferredTimes"
  >,
): { title: string; message: string } {
  const selectedMovies = movies.filter((movie) =>
    input.targetMovieId
      ? movie.id === input.targetMovieId
      : movie.title
          .toLowerCase()
          .includes(input.movieName.trim().toLowerCase()),
  );
  const movieIds = new Set(selectedMovies.map((movie) => movie.id));
  const published = shows.filter(
    (show) => movieIds.has(show.movie.id) && show.ticketStatus !== "started",
  );
  if (!published.length)
    return {
      title: "Waiting for show announcements",
      message: `Cineplex has not published any upcoming shows for ${input.movieName}. There is no seat page to open yet. Choose a movie with published shows, or watch this date for an announcement.`,
    };
  const day = published.filter((show) => show.date === input.targetDate);
  if (!day.length)
    return {
      title: "Selected date is not published",
      message: `Cineplex has no published shows for ${input.movieName} on ${input.targetDate}. Published dates: ${[...new Set(published.map((show) => show.date))].sort().slice(0, 5).join(", ")}. Choose a published date or watch the selected date.`,
    };
  const venueIds = new Set(
    branches
      .filter(
        (branch) =>
          !input.locationIds.length ||
          input.locationIds.includes(branch.locationId) ||
          input.locationIds.includes(branch.id),
      )
      .map((branch) => branch.id),
  );
  const locations = day.filter(
    (show) => !input.locationIds.length || venueIds.has(show.venueId || ""),
  );
  if (!locations.length)
    return {
      title: "No shows at the selected locations",
      message: `Shows exist on ${input.targetDate}, but not at your selected locations. Choose another location or watch for a new show.`,
    };
  const times = locations.filter(
    (show) =>
      !input.preferredTimes.length ||
      input.preferredTimes.includes(getTimeSlot(show.time)),
  );
  if (!times.length)
    return {
      title: "Showtime preferences exclude every show",
      message: `Published showtimes at your locations are ${[...new Set(locations.map((show) => show.time))].sort().join(", ")}. Clear or change the preferred showtimes to search them.`,
    };
  const available = movieDateAvailability(
    times,
    branches,
    times[0].movie.id,
    input.targetDate,
    input.locationIds,
    input.requiredSeats,
  );
  return {
    title: availabilityLabels[available.state],
    message:
      available.state === "available"
        ? "The cinema reports tickets, but no seat group matched the current row, category or together preferences. Adjust the seating preferences and retry."
        : `${availabilityLabels[available.state]} for ${input.requiredSeats} seats on ${input.targetDate}. Choose another date, seat count or location, or watch for tickets to open.`,
  };
}

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
