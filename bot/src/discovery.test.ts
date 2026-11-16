import { describe, expect, it, vi } from "vitest";
import { DiscoveryService, eligibleBlocks } from "./discovery";
import { DemoAdapter, type SeatMap } from "../../packages/core/src";
import { validateTask } from "./contracts";
const input = () =>
  validateTask({
    movieName: "Demo film",
    targetDate: "2099-12-01",
    requiredSeats: 2,
    source: "demo",
    autoReserve: false,
    allowedRows: ["B", "C", "D"],
    locationIds: [],
    preferredTimes: ["afternoon"],
  });
describe("standalone discovery", () => {
  it("uses the selected catalog movie ID instead of another title match", async () => {
    const demo = new DemoAdapter();
    vi.spyOn(demo, "searchMovies").mockResolvedValue([
      { id: "wrong-movie", title: "Demo film" },
      { id: "chosen-movie", title: "Demo film" },
    ]);
    const shows = vi.spyOn(demo, "getShowtimes");
    await new DiscoveryService(demo, demo).search(
      { ...input(), targetMovieId: "chosen-movie" },
      new AbortController().signal,
    );
    expect(shows).toHaveBeenCalledOnce();
    expect(shows.mock.calls[0][0].id).toBe("chosen-movie");
    expect(() => validateTask({ ...input(), targetMovieId: "../bad" })).toThrow(
      "selected movie",
    );
    expect(() =>
      validateTask({ ...input(), openPaymentGateway: "true" }),
    ).toThrow("openPaymentGateway");
  });
  it("pins a live-selected mission to the exact show ID", async () => {
    const config = { ...input(), targetShowId: "demo-show-1" };
    const results = await new DiscoveryService(
      new DemoAdapter(),
      new DemoAdapter(),
    ).search(config, new AbortController().signal);
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every((result) => result.showtime.id === "demo-show-1"),
    ).toBe(true);
    await expect(
      new DiscoveryService().search(
        { ...config, targetShowId: "not-published" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("selected show");
  });
  it("explains a selected show conflicting with branch or time filters", async () => {
    const discovery = new DiscoveryService(
      new DemoAdapter(),
      new DemoAdapter(),
    );
    await expect(
      discovery.search(
        {
          ...input(),
          targetShowId: "demo-show-0",
          locationIds: ["sony-square"],
          preferredTimes: [],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("branch filter excludes");
    await expect(
      discovery.search(
        { ...input(), targetShowId: "demo-show-0" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("time filter excludes");
  });
  it("never merges explicitly disconnected seats into a together candidate", () => {
    const seats = [1, 2].map((number) => ({
      id: `B${number}`,
      row: "B",
      number,
      label: `B${number}`,
      status: "available" as const,
      adjacentSeatIds: [] as string[],
      x: number * 25,
      y: 0,
    }));
    const map: SeatMap = {
      rows: new Map([["B", seats]]),
      blocks: [],
      cinemaId: "demo",
      movieId: "m",
      showtimeId: "s",
      hallName: "Hall",
      screenType: "standard",
      totalSeats: 2,
      availableSeats: 2,
      fetchedAt: new Date(),
    };
    expect(eligibleBlocks(map, input())).toEqual([]);
    expect(
      eligibleBlocks(map, { ...input(), keepTogether: false }),
    ).toHaveLength(1);
  });
  it("carries date, time and row constraints through discovery", async () => {
    const results = await new DiscoveryService(
      new DemoAdapter(),
      new DemoAdapter(),
    ).search(input(), new AbortController().signal);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.showtime.date).toBe("2099-12-01");
      expect(result.showtime.time < "17:00").toBe(true);
      expect(["B", "C", "D"]).toContain(result.seatBlock.row);
      expect(result.seatLabels).toHaveLength(2);
      expect(result.simulated).toBe(true);
    }
  });
  it("does not relax a branch that has no matches", async () => {
    const config = input();
    config.locationIds = ["not-a-branch"];
    const results = await new DiscoveryService().search(
      config,
      new AbortController().signal,
    );
    expect(results).toEqual([]);
  });
  it("rejects incomplete groups and requires opt-in for splitting", () => {
    const rows = new Map(
      ["B", "C"].map((row) => [
        row,
        [
          {
            id: row + "1",
            row,
            number: 1,
            label: row + "1",
            status: "available" as const,
          },
        ],
      ]),
    );
    const map: SeatMap = {
      rows,
      blocks: [],
      cinemaId: "demo",
      movieId: "m",
      showtimeId: "s",
      hallName: "hall",
      screenType: "standard",
      totalSeats: 2,
      availableSeats: 2,
      fetchedAt: new Date(),
    };
    expect(eligibleBlocks(map, input())).toEqual([]);
    expect(
      eligibleBlocks(map, { ...input(), keepTogether: false }),
    ).toHaveLength(1);
    expect(
      eligibleBlocks(map, {
        ...input(),
        requiredSeats: 3,
        keepTogether: false,
      }),
    ).toEqual([]);
  });
});
