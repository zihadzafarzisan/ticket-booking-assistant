import { StarCineplexAdapter, matchesFilters } from "../../packages/core/src";
import type { Movie, ShowtimeFilters } from "../../packages/core/src";
import { LiveInventoryService } from "./live-inventory";

export class LiveStarCineplexAdapter extends StarCineplexAdapter {
  constructor(private inventory: LiveInventoryService) {
    super();
  }
  override async searchMovies(query: string): Promise<Movie[]> {
    const live = await this.inventory.fresh();
    const search = query.trim().toLowerCase();
    return live.movies.filter(
      (movie) =>
        !search ||
        search === "all" ||
        movie.title.toLowerCase().includes(search),
    );
  }
  override async getShowtimes(movie: Movie, filters?: ShowtimeFilters) {
    const live = await this.inventory.fresh();
    return live.shows.filter(
      (show) =>
        show.movie.id === movie.id &&
        show.ticketStatus === "open" &&
        (!filters || matchesFilters(show, filters)),
    );
  }
}
