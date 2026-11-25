import { describe, expect, it } from "vitest";
import { LiveInventoryService, ticketStatus } from "./live-inventory";
import { LiveStarCineplexAdapter } from "./live-adapter";
import { inventoryFixture } from "./testing/live-fixture";
import type { LiveShow } from "./live-types";

const now = Date.parse("2026-11-16T06:00:00Z");
const service = (fixture = inventoryFixture()) =>
  new LiveInventoryService(fixture.fetcher, { now: () => now });
describe("live Star Cineplex inventory", () => {
  it("joins public catalog, branches, real hall metadata and provider counts", async () => {
    const fixture = inventoryFixture();
    const inventory = service(fixture);
    await inventory.refresh();
    const data = inventory.snapshot();
    expect(data.status).toBe("live");
    expect(data.movies.map((m) => m.title)).toEqual([
      "Running Film",
      "Upcoming Film",
    ]);
    expect(data.branches).toHaveLength(2);
    expect(data.counts).toEqual({
      nowShowingMovies: 1,
      openShows: 1,
      hallsWithOpenTickets: 1,
      reportedAvailableSeats: 8,
    });
    expect(data.shows.find((show) => show.id === "show-open")).toMatchObject({
      hall: { name: "Hall 1" },
      availableSeats: 8,
      price: 500,
      ticketStatus: "open",
      onlineSalesCloseAt: "2026-11-17T07:00:00.000Z",
    });
    expect(data.halls).toHaveLength(2);
    expect(data.changes).toEqual([]);
    expect(
      fixture.requests.some((url) => url.includes("/catalog/api/halls")),
    ).toBe(false);
  });
  it("keeps zero seats sold out and distinguishes closed, scheduled and counter-only sales", async () => {
    const inventory = service();
    await inventory.refresh();
    const byId = new Map(
      inventory.snapshot().shows.map((show) => [show.id, show]),
    );
    expect(byId.get("show-sold")).toMatchObject({
      ticketStatus: "sold_out",
      availableSeats: 0,
    });
    expect(byId.get("show-closed")?.ticketStatus).toBe("closed");
    expect(byId.get("show-later")?.ticketStatus).toBe("not_open");
    expect(byId.get("show-counter")?.ticketStatus).toBe("counter_only");
  });
  it("expires ticket sales at the provider effective cutoff without another fetch", async () => {
    let clock = now;
    const fixture = inventoryFixture();
    const inventory = new LiveInventoryService(fixture.fetcher, {
      now: () => clock,
    });
    await inventory.refresh();
    clock = Date.parse("2026-11-17T07:00:00Z");
    expect(
      inventory.snapshot().shows.find((s) => s.id === "show-open")
        ?.ticketStatus,
    ).toBe("closed");
    expect(inventory.snapshot().counts.openShows).toBe(0);
  });
  it("never guesses availability or sales channel when a required value is missing", async () => {
    const fixture = inventoryFixture();
    (fixture.shows[0] as { availableSeats?: number }).availableSeats =
      undefined;
    const inventory = service(fixture);
    await inventory.refresh();
    expect(inventory.snapshot().shows[0]).toMatchObject({
      availableKnown: false,
      ticketStatus: "unknown",
    });
    const show = inventory.snapshot().shows.find((s) => s.id === "show-sold")!;
    expect(
      ticketStatus({ ...show, salesChannel: "", availableSeats: 10 }, now),
    ).toBe("unknown");
    expect(ticketStatus({ ...show, startsAt: undefined }, now)).toBe("unknown");
    expect(ticketStatus({ ...show, startsAt: "not-a-date" }, now)).toBe(
      "unknown",
    );
    expect(
      ticketStatus({ ...show, onlineSalesCloseAt: "not-a-date" }, now),
    ).toBe("unknown");
  });
  it("marks data stale on failure, preserves last-success counts and refuses stale bot discovery", async () => {
    const fixture = inventoryFixture();
    let fail = false;
    const inventory = new LiveInventoryService(
      async (url, signal) => {
        if (fail) throw new Error("Provider HTTP 503");
        return fixture.fetcher(url, signal);
      },
      { now: () => now },
    );
    await inventory.refresh();
    fail = true;
    await expect(inventory.refresh()).rejects.toThrow("503");
    expect(inventory.snapshot()).toMatchObject({
      status: "stale",
      error: "Provider HTTP 503",
      counts: { reportedAvailableSeats: 8 },
    });
    await expect(
      new LiveStarCineplexAdapter(inventory).searchMovies("Running"),
    ).rejects.toThrow("503");
    fail = false;
    await inventory.refresh();
    expect(inventory.snapshot().status).toBe("live");
    expect(inventory.snapshot().error).toBeUndefined();
  });
  it("reports a first-load error without substituting demo listings", async () => {
    const inventory = new LiveInventoryService(async () => {
      throw new Error("Offline");
    });
    await expect(inventory.refresh()).rejects.toThrow("Offline");
    expect(inventory.snapshot()).toMatchObject({
      status: "error",
      movies: [],
      shows: [],
      halls: [],
    });
  });
  it("deduplicates refreshes and reuses public hall-name metadata", async () => {
    const fixture = inventoryFixture();
    const inventory = service(fixture);
    await Promise.all([
      inventory.refresh(),
      inventory.refresh(),
      inventory.fresh(),
    ]);
    expect(
      fixture.requests.filter((url) => url.includes("/inventory/api/shows")),
    ).toHaveLength(1);
    await inventory.refresh();
    expect(
      fixture.requests.filter((url) => url.includes("/seat-maps/")),
    ).toHaveLength(2);
  });
  it("only reports newly opened and reopened sales after comparing successful snapshots", async () => {
    const fixture = inventoryFixture();
    const inventory = service(fixture);
    await inventory.refresh();
    expect(inventory.snapshot().changes).toEqual([]);
    fixture.shows.find((s) => s.id === "show-later")!.status = "Selling";
    fixture.shows.find((s) => s.id === "show-sold")!.availableSeats = 3;
    await inventory.refresh();
    expect(
      inventory
        .snapshot()
        .changes.map((change) => [change.showId, change.type]),
    ).toEqual([
      ["show-sold", "tickets_reopened"],
      ["show-later", "sales_opened"],
    ]);
    expect(inventory.snapshot().counts.openShows).toBe(3);
    await inventory.refresh();
    expect(inventory.snapshot().changes).toHaveLength(2);
  });
  it("continues with explicit hall identifiers when optional public names are unavailable", async () => {
    const fixture = inventoryFixture();
    const inventory = new LiveInventoryService(
      async (url, signal) => {
        if (url.includes("/seat-maps/"))
          throw new Error("Metadata unavailable");
        return fixture.fetcher(url, signal);
      },
      { now: () => now },
    );
    await inventory.refresh();
    const data = inventory.snapshot();
    expect(data.status).toBe("live");
    expect(data.warnings).toHaveLength(2);
    expect(data.shows[0].hallNameResolved).toBe(false);
    expect(data.shows[0].hall.name).toContain("hall-one");
  });
  it("rejects a broken provider response instead of silently reporting an empty cinema", async () => {
    const fixture = inventoryFixture();
    const inventory = new LiveInventoryService(async (url, signal) =>
      url.includes("/api/shows")
        ? { error: "bad schema" }
        : fixture.fetcher(url, signal),
    );
    await expect(inventory.refresh()).rejects.toThrow("Unexpected shows");
    expect(inventory.snapshot().status).toBe("error");
  });
  it("provides live bot searches only with bookable shows and resolved hall names", async () => {
    const inventory = service();
    const adapter = new LiveStarCineplexAdapter(inventory);
    const movies = await adapter.searchMovies("Running");
    const shows = await adapter.getShowtimes(movies[0], { date: "2026-11-17" });
    expect(shows.map((s) => s.id)).toEqual(["show-open"]);
    expect(shows[0].hall.name).toBe("Hall 1");
    expect(
      await adapter.getShowtimes(movies[0], {
        date: "2026-11-17",
        minAvailableSeats: 9,
      }),
    ).toEqual([]);
  });
  it("classifies a started show separately from an open future show", () => {
    const facts: Pick<
      LiveShow,
      | "sourceStatus"
      | "salesChannel"
      | "startsAt"
      | "onlineSalesCloseAt"
      | "availableKnown"
      | "availableSeats"
      | "branchActive"
    > = {
      sourceStatus: "Selling",
      salesChannel: "Both",
      startsAt: "2026-11-16T05:00:00Z",
      onlineSalesCloseAt: "2026-11-16T04:00:00Z",
      availableKnown: true,
      availableSeats: 8,
      branchActive: true,
    };
    expect(ticketStatus(facts, now)).toBe("started");
    expect(
      ticketStatus(
        {
          ...facts,
          startsAt: "2026-11-17T05:00:00Z",
          onlineSalesCloseAt: "2026-11-17T04:00:00Z",
          branchActive: false,
        },
        now,
      ),
    ).toBe("closed");
  });
  it("negative-caches failed hall metadata lookups and unblocks aborted fresh() callers immediately", async () => {
    const fixture = inventoryFixture();
    let seatMapRequests = 0;
    const inventory = new LiveInventoryService(
      async (url, signal) => {
        if (url.includes("/seat-maps/")) {
          seatMapRequests++;
          throw new Error("Metadata 404");
        }
        return fixture.fetcher(url, signal);
      },
      { now: () => now },
    );
    await inventory.refresh();
    expect(seatMapRequests).toBe(2);
    await inventory.refresh();
    // Second 1s tick must not re-fetch failing seat-map metadata within negative-cache window
    expect(seatMapRequests).toBe(2);
    expect(inventory.snapshot().warnings).toHaveLength(2);

    // Aborting a caller's signal unblocks fresh() immediately
    const slowInventory = new LiveInventoryService(
      (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      { now: () => now },
    );
    const controller = new AbortController();
    const pending = slowInventory.fresh(0, controller.signal);
    controller.abort(new Error("Task stopped"));
    await expect(pending).rejects.toThrow("Task stopped");
    await slowInventory.stop();
  });
  it("resolves live monitor targets for upcoming shows while returning undefined for unannounced movies", async () => {
    const fixture = inventoryFixture();
    fixture.movies.push({
      id: "movie-unannounced",
      title: { en: "Unannounced Film" },
      isNowShowing: false,
      isUpcoming: true,
      organizerOrgId: fixture.movies[0].organizerOrgId,
      formats: ["2D"],
      duration: 110,
      language: "en",
    });
    const inventory = service(fixture);
    await inventory.refresh();
    const adapter = new LiveStarCineplexAdapter(inventory);
    const upcomingTarget = adapter.resolveMonitorTarget({
      targetMovieId: "movie-upcoming",
      movieName: "Upcoming Film",
      targetDate: "2026-11-17",
      requiredSeats: 2,
      mode: "monitor",
      source: "live",
      intervalSeconds: 1,
      allowedRows: [],
      preferredTimes: [],
      locationIds: [],
      preferredCategory: "any",
      rowPreference: "center",
      strategy: "best",
      keepTogether: true,
      autoReserve: true,
    });
    expect(upcomingTarget?.show?.id).toBe("show-later");
    expect(upcomingTarget?.url).toContain("/shows/show-later/seats");

    const unannouncedTarget = adapter.resolveMonitorTarget({
      targetMovieId: "movie-unannounced",
      movieName: "Unannounced Film",
      targetDate: "2026-11-17",
      requiredSeats: 2,
      mode: "monitor",
      source: "live",
      intervalSeconds: 1,
      allowedRows: [],
      preferredTimes: [],
      locationIds: [],
      preferredCategory: "any",
      rowPreference: "center",
      strategy: "best",
      keepTogether: true,
      autoReserve: true,
    });
    expect(unannouncedTarget).toBeUndefined();
  });
});
