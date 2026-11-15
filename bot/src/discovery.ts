import {
  StarCineplexAdapter,
  DemoAdapter,
  detectSeatBlocks,
  selectOptimalSeats,
  fulfillRequiredSeats,
  createCompositeSeatBlock,
  createSeatBlock,
  rankResults,
  matchesLocation,
  getTimeSlot,
} from "../../packages/core/src";
import type {
  CinemaAdapter,
  SeatMap,
  SeatBlock,
  Seat,
} from "../../packages/core/src";
import type { Candidate, TaskInput } from "./contracts";

export class DiscoveryService {
  constructor(
    private live: CinemaAdapter = new StarCineplexAdapter(),
    private demo: CinemaAdapter = new DemoAdapter(),
  ) {}

  async search(input: TaskInput, signal: AbortSignal): Promise<Candidate[]> {
    const adapter = input.source === "demo" ? this.demo : this.live;
    const movies = await adapter.searchMovies(input.movieName);
    signal.throwIfAborted();
    if (!movies.length)
      throw new Error(
        `No catalog match for “${input.movieName}”. Check the movie name and cinema connection.`,
      );
    const shows = (
      await Promise.all(
        movies
          .slice(0, 8)
          .map((movie) =>
            adapter.getShowtimes(movie, { date: input.targetDate }),
          ),
      )
    ).flat();
    signal.throwIfAborted();
    const filtered = shows
      .map((show) =>
        input.source === "demo" ? { ...show, date: input.targetDate } : show,
      )
      .filter(
        (show) =>
          show.date === input.targetDate &&
          matchesLocation(show, input.locationIds) &&
          (!input.preferredTimes.length ||
            input.preferredTimes.includes(getTimeSlot(show.time))),
      )
      .sort((a, b) => a.time.localeCompare(b.time));
    const candidates: Candidate[] = [];
    // Bounded concurrency prevents catalog searches from flooding inventory endpoints.
    const queue = filtered.slice(0, 36);
    for (let index = 0; index < queue.length; index += 4) {
      const batch = await Promise.all(
        queue.slice(index, index + 4).map(async (showtime) => {
          signal.throwIfAborted();
          const map = await adapter.getSeatMap(showtime);
          signal.throwIfAborted();
          const blocks = eligibleBlocks(map, input);
          return rankResults(
            blocks.map((seatBlock) => ({ showtime, seatBlock })),
            undefined,
            {
              preferredTimes: input.preferredTimes,
              allowedRows: input.allowedRows,
              preferredLocationIds: input.locationIds,
            },
          ).map((result) => ({
            ...result,
            key: `${showtime.id}:${result.seatBlock.id}`,
            seatLabels: selectOptimalSeats(
              result.seatBlock,
              input.requiredSeats,
            ).map((s) => s.label),
            simulated: input.source === "demo",
          }));
        }),
      );
      candidates.push(...batch.flat());
    }
    return candidates
      .sort((a, b) => {
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
  if (input.rowPreference === "back")
    sufficient.sort((a, b) => b.row.localeCompare(a.row));
  return sufficient;
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
  return runs.map((seats) => ({
    ...createSeatBlock(block.row, seats, block.section),
    meetsRequirement: seats.length >= requiredSeats,
  }));
}
