import { describe, expect, it } from "vitest";
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
