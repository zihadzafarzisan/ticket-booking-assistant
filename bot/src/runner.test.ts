import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { once } from "node:events";
import {
  BotRunner,
  type BrowserPort,
  type DiscoveryPort,
} from "./runner";
import { TaskStore } from "./store";
import { createBotServer } from "./server";
import {
  validateTask,
  type Candidate,
  type Handoff,
  type PageRefreshResult,
  type TaskInput,
} from "./contracts";
import {
  createSeatBlock,
  scoreResult,
  DEFAULT_WEIGHTS,
} from "../../packages/core/src";
import { allowedBookingUrl } from "./browser";
import { LiveInventoryService } from "./live-inventory";
import { inventoryFixture } from "./testing/live-fixture";

const input = (extra: Partial<TaskInput> = {}): TaskInput => ({
  movieName: "Test movie",
  targetDate: "2099-12-01",
  requiredSeats: 2,
  mode: "instant",
  source: "live",
  intervalSeconds: 5,
  allowedRows: ["B", "C"],
  preferredTimes: [],
  locationIds: [],
  preferredCategory: "any",
  rowPreference: "center",
  strategy: "best",
  keepTogether: true,
  autoReserve: true,
  ...extra,
});
function candidate(): Candidate {
  const seats = [1, 2].map((number) => ({
    id: `B${number}`,
    row: "B",
    number,
    label: `B${number}`,
    status: "available" as const,
  }));
  const showtime = {
    id: "show-1",
    movie: { id: "movie-1", title: "Test movie" },
    cinema: { id: "star-cineplex", name: "Star Cineplex", location: "Dhaka" },
    hall: {
      id: "h1",
      name: "Hall 1",
      screenType: "standard" as const,
      capacity: 10,
    },
    date: "2099-12-01",
    time: "18:00",
    screenType: "standard" as const,
    price: 500,
    currency: "BDT",
    availableSeats: 2,
    totalSeats: 10,
    bookingUrl: "https://kichole.com/shows/show-1/seats",
  };
  return {
    ...scoreResult(showtime, createSeatBlock("B", seats), DEFAULT_WEIGHTS),
    key: "show-1:block",
    seatLabels: ["B1", "B2"],
    simulated: false,
  };
}
const roots: string[] = [];
const runners: BotRunner[] = [];
async function setup(
  search = vi.fn(async (_input: TaskInput, _signal: AbortSignal) => [
    candidate(),
  ]),
  explainEmptyResult?: (
    input: TaskInput,
  ) => Promise<{ title: string; message: string } | undefined>,
) {
  const root = resolve(".bot-test-data");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, "unit-"));
  roots.push(directory);
  const store = new TaskStore(resolve(directory, "tasks.json"));
  const browser = {
    status: () => ({ connected: false, pages: 0, headless: true }),
    openSession: vi.fn(async () => {}),
    reserve: vi.fn(async () => ({
      status: "awaiting_payment" as const,
      message: "Verified fixture checkout",
      url: "https://kichole.com/checkout",
      selectedSeats: ["B1", "B2"],
    })),
    cancel: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const runner = new BotRunner(store, { search, explainEmptyResult }, browser);
  runners.push(runner);
  await runner.init();
  return { runner, store, browser, search };
}
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.shutdown();
  for (const directory of roots.splice(0)) {
    if (!directory.startsWith(resolve(".bot-test-data") + sep))
      throw new Error("Unexpected cleanup path.");
    await rm(directory, { recursive: true, force: true });
  }
});

describe("task validation and browser boundaries", () => {
  it("requires a real date and an exact bounded count", () => {
    expect(() => validateTask(input({ targetDate: "2099-02-31" }))).toThrow(
      "valid show date",
    );
    expect(() => validateTask(input({ requiredSeats: 1.5 }))).toThrow(
      "between 1 and 50",
    );
    expect(() => validateTask(input({ intervalSeconds: 0 }))).toThrow(
      "Polling interval",
    );
    expect(() => validateTask(input({ targetDate: "2020-01-01" }))).toThrow(
      "past",
    );
  });
  it("requires timezone-aware schedules and typed booleans", () => {
    expect(() =>
      validateTask(input({ scheduledAt: "2099-12-01T18:00" })),
    ).toThrow("timezone");
    expect(() => validateTask({ ...input(), autoReserve: "false" })).toThrow(
      "autoReserve",
    );
    expect(
      validateTask(input({ scheduledAt: "2099-12-01T18:00:00+06:00" }))
        .scheduledAt,
    ).toContain("+06:00");
  });
  it("only opens supported HTTPS cinema hosts", () => {
    expect(allowedBookingUrl("https://kichole.com/shows/123/seats")).toContain(
      "kichole.com",
    );
    for (const url of [
      "http://kichole.com/",
      "https://kichole.com.evil.example/",
      "https://user:pass@kichole.com/",
      "file:///C:/Users",
    ])
      expect(() => allowedBookingUrl(url)).toThrow();
  });
});
describe("durable bot execution", () => {
  it("persists a specific unavailable-show reason without opening the browser", async () => {
    const reason = {
      title: "Waiting for show announcements",
      message:
        "Cineplex has not published shows for this movie. There is no seat page to open yet.",
    };
    const { runner, store, browser } = await setup(
      vi.fn(async () => []),
      async () => reason,
    );
    const task = await runner.create(input({ mode: "instant" }));
    await runner.check(task.id);
    expect(runner.get(task.id)).toMatchObject({
      status: "awaiting_user",
      waitReason: reason,
    });
    expect(runner.get(task.id).logs[0].message).toBe(reason.message);
    expect(browser.reserve).not.toHaveBeenCalled();
    expect((await store.load())[0].waitReason).toEqual(reason);
    await runner.update(task.id, input({ mode: "monitor" }));
    await runner.check(task.id);
    expect(runner.get(task.id)).toMatchObject({
      status: "monitoring",
      waitReason: reason,
    });
    expect(browser.reserve).not.toHaveBeenCalled();
  });
  it("updates an idle mission in place and retries with the corrected search", async () => {
    const { runner, store, browser, search } = await setup();
    const task = await runner.create(
      input({ autoReserve: false, targetShowId: "old-show" }),
    );
    await runner.check(task.id);
    const updated = await runner.update(
      task.id,
      input({ movieName: "Corrected movie", autoReserve: false }),
    );
    expect(updated.id).toBe(task.id);
    expect(updated.results).toEqual([]);
    expect(updated.input.targetShowId).toBeUndefined();
    await runner.check(task.id);
    expect(search).toHaveBeenCalledTimes(2);
    expect(runner.snapshot().tasks).toHaveLength(1);
    expect((await store.load())[0].input.movieName).toBe("Corrected movie");
    expect(browser.reserve).not.toHaveBeenCalled();
  });
  it("hands verified live results to the browser and persists the outcome", async () => {
    const { runner, store, browser } = await setup();
    const task = await runner.create(input());
    await runner.check(task.id);
    expect(browser.reserve).toHaveBeenCalledOnce();
    expect(runner.get(task.id).status).toBe("awaiting_payment");
    expect((await store.load())[0].results[0].handoff?.selectedSeats).toEqual([
      "B1",
      "B2",
    ]);
  });
  it("never books a demo result", async () => {
    const { runner, browser } = await setup();
    const task = await runner.create(input({ source: "demo" }));
    await runner.check(task.id);
    expect(browser.reserve).not.toHaveBeenCalled();
    expect(runner.get(task.id).status).toBe("awaiting_user");
    await runner.reserve(task.id);
    expect(browser.reserve).not.toHaveBeenCalled();
    expect(runner.get(task.id).error).toContain("Demo");
  });
  it("a stop during a check prevents later browser actions", async () => {
    let finish!: (results: Candidate[]) => void;
    const search = vi.fn(
      () =>
        new Promise<Candidate[]>((resolve) => {
          finish = resolve;
        }),
    );
    const { runner, browser } = await setup(search);
    const task = await runner.create(input());
    const checking = runner.check(task.id);
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    await runner.stop(task.id);
    finish([candidate()]);
    await checking;
    expect(runner.get(task.id).status).toBe("stopped");
    expect(browser.reserve).not.toHaveBeenCalled();
  });
  it("scheduled tasks do not check before their start time", async () => {
    const { runner, search } = await setup();
    const task = await runner.create(
      input({ mode: "monitor", scheduledAt: "2099-11-30T18:00:00Z" }),
    );
    await runner.check(task.id);
    expect(search).not.toHaveBeenCalled();
    expect(runner.get(task.id).status).toBe("scheduled");
  });
  it("network errors keep monitors alive with a visible error", async () => {
    const search = vi.fn(async () => {
      throw new Error("Cinema unavailable");
    });
    const { runner } = await setup(search);
    const task = await runner.create(input({ mode: "monitor" }));
    await runner.check(task.id);
    expect(runner.get(task.id).status).toBe("monitoring");
    expect(runner.get(task.id).error).toBe("Cinema unavailable");
    expect(runner.get(task.id).nextCheckAt).toBeTruthy();
  });
  it("restores monitor state from the saved store", async () => {
    const { runner, store, browser } = await setup(vi.fn(async () => []));
    const task = await runner.create(input({ mode: "monitor" }));
    await runner.check(task.id);
    await runner.shutdown();
    const restored = new BotRunner(
      store,
      { search: vi.fn(async () => []) },
      browser,
    );
    runners.push(restored);
    await restored.init();
    expect(restored.get(task.id).checks).toBe(1);
    expect(restored.get(task.id).status).toBe("monitoring");
    expect(restored.get(task.id).nextCheckAt).toBeTruthy();
  });
  it("serializes concurrent writes into readable state", async () => {
    const { store } = await setup();
    await Promise.all([store.save([]), store.save([]), store.save([])]);
    expect(await store.load()).toEqual([]);
  });
});
describe("local HTTP API", () => {
  it("serves and streams live inventory and accepts a protected refresh request", async () => {
    const { runner } = await setup();
    const fixture = inventoryFixture();
    const inventory = new LiveInventoryService(fixture.fetcher, {
      now: () => Date.parse("2026-11-16T06:00:00Z"),
    });
    await inventory.refresh();
    const { server, closeEvents } = createBotServer(runner, { inventory });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${url}/api/live`);
      expect(response.status).toBe(200);
      expect((await response.json()).counts.openShows).toBe(1);
      const events = await fetch(`${url}/api/events`, {
        signal: AbortSignal.timeout(5000),
      });
      const reader = events.body!.getReader();
      let content = "";
      while (!content.includes("event: inventory")) {
        const next = await reader.read();
        if (next.done) break;
        content += new TextDecoder().decode(next.value);
      }
      expect(content).toContain("event: inventory");
      fixture.shows[1].availableSeats = 2;
      const refreshed = await fetch(`${url}/api/live/refresh`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ticket-bot": "dashboard",
        },
        body: "{}",
      });
      expect(refreshed.status).toBe(202);
      await vi.waitFor(() =>
        expect(inventory.snapshot().counts.openShows).toBe(2),
      );
      content = "";
      while (!content.includes('"openShows":2')) {
        const next = await reader.read();
        if (next.done) break;
        content += new TextDecoder().decode(next.value);
      }
      expect(content).toContain('"openShows":2');
      await reader.cancel();
      expect(
        (
          await fetch(`${url}/api/live/refresh`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
    } finally {
      closeEvents();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await inventory.stop();
    }
  });
  it("creates tasks, streams snapshots, rejects foreign origins and serves the dashboard", async () => {
    const { runner, store } = await setup();
    await writeFile(
      resolve(dirname(store.filename), "index.html"),
      "<title>Cinebot fixture</title>",
    );
    const { server, closeEvents } = createBotServer(runner, {
      staticDirectory: dirname(store.filename),
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const url = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${url}/api/health`)).status).toBe(200);
      const response = await fetch(`${url}/api/tasks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ticket-bot": "dashboard",
        },
        body: JSON.stringify(input({ autoReserve: false })),
      });
      expect(response.status).toBe(201);
      const state = await (await fetch(`${url}/api/state`)).json();
      expect(state.tasks).toHaveLength(1);
      const events = await fetch(`${url}/api/events`);
      const reader = events.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain(
        "event: snapshot",
      );
      await reader.cancel();
      expect(
        (
          await fetch(`${url}/api/tasks`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-ticket-bot": "dashboard",
              origin: "https://foreign.example",
            },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${url}/api/tasks`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${url}/api/tasks`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-ticket-bot": "dashboard",
            },
            body: "{}",
          })
        ).status,
      ).toBe(400);
      const home = await fetch(url);
      expect(home.status).toBe(200);
      expect(await home.text()).toContain("Cinebot");
    } finally {
      closeEvents();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

describe("1s drop sniper, exact seats, live page refresh and telemetry", () => {
  it("normalizes and validates targetSeats, exactSeatsOnly, refreshBrowserPage, preferredHall and preferredShowtime", () => {
    const validated = validateTask({
      ...input({ mode: "monitor", source: "live" }),
      requiredSeats: undefined,
      targetSeats: [" e-05 ", "E6", "e5"],
      exactSeatsOnly: true,
      preferredHall: "Hall 1",
      preferredShowtime: "19:30",
    });
    expect(validated.targetSeats).toEqual(["E5", "E6"]);
    expect(validated.requiredSeats).toBe(2);
    expect(validated.exactSeatsOnly).toBe(true);
    expect(validated.refreshBrowserPage).toBe(true);
    expect(validated.preferredHall).toBe("Hall 1");
    expect(validated.preferredShowtime).toBe("19:30");

    expect(() =>
      validateTask({ ...input(), targetSeats: ["not-a-seat"] }),
    ).toThrow("Invalid seat label");
    expect(() =>
      validateTask({
        ...input({ requiredSeats: 3 }),
        targetSeats: ["E5", "E6"],
        exactSeatsOnly: true,
      }),
    ).toThrow("exact seats");
    expect(() =>
      validateTask({ ...input(), preferredShowtime: "25:99" }),
    ).toThrow("HH:MM");
    expect(() =>
      validateTask({ ...input(), refreshBrowserPage: "yes" }),
    ).toThrow("refreshBrowserPage");
  });

  it("refreshes the Cineplex page every tick when a show URL exists and triggers immediate reservation on DOM drop", async () => {
    const root = resolve(".bot-test-data");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(resolve(root, "sniper-"));
    roots.push(directory);
    const store = new TaskStore(resolve(directory, "tasks.json"));
    let dropNow = false;
    const targetShow = candidate().showtime;
    const refreshPage = vi.fn(
      async (): Promise<PageRefreshResult> => ({
        refreshedAt: new Date().toISOString(),
        latencyMs: 35,
        url: targetShow.bookingUrl,
        pageReady: true,
        dropDetected: dropNow,
        availableSeatCount: dropNow ? 10 : 0,
        availableTargetSeats: dropNow ? ["E5", "E6"] : [],
      }),
    );
    const reserve = vi.fn(
      async (): Promise<Handoff> => ({
        status: "awaiting_payment",
        message: "Exact seats E5, E6 verified and checkout opened.",
        url: "https://kichole.com/checkout",
        selectedSeats: ["E5", "E6"],
      }),
    );
    const browser: BrowserPort = {
      status: () => ({ connected: true, pages: 1, headless: true }),
      openSession: vi.fn(async () => {}),
      refreshPage,
      reserve,
      cancel: vi.fn(async () => {}),
      focus: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const discovery: DiscoveryPort = {
      search: vi.fn(async () => []),
      resolveMonitorTarget: vi.fn(() => ({
        url: targetShow.bookingUrl,
        show: targetShow,
      })),
    };
    const runner = new BotRunner(store, discovery, browser);
    runners.push(runner);
    await runner.init();

    const task = await runner.create(
      input({
        mode: "monitor",
        intervalSeconds: 1,
        targetSeats: ["E5", "E6"],
        exactSeatsOnly: true,
        refreshBrowserPage: true,
      }),
    );
    // Tick 1: not open yet -> refreshes page, updates telemetry, stays monitoring
    await runner.check(task.id);
    const afterTick1 = runner.get(task.id);
    expect(afterTick1.status).toBe("monitoring");
    expect(afterTick1.pageRefreshCount).toBe(1);
    expect(afterTick1.pageRefreshState).toBe("refreshing");
    expect(afterTick1.lastPageRefreshAt).toBeTruthy();
    expect(afterTick1.lastCheckLatencyMs).toBeGreaterThanOrEqual(0);
    expect(afterTick1.consecutiveErrors).toBe(0);
    expect(reserve).not.toHaveBeenCalled();

    // Tick 2: DOM detects ticket drop before API catches up -> immediate reserve!
    dropNow = true;
    await runner.check(task.id);
    const afterDrop = runner.get(task.id);
    expect(refreshPage).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledOnce();
    expect(afterDrop.status).toBe("awaiting_payment");
    expect(afterDrop.dropDetectedAt).toBeTruthy();
    expect(afterDrop.pageRefreshState).toBe("handoff");
    expect(afterDrop.results[0].handoff?.selectedSeats).toEqual(["E5", "E6"]);

    // Completing an awaiting_payment task must NOT close the user's checkout page
    await runner.complete(task.id);
    expect(browser.cancel).not.toHaveBeenCalled();
    expect(runner.get(task.id).status).toBe("completed");
  });

  it("downgrades awaiting_payment if acquired seats violate exactSeatsOnly or requiredSeats", async () => {
    const { runner, browser } = await setup();
    browser.reserve.mockResolvedValueOnce({
      status: "awaiting_payment",
      message: "Wrong seats returned",
      url: "https://kichole.com/checkout",
      selectedSeats: ["B1", "B2"],
    });
    const task = await runner.create(
      input({
        mode: "instant",
        targetSeats: ["E5", "E6"],
        exactSeatsOnly: true,
      }),
    );
    await runner.check(task.id);
    expect(runner.get(task.id).status).toBe("awaiting_user");
    expect(runner.get(task.id).results[0].handoff?.message).toContain(
      "did not strictly match target seats",
    );
  });

  it("recovers cleanly into monitoring on retryable handoff (seat stolen mid-click) and transient network errors", async () => {
    const root = resolve(".bot-test-data");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(resolve(root, "retry-"));
    roots.push(directory);
    const store = new TaskStore(resolve(directory, "tasks.json"));
    let call = 0;
    const search = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error("Transient 503");
      return [candidate()];
    });
    let reserveCalls = 0;
    const browser: BrowserPort = {
      status: () => ({ connected: true, pages: 1, headless: true }),
      openSession: vi.fn(async () => {}),
      reserve: vi.fn(async (): Promise<Handoff> => {
        reserveCalls++;
        if (reserveCalls === 1) {
          return {
            status: "awaiting_user",
            message: "E6 was taken mid-click; E5 rolled back cleanly.",
            url: "https://kichole.com/shows/show-1/seats",
            selectedSeats: [],
            retryable: true,
            reason: "seat_stolen_mid_click",
          };
        }
        return {
          status: "awaiting_payment",
          message: "Seats verified on retry.",
          url: "https://kichole.com/checkout",
          selectedSeats: ["E5", "E6"],
        };
      }),
      cancel: vi.fn(async () => {}),
      focus: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const runner = new BotRunner(store, { search }, browser);
    runners.push(runner);
    await runner.init();

    const task = await runner.create(
      input({
        mode: "monitor",
        intervalSeconds: 1,
        targetSeats: ["E5", "E6"],
        exactSeatsOnly: true,
      }),
    );
    // Tick 1: transient error increments consecutiveErrors without stopping monitor
    await runner.check(task.id);
    expect(runner.get(task.id).status).toBe("monitoring");
    expect(runner.get(task.id).consecutiveErrors).toBe(1);

    // Tick 2: recovers from error, seat stolen mid-click -> retryable re-enters monitoring
    await runner.check(task.id);
    expect(runner.get(task.id).status).toBe("monitoring");
    expect(runner.get(task.id).consecutiveErrors).toBe(0);
    expect(runner.get(task.id).waitReason?.title).toBe(
      "Retrying seat selection",
    );

    // Tick 3: retry succeeds -> awaiting_payment
    await runner.check(task.id);
    expect(runner.get(task.id).status).toBe("awaiting_payment");
    expect(runner.get(task.id).results[0].handoff?.selectedSeats).toEqual([
      "E5",
      "E6",
    ]);
  });

  it("emits snapshot immediately on browser disconnect and cancels active page refresh on stop", async () => {
    const root = resolve(".bot-test-data");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(resolve(root, "disconnect-"));
    roots.push(directory);
    const store = new TaskStore(resolve(directory, "tasks.json"));
    let connected = true;
    const disconnectListeners = new Set<() => void>();
    const browser: BrowserPort = {
      status: () => ({ connected, pages: connected ? 1 : 0, headless: true }),
      onDisconnect: (fn) => {
        disconnectListeners.add(fn);
        return () => disconnectListeners.delete(fn);
      },
      openSession: vi.fn(async () => {
        connected = true;
      }),
      refreshPage: vi.fn(async () => ({
        refreshedAt: new Date().toISOString(),
        latencyMs: 12,
        url: "https://kichole.com/shows/show-1/seats",
        pageReady: true,
        dropDetected: false,
        availableSeatCount: 0,
        availableTargetSeats: [],
      })),
      reserve: vi.fn(async () => ({
        status: "awaiting_payment" as const,
        message: "ok",
        url: "https://kichole.com/checkout",
        selectedSeats: ["B1", "B2"],
      })),
      cancel: vi.fn(async () => {}),
      focus: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const runner = new BotRunner(
      store,
      {
        search: vi.fn(async () => []),
        resolveMonitorTarget: () => ({
          url: "https://kichole.com/shows/show-1/seats",
        }),
      },
      browser,
    );
    runners.push(runner);
    await runner.init();

    const snapshots: boolean[] = [];
    runner.subscribe(() => snapshots.push(runner.snapshot().browser.connected));
    expect(runner.snapshot().browser.connected).toBe(true);

    // Simulate external Chrome close
    connected = false;
    for (const fn of disconnectListeners) fn();
    expect(snapshots.at(-1)).toBe(false);
    expect(runner.snapshot().browser.connected).toBe(false);

    // Active monitor with pageRefreshCount > 0 cancels watch page on stop
    const task = await runner.create(
      input({ mode: "monitor", intervalSeconds: 1, refreshBrowserPage: true }),
    );
    await runner.check(task.id);
    expect(runner.get(task.id).pageRefreshCount).toBe(1);
    await runner.stop(task.id);
    expect(browser.cancel).toHaveBeenCalledWith(task.id);
    expect(runner.get(task.id).pageRefreshState).toBe("idle");
  });
});
