import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { BrowserDriver } from "../../bot/src/browser";
import { validateTask } from "../../bot/src/contracts";
import { DiscoveryService } from "../../bot/src/discovery";
import { LiveStarCineplexAdapter } from "../../bot/src/live-adapter";
import { LiveInventoryService } from "../../bot/src/live-inventory";
import { BotRunner } from "../../bot/src/runner";
import { createBotServer } from "../../bot/src/server";
import { TaskStore } from "../../bot/src/store";
import {
  createCineplexPageFixture,
  inventoryFixture,
  type CineplexPageFixtureOptions,
  type InventoryFixtureOptions,
} from "../../bot/src/testing/live-fixture";
import type { Showtime } from "../../packages/core/src";

const screenshotPath = (name: string) =>
  resolve(process.env.QA_SCREENSHOT_DIR || "test-results", name);

const futureDate = () =>
  new Date(Date.now() + 30 * 3600_000).toISOString().slice(0, 10);

async function startIsolatedStack(
  browser: import("@playwright/test").Browser,
  options: {
    inventoryOptions?: InventoryFixtureOptions;
    pageOptions?: CineplexPageFixtureOptions;
  } = {},
) {
  await mkdir(".bot-test-data", { recursive: true });
  const dataDir = await mkdtemp(resolve(".bot-test-data", "sniper-e2e-"));
  const date = futureDate();
  const invFixture = inventoryFixture(date, options.inventoryOptions);
  const pageFixture = createCineplexPageFixture({
    showId: "show-later",
    rows: ["D", "E", "F"],
    seatsPerRow: 10,
    ...options.pageOptions,
  });

  const cinemaContext = await browser.newContext();
  await pageFixture.attach(cinemaContext);

  const inventory = new LiveInventoryService(invFixture.fetcher);
  await inventory.refresh();

  const driver = new BrowserDriver(resolve(dataDir, "unused-profile"), true);
  Object.assign(driver, { context: cinemaContext });

  const runner = new BotRunner(
    new TaskStore(resolve(dataDir, "tasks.json")),
    new DiscoveryService(new LiveStarCineplexAdapter(inventory)),
    driver,
  );
  await runner.init();

  const { server, closeEvents } = createBotServer(runner, {
    staticDirectory: resolve("dashboard/dist"),
    inventory,
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => done());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Missing port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const cleanup = async () => {
    closeEvents();
    await inventory.stop();
    await new Promise<void>((done) => server.close(() => done()));
    await runner.shutdown();
    await cinemaContext.close().catch(() => {});
    if (dataDir.startsWith(resolve(".bot-test-data") + sep)) {
      await rm(dataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }).catch(() => {});
    }
  };

  return {
    baseUrl,
    date,
    invFixture,
    pageFixture,
    cinemaContext,
    driver,
    runner,
    inventory,
    cleanup,
  };
}

test("target upcoming not_open show from LiveCineplex, TaskForm, and MovieBooking with exact seats E5, E6 + 1s refresh", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Showtimes & tickets", exact: true })
    .click();
  await page.getByLabel("Online sales open only", { exact: true }).uncheck();

  const upcomingRow = page
    .locator(".live-show-row")
    .filter({ hasText: "Upcoming Film" });
  await expect(upcomingRow).toBeVisible();
  const targetDropBtn = upcomingRow.getByTestId("live-target-drop");
  await expect(targetDropBtn).toBeEnabled();
  await expect(targetDropBtn).toContainText("Target drop (1s)");

  await page.screenshot({
    path: screenshotPath("live-cineplex-upcoming-target.png"),
    fullPage: true,
  });

  await targetDropBtn.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".pinned-show")).toContainText("Sony Square");
  await expect(dialog.getByTestId("refresh-browser-page-toggle")).toBeChecked();

  // Select exact seats E5 and E6 via the interactive seat map grid
  await dialog.getByTestId("seat-picker-cell-E5").click();
  await dialog.getByTestId("seat-picker-cell-E6").click();
  await expect(dialog.getByTestId("seat-picker-cell-E5")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByTestId("seat-picker-cell-E6")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByTestId("target-seats-input")).toHaveValue("E5, E6");
  await dialog.getByTestId("exact-seats-only-toggle").check();

  await page.screenshot({
    path: screenshotPath("task-form-exact-seat-picker.png"),
    fullPage: true,
  });

  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/tasks", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      json: { error: "Intercepted exact-seat target check." },
    });
  });

  await dialog
    .getByRole("button", { name: "Start monitoring", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Intercepted exact-seat target check.",
  );
  expect(submitted).toMatchObject({
    targetShowId: "show-later",
    targetMovieId: "movie-upcoming",
    movieName: "Upcoming Film",
    mode: "monitor",
    source: "live",
    intervalSeconds: 1,
    requiredSeats: 2,
    targetSeats: ["E5", "E6"],
    exactSeatsOnly: true,
    refreshBrowserPage: true,
  });
  await dialog.getByRole("button", { name: "Close new task" }).click();

  // Also verify MovieBooking opening-time quick schedule, exact seats, and stale monitor arming
  const inventory = await (await request.get("/api/live")).json();
  const showLater = inventory.shows.find(
    (s: { id: string }) => s.id === "show-later",
  );
  showLater.onlineSalesOpenAt = `${showLater.date}T03:00:00.000Z`;
  inventory.status = "stale";
  const snapshot = await (await request.get("/api/state")).json();

  await page.addInitScript(
    ({ snap, inv }) => {
      class MockEventSource {
        onerror: ((ev: Event) => void) | null = null;
        private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
        constructor() {
          queueMicrotask(() => {
            for (const fn of this.listeners.get("snapshot") || []) {
              fn(new MessageEvent("snapshot", { data: JSON.stringify(snap) }));
            }
            for (const fn of this.listeners.get("inventory") || []) {
              fn(new MessageEvent("inventory", { data: JSON.stringify(inv) }));
            }
          });
        }
        addEventListener(type: string, fn: (ev: MessageEvent) => void) {
          const list = this.listeners.get(type) || [];
          list.push(fn);
          this.listeners.set(type, list);
        }
        close() {}
      }
      (window as unknown as { EventSource: unknown }).EventSource =
        MockEventSource;
    },
    { snap: snapshot, inv: inventory },
  );
  await page.route("**/api/live", (route) => route.fulfill({ json: inventory }));

  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await page.getByLabel("Movie release filter").selectOption("upcoming");
  await page
    .getByRole("button", { name: "Book Upcoming Film", exact: true })
    .click();

  const bookingDialog = page.getByRole("dialog");
  await bookingDialog.getByLabel("Booking date", { exact: true }).fill(
    showLater.date,
  );
  await expect(
    bookingDialog.getByTestId("schedule-opening-btn"),
  ).toBeVisible();
  await bookingDialog.getByTestId("schedule-opening-btn").click();
  await expect(
    bookingDialog.getByLabel("Monitor start time", { exact: true }),
  ).not.toHaveValue("");

  await bookingDialog.getByTestId("target-seats-input").fill("e5, e6");
  await bookingDialog.getByTestId("target-seats-input").blur();
  await expect(bookingDialog.getByTestId("target-seats-input")).toHaveValue(
    "E5, E6",
  );
  await expect(
    bookingDialog.getByRole("button", {
      name: /Get seats & open payment|Watch selected date/,
    }),
  ).toBeDisabled();
  const armStaleBtn = bookingDialog.getByTestId("arm-stale-monitor-btn");
  await expect(armStaleBtn).toBeEnabled();

  submitted = undefined;
  await armStaleBtn.click();
  await expect(bookingDialog.getByRole("alert")).toContainText(
    "Intercepted exact-seat target check.",
  );
  expect(submitted).toMatchObject({
    targetMovieId: "movie-upcoming",
    targetDate: showLater.date,
    mode: "monitor",
    source: "live",
    intervalSeconds: 1,
    requiredSeats: 2,
    targetSeats: ["E5", "E6"],
    refreshBrowserPage: true,
  });
});

test("1s refresh heartbeat survives transient 503 blips, detects drop, acquires exact E5 & E6, and hands off to payment", async ({
  page,
  browser,
}) => {
  test.setTimeout(45_000);
  const stack = await startIsolatedStack(browser, {
    inventoryOptions: {
      failOnRefreshes: [2],
    },
    pageOptions: {
      initiallyOpen: false,
      triggerDialogOnLoad: true,
      rerenderOnClick: true,
      failOnLoads: [2],
      paymentGatewayUrl:
        "https://securepay.sslcommerz.com/gwprocess/v4/gw.php?fixture=1",
    },
  });

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await page.goto(stack.baseUrl);
    await page
      .getByRole("button", { name: "Live Cineplex", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Showtimes & tickets", exact: true })
      .click();
    await page.getByLabel("Online sales open only", { exact: true }).uncheck();

    const upcomingRow = page
      .locator(".live-show-row")
      .filter({ hasText: "Upcoming Film" });
    await upcomingRow.getByTestId("live-target-drop").click();

    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("seat-picker-cell-E5").click();
    await dialog.getByTestId("seat-picker-cell-E6").click();
    await dialog.getByTestId("exact-seats-only-toggle").check();
    await expect(
      dialog.getByTestId("refresh-browser-page-toggle"),
    ).toBeChecked();

    await dialog
      .getByRole("button", { name: "Start monitoring", exact: true })
      .click();

    // Verify Sniper Monitor Panel ticks reliably every 1s & survives transient 503 on both API and page
    await expect(page.getByTestId("sniper-monitor-panel")).toBeVisible();
    await expect(page.getByTestId("sniper-target-seats")).toContainText("E5");
    await expect(page.getByTestId("sniper-target-seats")).toContainText("E6");
    await expect(page.getByTestId("sniper-target-seats")).toContainText(
      "Exact seats only",
    );

    await expect
      .poll(
        async () =>
          Number(
            (await page.getByTestId("sniper-check-count").textContent()) || "0",
          ),
        { timeout: 12_000, message: "1s API refresh checks should advance" },
      )
      .toBeGreaterThanOrEqual(3);

    await expect
      .poll(
        async () =>
          Number(
            (await page
              .getByTestId("sniper-page-refresh-count")
              .textContent()) || "0",
          ),
        {
          timeout: 12_000,
          message:
            "1s live Cineplex tab refresh count should advance past transient 503 + alert",
        },
      )
      .toBeGreaterThanOrEqual(3);

    // Must remain actively monitoring with zero fatal error
    expect(stack.runner.snapshot().tasks[0]?.status).toBe("monitoring");
    await expect(page.getByTestId("sniper-latency-ms")).toContainText("ms");

    await page.screenshot({
      path: screenshotPath("sniper-monitor-heartbeat.png"),
      fullPage: true,
    });

    // Trigger instant ticket drop on both Cineplex DOM and live inventory
    stack.pageFixture.triggerDrop();
    stack.invFixture.triggerDrop("show-later");

    // Verify immediate exact-seat acquisition -> awaiting_payment
    await expect
      .poll(() => stack.runner.snapshot().tasks[0]?.status, {
        timeout: 15_000,
        message: "Task should transition to awaiting_payment upon ticket drop",
      })
      .toBe("awaiting_payment");

    await expect(page.getByTestId("sniper-acquired-seats")).toContainText("E5");
    await expect(page.getByTestId("sniper-acquired-seats")).toContainText("E6");
    await expect(page.getByTestId("handoff-toast")).toContainText(
      "Seats E5, E6 locked",
    );
    await expect(
      page.getByRole("button", { name: "Open browser" }).first(),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Mark complete", exact: true }),
    ).toBeEnabled();

    // Verify checkout page received exact seats E5, E6 and never auto-paid
    expect(stack.pageFixture.state.checkoutVisits).toBe(1);
    expect([...stack.pageFixture.state.lastCheckoutSeats].sort()).toEqual([
      "E5",
      "E6",
    ]);
    const paymentPage = stack.cinemaContext
      .pages()
      .find((p) => p.url().includes("securepay.sslcommerz.com"));
    expect(paymentPage).toBeDefined();
    expect(
      await paymentPage!.evaluate(
        () =>
          (window as unknown as { paymentSubmitted?: boolean })
            .paymentSubmitted,
      ),
    ).toBeUndefined();

    await page.screenshot({
      path: screenshotPath("sniper-payment-handoff.png"),
      fullPage: true,
    });

    // Mark complete preserves the open payment tab for the user
    await page
      .getByRole("button", { name: "Mark complete", exact: true })
      .click();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    expect(paymentPage!.isClosed()).toBe(false);
    expect(pageErrors).toEqual([]);
  } finally {
    await stack.cleanup();
  }
});

test("E6 stolen mid-click performs atomic rollback of E5 in strict exact mode and contiguous fallback in fallback mode", async ({
  browser,
}) => {
  const show: Showtime = {
    id: "show-later",
    movie: { id: "movie-upcoming", title: "Upcoming Film" },
    cinema: { id: "star-cineplex", name: "Sony Square", location: "Mirpur" },
    hall: { id: "hall-two", name: "VIP Hall", screenType: "2d", capacity: 30 },
    date: futureDate(),
    time: "20:00",
    screenType: "2d",
    price: 500,
    currency: "BDT",
    availableSeats: 20,
    totalSeats: 30,
    bookingUrl:
      "https://kichole.com/shows/show-later/seats?tenant=star-cineplex",
  };

  // 1. Strict exact mode (exactSeatsOnly: true): E6 stolen mid-click -> atomic rollback of E5 -> retryable outcome
  const strictContext = await browser.newContext();
  try {
    const strictFixture = createCineplexPageFixture({
      showId: "show-later",
      initiallyOpen: true,
      rows: ["D", "E", "F"],
      seatsPerRow: 10,
      stealSeatsOnClick: ["E6"],
      rerenderOnClick: true,
    });
    await strictFixture.attach(strictContext);
    const strictPage = await strictContext.newPage();
    await strictPage.goto(strictFixture.bookingUrl);

    const strictDriver = new BrowserDriver(".bot-test-data/unused-strict", true);
    Object.assign(strictDriver, {
      context: strictContext,
      pages: new Map([["strict-task:show-later", strictPage]]),
    });

    const strictInput = validateTask({
      movieName: "Upcoming Film",
      targetDate: show.date,
      requiredSeats: 2,
      allowedRows: ["E"],
      targetSeats: ["E5", "E6"],
      exactSeatsOnly: true,
      autoReserve: true,
      mode: "monitor",
    });

    const strictResult = await strictDriver.reserve(
      "strict-task",
      show,
      strictInput,
      new AbortController().signal,
    );

    expect(strictResult.status).toBe("awaiting_user");
    expect(strictResult.retryable).toBe(true);
    expect(strictResult.reason).toBe("seat_stolen_mid_click");
    expect(strictResult.selectedSeats).toEqual([]);
    expect(strictFixture.state.checkoutVisits).toBe(0);
    // Atomic rollback check: E5 must be deselected, 0 selected seats left in live DOM
    expect(await strictPage.locator('[aria-selected="true"]').count()).toBe(0);
  } finally {
    await strictContext.close();
  }

  // 2. Fallback mode (exactSeatsOnly: false): E6 stolen mid-click -> atomic rollback of E5 -> acquires best contiguous block
  const fallbackContext = await browser.newContext();
  try {
    const fallbackFixture = createCineplexPageFixture({
      showId: "show-later",
      initiallyOpen: true,
      rows: ["D", "E", "F"],
      seatsPerRow: 10,
      stealSeatsOnClick: ["E6"],
      rerenderOnClick: true,
    });
    await fallbackFixture.attach(fallbackContext);
    const fallbackPage = await fallbackContext.newPage();
    await fallbackPage.goto(fallbackFixture.bookingUrl);

    const fallbackDriver = new BrowserDriver(
      ".bot-test-data/unused-fallback",
      true,
    );
    Object.assign(fallbackDriver, {
      context: fallbackContext,
      pages: new Map([["fallback-task:show-later", fallbackPage]]),
    });

    const fallbackInput = validateTask({
      movieName: "Upcoming Film",
      targetDate: show.date,
      requiredSeats: 2,
      allowedRows: ["E"],
      targetSeats: ["E5", "E6"],
      exactSeatsOnly: false,
      autoReserve: true,
      mode: "monitor",
    });

    const fallbackResult = await fallbackDriver.reserve(
      "fallback-task",
      show,
      fallbackInput,
      new AbortController().signal,
    );

    expect(fallbackResult.status).toBe("awaiting_payment");
    expect(fallbackResult.selectedSeats).toHaveLength(2);
    expect(fallbackResult.selectedSeats).not.toContain("E6");
    // Verify acquired fallback seats are contiguous in row E
    const nums = fallbackResult.selectedSeats
      .map((label) => {
        expect(label.startsWith("E")).toBe(true);
        return Number(label.slice(1));
      })
      .sort((a, b) => a - b);
    expect(nums[1] - nums[0]).toBe(1);
    expect(fallbackFixture.state.checkoutVisits).toBe(1);
    expect([...fallbackFixture.state.lastCheckoutSeats].sort()).toEqual(
      [...fallbackResult.selectedSeats].sort(),
    );
  } finally {
    await fallbackContext.close();
  }
});

test("stopping mid-refresh guarantees zero post-stop clicks or navigations", async ({
  page,
  browser,
}) => {
  test.setTimeout(35_000);
  const stack = await startIsolatedStack(browser, {
    pageOptions: {
      initiallyOpen: false,
    },
  });

  try {
    await page.goto(stack.baseUrl);
    const created = await page.request.post(`${stack.baseUrl}/api/tasks`, {
      headers: { "X-Ticket-Bot": "dashboard" },
      data: {
        movieName: "Upcoming Film",
        targetMovieId: "movie-upcoming",
        targetShowId: "show-later",
        targetDate: stack.date,
        requiredSeats: 2,
        targetSeats: ["E5", "E6"],
        exactSeatsOnly: true,
        refreshBrowserPage: true,
        mode: "monitor",
        source: "live",
        intervalSeconds: 1,
        locationIds: ["sony-square"],
        allowedRows: ["E"],
        preferredTimes: [],
        autoReserve: true,
      },
    });
    expect(created.status()).toBe(201);
    const task = await created.json();

    await expect
      .poll(
        () =>
          stack.runner.snapshot().tasks.find((t) => t.id === task.id)
            ?.pageRefreshCount ?? 0,
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2);

    // Stop mid-refresh via API (same endpoint as Stop button)
    const stopped = await page.request.post(
      `${stack.baseUrl}/api/tasks/${task.id}/stop`,
      {
        headers: { "X-Ticket-Bot": "dashboard" },
        data: {},
      },
    );
    expect(stopped.status()).toBe(200);
    const loadsAtStop = stack.pageFixture.state.loads;

    // Immediately trigger drop after stop — must perform zero clicks/checkouts or further page loads
    stack.pageFixture.triggerDrop();
    stack.invFixture.triggerDrop("show-later");
    await page.waitForTimeout(2200);

    const after = stack.runner.snapshot().tasks.find((t) => t.id === task.id);
    expect(after?.status).toBe("stopped");
    expect(stack.pageFixture.state.checkoutVisits).toBe(0);
    expect(stack.pageFixture.state.loads).toBe(loadsAtStop);
  } finally {
    await stack.cleanup();
  }
});

test("awaiting_user and error alerts trigger toast and re-trigger after retry", async ({
  page,
  request,
}) => {
  const inventory = await (await request.get("/api/live")).json();
  const baseSnapshot = await (await request.get("/api/state")).json();

  const makeTask = (status: string, message?: string) => ({
    id: "alert-task-1",
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    checks: 2,
    input: {
      movieName: "Alert Test Film",
      targetDate: futureDate(),
      requiredSeats: 2,
      mode: "monitor",
      source: "live",
      intervalSeconds: 1,
      allowedRows: ["E"],
      preferredTimes: [],
      locationIds: ["sony-square"],
      preferredCategory: "any",
      rowPreference: "center",
      strategy: "best",
      keepTogether: true,
      autoReserve: true,
      targetSeats: ["E5", "E6"],
      exactSeatsOnly: true,
      refreshBrowserPage: true,
    },
    ...(status === "error" ? { error: message || "Transient failure" } : {}),
    results:
      status === "awaiting_user"
        ? [
            {
              key: "res-1",
              seatLabels: ["E5", "E6"],
              simulated: false,
              score: 95,
              reasoning: ["Exact target match"],
              showtime: {
                id: "show-later",
                movie: { id: "movie-upcoming", title: "Alert Test Film" },
                cinema: {
                  id: "star-cineplex",
                  name: "Sony Square",
                  location: "Mirpur",
                },
                hall: {
                  id: "hall-two",
                  name: "VIP Hall",
                  screenType: "2d",
                  capacity: 30,
                },
                date: futureDate(),
                time: "20:00",
                screenType: "2d",
                price: 500,
                currency: "BDT",
                availableSeats: 10,
                totalSeats: 30,
                bookingUrl: "https://kichole.com/shows/show-later/seats",
              },
              seats: [],
              handoff: {
                status: "awaiting_user",
                message: message || "Cinema login or OTP verification needed.",
                url: "https://kichole.com/login",
                selectedSeats: ["E5", "E6"],
              },
            },
          ]
        : [],
    logs: [],
  });

  // Stream 1: monitoring -> awaiting_user (first alert) -> monitoring (retry clears notified) -> awaiting_user (re-alert!)
  let seq = 10;
  const snapshots = [
    { ...baseSnapshot, seq: ++seq, tasks: [makeTask("monitoring")] },
    {
      ...baseSnapshot,
      seq: ++seq,
      tasks: [makeTask("awaiting_user", "Complete OTP verification in Chrome.")],
    },
  ];
  let streamPhase = 0;

  await page.route("**/api/live", (route) => route.fulfill({ json: inventory }));
  await page.route("**/api/state", (route) =>
    route.fulfill({ json: snapshots[0] }),
  );
  await page.route("**/api/events", (route) => {
    const body =
      streamPhase === 0
        ? `event: snapshot\ndata: ${JSON.stringify(snapshots[1])}\n\n`
        : streamPhase === 1
          ? `event: snapshot\ndata: ${JSON.stringify({ ...baseSnapshot, seq: ++seq, tasks: [makeTask("monitoring")] })}\n\nevent: snapshot\ndata: ${JSON.stringify({ ...baseSnapshot, seq: ++seq, tasks: [makeTask("awaiting_user", "Complete CAPTCHA check in Chrome.")] })}\n\n`
          : `event: snapshot\ndata: ${JSON.stringify({ ...baseSnapshot, seq: ++seq, tasks: [makeTask("error", "Show selection failed cleanly.")] })}\n\n`;
    streamPhase++;
    return route.fulfill({
      contentType: "text/event-stream",
      body,
    });
  });

  await page.goto("/");

  // First awaiting_user alert appears
  await expect(page.getByTestId("handoff-toast")).toBeVisible();
  await expect(page.getByTestId("handoff-toast")).toHaveAttribute(
    "role",
    "alert",
  );
  await expect(page.getByTestId("handoff-toast")).toContainText(
    "Alert Test Film: action needed in cinema browser",
  );

  // Dismiss toast; EventSource reconnect delivers monitoring -> awaiting_user retry re-alert
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.getByTestId("handoff-toast")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("handoff-toast")).toContainText(
    "Alert Test Film: action needed in cinema browser",
  );

  // Dismiss and verify error toast triggers with role="alert"
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.getByTestId("handoff-toast")).toHaveAttribute(
    "role",
    "alert",
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("handoff-toast")).toContainText(
    "Show selection failed cleanly.",
  );
});
