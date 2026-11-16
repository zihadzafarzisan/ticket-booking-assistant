import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LiveInventory } from "../../bot/src/live-types";

test("production bot, dashboard, inventory refresh and demo task lifecycle", async ({
  page,
  request,
}) => {
  const base = process.env.CINEBOT_SMOKE_URL;
  if (!base) throw new Error("Smoke setup did not start the isolated bot.");
  const live = process.env.CINEBOT_SMOKE_LIVE === "1";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const checks: string[] = [];
  const directory = resolve("test-results/smoke");
  await mkdir(directory, { recursive: true });
  const post = async (path: string, data: unknown = {}) => {
    const response = await request.post(`${base}/api${path}`, {
      headers: { "X-Ticket-Bot": "dashboard" },
      data,
    });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response;
  };

  const health = await request.get(`${base}/api/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    ok: true,
    service: "movie-ticket-bot",
  });
  const config = await (await request.get(`${base}/api/config`)).json();
  expect(config.locations.length).toBeGreaterThan(0);
  const initial = await (await request.get(`${base}/api/state`)).json();
  expect(initial.tasks).toEqual([]);
  expect(initial.browser.connected).toBe(false);
  checks.push("production startup, health/config APIs and isolated state");

  const inventoryResponse = await request.get(`${base}/api/live`);
  expect(inventoryResponse.status()).toBe(200);
  const inventory: LiveInventory = await inventoryResponse.json();
  expect(inventory.status).toBe("live");
  expect(inventory.error).toBeUndefined();
  expect(inventory.movies.length).toBeGreaterThan(0);
  expect(inventory.branches.length).toBeGreaterThan(0);
  expect(
    inventory.shows.every(
      (show) =>
        Number.isInteger(show.availableSeats) && show.availableSeats >= 0,
    ),
  ).toBe(true);
  const open = inventory.shows.filter((show) => show.ticketStatus === "open");
  expect(inventory.counts.openShows).toBe(open.length);
  expect(
    open.every((show) => show.availableKnown && show.availableSeats > 0),
  ).toBe(true);
  checks.push(
    `${live ? "real provider" : "fixture"} inventory: movies, branches, halls and ticket counts`,
  );

  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Mission control." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New mission", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: resolve(directory, "dashboard.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Star Cineplex, live." }),
  ).toBeVisible();
  if (inventory.counts.nowShowingMovies > 0)
    await expect(page.locator(".live-movie-card").first()).toBeVisible();
  await page
    .getByRole("tab", { name: "Showtimes & tickets", exact: true })
    .click();
  if (open.length)
    await expect(page.locator(".live-show-row").first()).toBeVisible();
  else
    await expect(
      page.getByText("No shows match these choices.", { exact: true }),
    ).toBeVisible();
  await page.screenshot({
    path: resolve(directory, "live-inventory.png"),
    fullPage: true,
  });
  checks.push("dashboard and live inventory render without JavaScript errors");

  await page.getByRole("button", { name: "Refresh now", exact: true }).click();
  await expect
    .poll(
      async () => {
        const current: LiveInventory = await (
          await request.get(`${base}/api/live`)
        ).json();
        if (current.status === "error" || current.status === "stale")
          throw new Error(current.error || "Provider refresh failed.");
        return (
          !current.refreshing &&
          current.status === "live" &&
          current.fetchedAt !== inventory.fetchedAt
        );
      },
      {
        timeout: 30_000,
        message: "inventory refresh should return a new successful snapshot",
      },
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Refresh now", exact: true }),
  ).toBeEnabled();
  checks.push("manual inventory refresh reaches the open dashboard");

  const created = await post("/tasks", {
    movieName: "Smoke Test Demo",
    targetDate: new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10),
    requiredSeats: 2,
    mode: "instant",
    source: "demo",
    autoReserve: false,
    keepTogether: true,
    allowedRows: ["B", "C", "D", "E", "F"],
    locationIds: [],
    preferredTimes: [],
  });
  const task = await created.json();
  try {
    await expect
      .poll(
        async () => {
          const state = await (await request.get(`${base}/api/state`)).json();
          const current = state.tasks.find(
            (t: { id: string }) => t.id === task.id,
          );
          if (current?.status === "error")
            throw new Error(current.error || "Demo task failed.");
          return (
            current?.status === "awaiting_user" &&
            current.results.length > 0 &&
            current.checks === 1
          );
        },
        {
          timeout: 10_000,
          message: "demo task should finish discovery without live booking",
        },
      )
      .toBe(true);
    await post(`/tasks/${task.id}/stop`);
    await post(`/tasks/${task.id}/remove`);
  } finally {
    const state = await (await request.get(`${base}/api/state`)).json();
    if (state.tasks.some((t: { id: string }) => t.id === task.id)) {
      await post(`/tasks/${task.id}/stop`);
      await post(`/tasks/${task.id}/remove`);
    }
  }
  const final = await (await request.get(`${base}/api/state`)).json();
  expect(final.tasks).toEqual([]);
  expect(final.browser.connected).toBe(false);
  expect(errors).toEqual([]);
  checks.push(
    "isolated demo discovery, stop and removal; no cinema booking browser opened",
  );
  const report = {
    status: "passed",
    mode: live ? "live" : "fixture",
    checkedAt: new Date().toISOString(),
    version: final.version,
    checks,
    inventory: {
      fetchedAt: inventory.fetchedAt,
      movies: inventory.movies.length,
      branches: inventory.branches.length,
      shows: inventory.shows.length,
      halls: inventory.halls.length,
      ...inventory.counts,
    },
    screenshots: ["dashboard.png", "live-inventory.png"],
  };
  await writeFile(
    resolve(directory, "summary.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `\nSmoke passed (${report.mode}): ${checks.length} checks; ${report.inventory.movies} movies, ${report.inventory.shows} published shows, ${report.inventory.halls} halls.\nReport: test-results/smoke/summary.json\n`,
  );
});
