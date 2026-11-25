import {
  StarCineplexAdapter,
  matchesFilters,
  matchesLocation,
  getTimeSlot,
} from "../../packages/core/src";
import type { Movie, ShowtimeFilters } from "../../packages/core/src";
import { LiveInventoryService } from "./live-inventory";
import { explainMovieAvailability } from "./availability";
import type { TaskInput } from "./contracts";
import type { LiveShow } from "./live-types";

export interface MonitorTarget {
  url: string;
  show?: LiveShow;
}

export class LiveStarCineplexAdapter extends StarCineplexAdapter {
  constructor(private inventory: LiveInventoryService) {
    super();
  }
  override async searchMovies(
    query: string,
    signal?: AbortSignal,
  ): Promise<Movie[]> {
    const live = await this.inventory.fresh(undefined, signal);
    const search = query.trim().toLowerCase();
    return live.movies.filter(
      (movie) =>
        !search ||
        search === "all" ||
        movie.title.toLowerCase().includes(search),
    );
  }
  override async getShowtimes(
    movie: Movie,
    filters?: ShowtimeFilters,
    signal?: AbortSignal,
  ) {
    const live = await this.inventory.fresh(undefined, signal);
    return live.shows.filter(
      (show) =>
        show.movie.id === movie.id &&
        show.ticketStatus === "open" &&
        (!filters || matchesFilters(show, filters)),
    );
  }
  async explainEmptyResult(input: TaskInput, signal?: AbortSignal) {
    const live = await this.inventory.fresh(undefined, signal);
    return explainMovieAvailability(
      live.movies,
      live.shows,
      live.branches,
      input,
    );
  }
  resolveMonitorTarget(input: TaskInput): MonitorTarget | undefined {
    const live = this.inventory.snapshot();
    if (input.targetShowId) {
      const pinned = live.shows.find((show) => show.id === input.targetShowId);
      return {
        url:
          pinned?.bookingUrl ||
          `https://kichole.com/shows/${encodeURIComponent(input.targetShowId)}/seats?tenant=star-cineplex`,
        show: pinned,
      };
    }
    const query = input.movieName.trim().toLowerCase();
    const movieIds = new Set(
      live.movies
        .filter((movie) =>
          input.targetMovieId
            ? movie.id === input.targetMovieId
            : movie.title.toLowerCase().includes(query),
        )
        .map((movie) => movie.id),
    );
    if (!movieIds.size) return undefined;
    const preferredHall = input.preferredHall?.trim().toLowerCase();
    const matching = live.shows
      .filter(
        (show) =>
          movieIds.has(show.movie.id) &&
          show.date === input.targetDate &&
          show.branchActive &&
          !["started", "closed", "counter_only"].includes(show.ticketStatus) &&
          matchesLocation(show, input.locationIds) &&
          (!input.preferredTimes.length ||
            input.preferredTimes.includes(getTimeSlot(show.time))) &&
          (!preferredHall ||
            show.hall.id.toLowerCase() === preferredHall ||
            show.hall.name.toLowerCase().includes(preferredHall)) &&
          (!input.preferredShowtime ||
            show.time.slice(0, 5) === input.preferredShowtime),
      )
      .sort((a, b) => {
        const rank = (s: LiveShow) =>
          s.ticketStatus === "open"
            ? 0
            : s.ticketStatus === "not_open"
              ? 1
              : s.ticketStatus === "sold_out"
                ? 2
                : 3;
        return rank(a) - rank(b) || a.time.localeCompare(b.time);
      });
    const best = matching[0];
    if (!best) return undefined;
    return { url: best.bookingUrl, show: best };
  }
}
