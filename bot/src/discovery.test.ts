import { describe, expect, it, vi } from "vitest";
import { DiscoveryService, eligibleBlocks } from "./discovery";
import {
  DemoAdapter,
  StarCineplexAdapter,
  detectSeatBlocks,
  rankResults,
  type SeatMap,
  type Showtime,
} from "../../packages/core/src";
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
  it("keeps centerScore in [0, 1] using full row width and ranks cheaper shows higher", () => {
    const rowSeats = Array.from({ length: 12 }, (_, idx) => ({
      id: `B${idx + 1}`,
      row: "B",
      number: idx + 1,
      label: `B${idx + 1}`,
      status:
        idx + 1 === 6 || idx + 1 === 7 || idx + 1 === 10 || idx + 1 === 11
          ? ("available" as const)
          : ("occupied" as const),
    }));
    const map: SeatMap = {
      rows: new Map([["B", rowSeats]]),
      blocks: [],
      cinemaId: "demo",
      movieId: "m",
      showtimeId: "s",
      hallName: "Hall",
      screenType: "standard",
      totalSeats: 12,
      availableSeats: 4,
      fetchedAt: new Date(),
    };
    const blocks = detectSeatBlocks(map, { requiredSeats: 2 });
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.centerScore).toBeGreaterThanOrEqual(0);
      expect(block.centerScore).toBeLessThanOrEqual(1);
    }
    const centerBlock = blocks.find((b) => b.startSeat === "B6")!;
    const edgeBlock = blocks.find((b) => b.startSeat === "B10")!;
    expect(centerBlock.centerScore).toBeGreaterThan(edgeBlock.centerScore);

    const baseShow: Showtime = {
      id: "s1",
      movie: { id: "m", title: "Film" },
      cinema: { id: "star-cineplex", name: "Star Cineplex", location: "Dhaka" },
      hall: { id: "h1", name: "Hall 1", screenType: "2d", capacity: 12 },
      date: "2099-12-01",
      time: "18:00",
      screenType: "2d",
      price: 500,
      currency: "BDT",
      availableSeats: 4,
      totalSeats: 12,
      bookingUrl: "https://kichole.com/shows/s1/seats",
    };
    const ranked = rankResults([
      { showtime: { ...baseShow, id: "expensive", price: 1200 }, seatBlock: centerBlock },
      { showtime: { ...baseShow, id: "cheap", price: 450 }, seatBlock: centerBlock },
    ]);
    expect(ranked[0].showtime.id).toBe("cheap");
    expect(ranked[0].priceScore).toBeGreaterThan(ranked[1].priceScore);

    // Prime center rows (C/D/E) must strictly outscore back rows (M) and front row (A) on open rows
    const fullRow = (row: string) =>
      detectSeatBlocks(
        {
          ...map,
          rows: new Map([
            [
              row,
              Array.from({ length: 12 }, (_, idx) => ({
                id: `${row}${idx + 1}`,
                row,
                number: idx + 1,
                label: `${row}${idx + 1}`,
                status: "available" as const,
              })),
            ],
          ]),
        },
        { requiredSeats: 10 },
      )[0];
    const byRow = rankResults(
      ["M", "A", "G", "B", "D"].map((row) => ({
        showtime: baseShow,
        seatBlock: fullRow(row),
      })),
    );
    expect(byRow.map((r) => r.seatBlock.row)).toEqual(["D", "B", "G", "M", "A"]);

    // Live arm-grouped rows (A:0, M:0, D:0) must still pick prime row D first under center preference
    const armMap: SeatMap = {
      ...map,
      rows: new Map(
        ["A", "M", "D"].map((row) => [
          `${row}:0`,
          Array.from({ length: 12 }, (_, idx) => ({
            id: `${row}${idx + 1}`,
            row,
            number: idx + 1,
            label: `${row}${idx + 1}`,
            status: "available" as const,
          })),
        ]),
      ),
    };
    const chosen = eligibleBlocks(armMap, {
      ...input(),
      allowedRows: [],
      requiredSeats: 10,
      rowPreference: "center",
    });
    expect(chosen[0].row).toBe("D:0");
  });
  it("never synthesizes fake occupied seats or fails open in StarCineplexAdapter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/seat-maps/")) {
        return new Response(
          JSON.stringify({
            sections: [
              {
                name: "Main",
                rows: [
                  {
                    rowLabel: "J",
                    seatCount: 4,
                    startColumn: 1,
                    rowIndex: 0,
                    seats: [
                      { label: "J1", column: 1 },
                      { label: "J2", column: 2 },
                      // Aisle gap at column 3
                      { label: "J3", column: 4 },
                      { label: "J4", column: 5 },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Service Unavailable", { status: 503 });
    });
    try {
      const adapter = new StarCineplexAdapter();
      const show: Showtime = {
        id: "show-1",
        movie: { id: "m1", title: "Film" },
        cinema: { id: "star-cineplex", name: "Star Cineplex", location: "Dhaka" },
        hall: { id: "h1", name: "Hall 1", screenType: "2d", capacity: 4 },
        date: "2099-12-01",
        time: "18:00",
        screenType: "2d",
        price: 500,
        currency: "BDT",
        availableSeats: 0,
        totalSeats: 4,
        seatMapId: "map-j",
        bookingUrl: "https://kichole.com/shows/show-1/seats",
      };
      const soldOut = await adapter.getSeatMap(show);
      expect(soldOut.availableSeats).toBe(0);
      expect(
        soldOut.rows.get("J")?.every((seat) => seat.status === "occupied"),
      ).toBe(true);

      const open = await adapter.getSeatMap({ ...show, availableSeats: 2 });
      expect(open.availableSeats).toBe(2);
      const jSeats = open.rows.get("J")!;
      expect(jSeats.every((seat) => seat.status === "available")).toBe(true);
      // Column gap between J2 (col 2) and J3 (col 4) must split blocks
      const blocks = detectSeatBlocks(open, { requiredSeats: 2 });
      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => b.startSeat).sort()).toEqual(["J1", "J3"]);

      const recheck = await adapter.recheckAvailability("show-1", 2);
      expect(recheck).toEqual({ available: false, remainingSeats: 0 });
    } finally {
      fetchMock.mockRestore();
    }
  });
});
