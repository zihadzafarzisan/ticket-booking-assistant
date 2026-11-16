import { test, expect } from "@playwright/test";

test("an existing conflicting mission can be adjusted and retried in place", async ({
  page,
  request,
}) => {
  const inventory = await (await request.get("/api/live")).json();
  const show = inventory.shows.find(
    (item: { id: string }) => item.id === "show-open",
  );
  const response = await request.post("/api/tasks", {
    headers: { "X-Ticket-Bot": "dashboard" },
    data: {
      movieName: show.movie.title,
      targetDate: show.date,
      targetShowId: show.id,
      requiredSeats: 2,
      source: "live",
      mode: "instant",
      autoReserve: false,
      locationIds: ["sony-square"],
      preferredTimes: [],
      allowedRows: ["B", "C", "D"],
    },
  });
  expect(response.status()).toBe(201);
  const task = await response.json();
  try {
    await expect
      .poll(async () => {
        const state = await (await request.get("/api/state")).json();
        return state.tasks.find((item: { id: string }) => item.id === task.id)
          ?.status;
      })
      .toBe("error");
    await page.goto("/");
    await page.getByRole("button", { name: "Missions", exact: true }).click();
    await page
      .getByRole("button", { name: /Running Film.*Instant search/ })
      .click();
    await expect(
      page.getByText("branch filter excludes", { exact: false }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Adjust search", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".pinned-show strong")).toContainText(
      "Bashundhara City",
    );
    await dialog
      .getByRole("button", { name: "Unpin show", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Bashundhara City", exact: true })
      .click();
    await dialog.getByLabel("Demo mode", { exact: true }).check();
    await dialog
      .getByRole("button", { name: "Save & find seats", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Inspect block" }).first(),
    ).toBeVisible();
    const state = await (await request.get("/api/state")).json();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe(task.id);
    expect(state.tasks[0].input.targetShowId).toBeUndefined();
    expect(state.tasks[0].input.source).toBe("demo");
    await page.screenshot({
      path: "test-results/adjusted-mission.png",
      fullPage: true,
    });
  } finally {
    await request.post(`/api/tasks/${task.id}/stop`, {
      headers: { "X-Ticket-Bot": "dashboard" },
      data: {},
    });
    await request.post(`/api/tasks/${task.id}/remove`, {
      headers: { "X-Ticket-Bot": "dashboard" },
      data: {},
    });
  }
});

test("editing branch or time unpins the old show before submitting", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Showtimes & tickets", exact: true })
    .click();
  let captured: Record<string, unknown> | undefined;
  await page.route("**/api/tasks", async (route) => {
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      json: { error: "Edited search intercepted; no booking made." },
    });
  });
  for (const field of ["branch", "time"]) {
    await page.getByRole("button", { name: "Find seats", exact: true }).click();
    const dialog = page.getByRole("dialog");
    if (field === "branch")
      await dialog
        .getByRole("button", { name: "Sony Square", exact: true })
        .click();
    else await dialog.getByRole("button", { name: /^Evening/ }).click();
    await dialog
      .getByRole("button", { name: "Find my seats", exact: true })
      .click();
    await expect(
      dialog.getByText("Edited search intercepted; no booking made.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      captured?.targetShowId,
      `${field} edit must remove the conflicting exact-show pin`,
    ).toBeUndefined();
    await dialog.getByRole("button", { name: "Close new task" }).click();
  }
});

test("browse live movies, ticket sales and halls, then pin a mission to a published show", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Star Cineplex, live." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Running Film", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Upcoming Film", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Movie release filter").selectOption("upcoming");
  await expect(
    page.getByRole("heading", { name: "Upcoming Film", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Showtimes & tickets", exact: true })
    .click();
  await expect(page.locator(".live-show-row")).toHaveCount(1);
  await page.getByLabel("Online sales open only", { exact: true }).uncheck();
  await expect(page.locator(".live-show-row")).toHaveCount(5);
  for (const status of [
    "Online sales open",
    "Sold out",
    "Not open yet",
    "Online sales closed",
    "Counter only",
  ])
    await expect(
      page.locator(".sale-status").getByText(status, { exact: true }),
    ).toBeVisible();
  await page.screenshot({
    path: "test-results/live-cineplex.png",
    fullPage: true,
  });
  await page
    .getByLabel("Live cinema branch")
    .selectOption("07ce0273-2b9f-4563-a02c-bb160284cb3b");
  await expect(page.locator(".live-show-row")).toHaveCount(3);
  await page.getByRole("tab", { name: "Halls", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "VIP Hall", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hall 1", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/live-cineplex-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Live cinema branch").selectOption("");
  await page
    .getByRole("tab", { name: "Showtimes & tickets", exact: true })
    .click();
  await page.getByLabel("Online sales open only", { exact: true }).check();
  await page.getByRole("button", { name: "Find seats", exact: true }).click();
  await expect(
    page.getByText("Pinned to your selected show.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Movie name", { exact: true })).toHaveValue(
    "Running Film",
  );
  let captured: Record<string, unknown> | undefined;
  await page.route("**/api/tasks", async (route) => {
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      json: { error: "Fixture intercepted task; no booking made." },
    });
  });
  await page
    .getByRole("button", { name: "Find my seats", exact: true })
    .click();
  await expect(
    page.getByText("Fixture intercepted task; no booking made.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(captured?.targetShowId).toBe("show-open");
  expect(captured?.source).toBe("live");
  expect(captured?.locationIds).toEqual(["bashundhara"]);
  await page.getByRole("button", { name: "Close new task" }).click();
  const refresh = page.waitForResponse((response) =>
    response.url().endsWith("/api/live/refresh"),
  );
  await page.getByRole("button", { name: "Refresh now", exact: true }).click();
  expect((await refresh).status()).toBe(202);
});
