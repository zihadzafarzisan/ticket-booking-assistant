import {
  StarCineplexAdapter,
  DemoAdapter,
  detectSeatBlocks,
  selectOptimalSeats,
  selectExactSeats,
  createExactSeatBlock,
  fulfillRequiredSeats,
  createCompositeSeatBlock,
  createSeatBlock,
  calculateRowPositionScore,
  rankResults,
  matchesLocation,
  getTimeSlot,
} from "../../packages/core/src";
import type {
  CinemaAdapter,
  SeatMap,
  SeatBlock,
  Seat,
  Showtime,
  Movie,
  ShowtimeFilters,
} from "../../packages/core/src";
import type { Candidate, TaskInput } from "./contracts";
import type { MonitorTarget } from "./live-adapter";

type SignalAwareAdapter = CinemaAdapter & {
  searchMovies(query: string, signal?: AbortSignal): Promise<Movie[]>;
  getShowtimes(
    movie: Movie,
    filters?: ShowtimeFilters,
    signal?: AbortSignal,
  ): Promise<Showtime[]>;
  explainEmptyResult?(
    input: TaskInput,
    signal?: AbortSignal,
  ): Promise<{ title: string; message: string }>;
  resolveMonitorTarget?(input: TaskInput): MonitorTarget | undefined;
};

function matchesHall(show: Showtime, preferredHall?: string): boolean {
  if (!preferredHall) return true;
  const query = preferredHall.trim().toLowerCase();
  return (
    show.hall.id.toLowerCase() === query ||
    show.hall.name.toLowerCase().includes(query)
  );
}

function matchesShowtime(show: Showtime, preferredShowtime?: string): boolean {
  if (!preferredShowtime) return true;
  return show.time.slice(0, 5) === preferredShowtime;
}

export class DiscoveryService {
  constructor(
    private live: CinemaAdapter = new StarCineplexAdapter(),
    private demo: CinemaAdapter = new DemoAdapter(),
  ) {}
  async explainEmptyResult(
    input: TaskInput,
    signal?: AbortSignal,
  ): Promise<{ title: string; message: string } | undefined> {
    if (input.source !== "live") return undefined;
    const adapter = this.live as SignalAwareAdapter;
    return adapter.explainEmptyResult?.(input, signal);
  }
  resolveMonitorTarget(input: TaskInput): MonitorTarget | undefined {
    if (input.source !== "live") return undefined;
    const adapter = this.live as SignalAwareAdapter;
    return adapter.resolveMonitorTarget?.(input);
  }

  async search(input: TaskInput, signal: AbortSignal): Promise<Candidate[]> {
    const adapter = (
      input.source === "demo" ? this.demo : this.live
    ) as SignalAwareAdapter;
    const movies = (
      await adapter.searchMovies(
        input.targetMovieId ? "all" : input.movieName,
        signal,
      )
    ).filter(
      (movie) => !input.targetMovieId || movie.id === input.targetMovieId,
    );
    signal.throwIfAborted();
    if (!movies.length) {
      if (input.mode === "monitor") return [];
      throw new Error(
        `No catalog match for “${input.movieName}”. Check the movie name and cinema connection.`,
      );
    }
    const shows = (
      await Promise.all(
        movies.slice(0, 8).map((movie) =>
          adapter.getShowtimes(
            movie,
            {
              date: input.targetDate,
              minAvailableSeats: input.requiredSeats,
            },
            signal,
          ),
        ),
      )
    ).flat();
    signal.throwIfAborted();
    if (input.targetShowId) {
      const selected = shows.find((show) => show.id === input.targetShowId);
      if (!selected) {
        if (input.mode === "monitor") return [];
        throw new Error(
          "The selected show is not currently available for this movie, date and seat count. Use Adjust search to unpin it or choose another show.",
        );
      }
      if (!matchesLocation(selected, input.locationIds))
        throw new Error(
          `The selected show is at ${selected.cinema.name}, but your branch filter excludes it. Use Adjust search to change the branch or unpin the show.`,
        );
      if (
        (input.preferredTimes.length &&
          !input.preferredTimes.includes(getTimeSlot(selected.time))) ||
        !matchesShowtime(selected, input.preferredShowtime)
      )
        throw new Error(
          `The selected show starts at ${selected.time}, but your time filter excludes it. Use Adjust search to change the time filter or unpin the show.`,
        );
      if (!matchesHall(selected, input.preferredHall))
        throw new Error(
          `The selected show is in ${selected.hall.name}, but your hall filter excludes it. Use Adjust search to change the hall filter or unpin the show.`,
        );
    }
    const filtered = shows
      .map((show) =>
        input.source === "demo" ? { ...show, date: input.targetDate } : show,
      )
      .filter(
        (show) =>
          show.date === input.targetDate &&
          (!input.targetShowId || show.id === input.targetShowId) &&
          matchesLocation(show, input.locationIds) &&
          (!input.preferredTimes.length ||
            input.preferredTimes.includes(getTimeSlot(show.time))) &&
          matchesHall(show, input.preferredHall) &&
          matchesShowtime(show, input.preferredShowtime),
      )
      .sort((a, b) => a.time.localeCompare(b.time));
    const rawPairs: Array<{
      showtime: (typeof filtered)[number];
      seatBlock: SeatBlock;
    }> = [];
    // Bounded concurrency prevents catalog searches from flooding inventory endpoints.
    const queue = filtered.slice(0, 36);
    for (let index = 0; index < queue.length; index += 4) {
      const batch = await Promise.all(
        queue.slice(index, index + 4).map(async (showtime) => {
          signal.throwIfAborted();
          const map = await adapter.getSeatMap(showtime);
          signal.throwIfAborted();
          const blocks = eligibleBlocks(map, input);
          return blocks.map((seatBlock) => ({ showtime, seatBlock }));
        }),
      );
      rawPairs.push(...batch.flat());
    }
    // Rank across all matching showtimes together so price and format scores normalize fairly.
    const candidates: Candidate[] = rankResults(rawPairs, undefined, {
      preferredTimes: input.preferredTimes,
      allowedRows: input.allowedRows,
      preferredLocationIds: input.locationIds,
    }).map((result) => ({
      ...result,
      key: `${result.showtime.id}:${result.seatBlock.id}`,
      seatLabels: result.seatBlock.id.startsWith("exact-")
        ? result.seatBlock.seats.map((s) => s.label)
        : selectOptimalSeats(result.seatBlock, input.requiredSeats).map(
            (s) => s.label,
          ),
      simulated: input.source === "demo",
    }));
    return candidates
      .sort((a, b) => {
        const aExact = a.seatBlock.id.startsWith("exact-") ? 1 : 0;
        const bExact = b.seatBlock.id.startsWith("exact-") ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        if (
          input.rowPreference === "front" &&
          a.seatBlock.row !== b.seatBlock.row
        )
          return a.seatBlock.row.localeCompare(b.seatBlock.row);
        if (
          input.rowPreference === "back" &&
          a.seatBlock.row !== b.seatBlock.row
        )
          return b.seatBlock.row.localeCompare(a.seatBlock.row);
        return b.overallScore - a.overallScore;
      })
      .slice(0, 150);
  }
}

export function eligibleBlocks(map: SeatMap, input: TaskInput) {
  let exactBlock: SeatBlock | undefined;
  if (input.targetSeats && input.targetSeats.length > 0) {
    const exact = selectExactSeats(map, input.targetSeats, input.requiredSeats);
    if (exact.length === input.requiredSeats) {
      exactBlock = createExactSeatBlock(exact, input.requiredSeats);
    }
    if (input.exactSeatsOnly) {
      return exactBlock ? [exactBlock] : [];
    }
  }
  const all = detectSeatBlocks(map, {
    requiredSeats: input.requiredSeats,
    allowedRows: input.allowedRows,
    respectCategories: input.preferredCategory !== "any",
    preferredCategories:
      input.preferredCategory === "any" ? undefined : [input.preferredCategory],
  })
    .flatMap((block) => honorKnownBoundaries(block, input.requiredSeats))
    .filter(
      (block) =>
        input.preferredCategory === "any" ||
        block.seats.every((s) => s.category === input.preferredCategory),
    );
  let sufficient = all.filter(
    (block) =>
      selectOptimalSeats(block, input.requiredSeats).length ===
      input.requiredSeats,
  );
  if (!sufficient.length && !input.keepTogether) {
    const seats = fulfillRequiredSeats(
      all,
      input.requiredSeats,
      input.allowedRows,
    );
    if (seats.length === input.requiredSeats)
      sufficient = [createCompositeSeatBlock(seats, input.requiredSeats)];
  }
  if (input.rowPreference === "front")
    sufficient.sort((a, b) => a.row.localeCompare(b.row));
  else if (input.rowPreference === "back")
    sufficient.sort((a, b) => b.row.localeCompare(a.row));
  else
    sufficient.sort(
      (a, b) =>
        calculateRowPositionScore(b.row) - calculateRowPositionScore(a.row) ||
        b.centerScore - a.centerScore ||
        b.capacity - a.capacity,
    );
  return exactBlock ? [exactBlock, ...sufficient] : sufficient;
}

function honorKnownBoundaries(
  block: SeatBlock,
  requiredSeats: number,
): SeatBlock[] {
  const runs: Seat[][] = [];
  let run: Seat[] = [];
  for (const seat of block.seats) {
    const previous = run.at(-1);
    const separated =
      previous &&
      (previous.aisle ||
        seat.aisle ||
        previous.section !== seat.section ||
        (previous.adjacentSeatIds !== undefined &&
          !previous.adjacentSeatIds.includes(seat.id)) ||
        (seat.adjacentSeatIds !== undefined &&
          !seat.adjacentSeatIds.includes(previous.id)) ||
        (seat.number !== previous.number + 1 &&
          !previous.adjacentSeatIds?.includes(seat.id)));
    if (separated && run.length) {
      runs.push(run);
      run = [];
    }
    run.push(seat);
  }
  if (run.length) runs.push(run);
  const numbers = block.seats.map((s) => s.number);
  const rowBounds = numbers.length
    ? { min: Math.min(...numbers), max: Math.max(...numbers) }
    : undefined;
  return runs.map((seats) => ({
    ...createSeatBlock(block.row, seats, block.section, rowBounds),
    meetsRequirement: seats.length >= requiredSeats,
  }));
}
