import { test, expect } from "@playwright/test";

test("movie click previews dates, seats and branches and submits the exact booking choices", async ({
  page,
  request,
}) => {
  const live = await (await request.get("/api/live")).json();
  const date = live.shows.find(
    (show: { id: string }) => show.id === "show-open",
  ).date;
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/tasks", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      json: { error: "Fixture checked booking choices; no real booking." },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Book Running Film", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Booking date", { exact: true }).fill(date);
  await dialog.getByLabel("Booking seat count", { exact: true }).fill("3");
  await dialog
    .getByRole("button", { name: "Bashundhara City", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Tickets available", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("8 seats reported", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "B", exact: true }).click();
  await dialog.getByRole("button", { name: "C", exact: true }).click();
  await dialog.getByRole("button", { name: /Morning/ }).click();
  await expect(
    dialog.getByRole("heading", {
      name: "No shows at selected times",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByText("8 seats reported", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Watch selected date", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Any time", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Tickets available", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: /Afternoon/ }).click();
  await expect(
    dialog.getByText("8 seats reported", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("sold out", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/movie-booking-desktop.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Get seats & open payment", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Fixture checked");
  expect(submitted).toMatchObject({
    targetMovieId: "movie-running",
    targetDate: date,
    requiredSeats: 3,
    locationIds: ["bashundhara"],
    source: "live",
    mode: "instant",
    autoReserve: true,
    openPaymentGateway: true,
    allowedRows: ["B", "C"],
    preferredTimes: ["afternoon"],
  });
  expect(submitted?.targetShowId).toBeUndefined();
  await dialog.getByLabel("Booking seat count", { exact: true }).fill("9");
  await expect(
    dialog.getByRole("heading", {
      name: "Not enough seats in one show",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Any row", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "B", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Any time", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Sony Square", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Bashundhara City", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: "Online sales unavailable on this date",
      exact: true,
    }),
  ).toBeVisible();
});

test("upcoming movie distinguishes unpublished dates from sold out and watches selected choices", async ({
  page,
  request,
}) => {
  const live = await (await request.get("/api/live")).json();
  const published = live.shows.find(
    (show: { id: string }) => show.id === "show-later",
  ).date;
  const date = new Date(`${published}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 5);
  const future = date.toISOString().slice(0, 10);
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/tasks", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      json: { error: "Monitor intercepted; no real booking." },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await page.getByLabel("Movie release filter").selectOption("upcoming");
  await page
    .getByRole("button", { name: "Book Upcoming Film", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Booking date", { exact: true }).fill(published);
  await expect(
    dialog.getByRole("heading", { name: "Tickets not open yet", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "Ticket-opening time: not announced by Cineplex for these choices.",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog.getByLabel("Booking date", { exact: true }).fill(future);
  await dialog.getByLabel("Booking seat count", { exact: true }).fill("4");
  await dialog.getByRole("button", { name: "D", exact: true }).click();
  await dialog.getByRole("button", { name: /Evening/ }).click();
  await dialog
    .getByRole("button", { name: "Sony Square", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: "Shows not published for this date",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/movie-booking-mobile.png",
    fullPage: true,
  });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Watch selected date", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Monitor intercepted");
  expect(submitted).toMatchObject({
    targetMovieId: "movie-upcoming",
    targetDate: future,
    requiredSeats: 4,
    locationIds: ["sony-square"],
    mode: "monitor",
    allowedRows: ["D"],
    preferredTimes: ["evening"],
    autoReserve: true,
    openPaymentGateway: true,
  });
});

test("stale inventory permits preview but prevents a live movie booking", async ({
  page,
  request,
}) => {
  const inventory = await (await request.get("/api/live")).json();
  inventory.status = "stale";
  const snapshot = await (await request.get("/api/state")).json();
  await page.route("**/api/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\nevent: inventory\ndata: ${JSON.stringify(inventory)}\n\n`,
    }),
  );
  await page.route("**/api/live", (route) =>
    route.fulfill({ json: inventory }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Book Running Film", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Live availability needs a refresh",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", {
      name: /Get seats & open payment|Watch selected date/,
    }),
  ).toBeDisabled();
});

test("shows an explicitly published opening time and selects a published date", async ({
  page,
  request,
}) => {
  const inventory = await (await request.get("/api/live")).json();
  const show = inventory.shows.find(
    (item: { id: string }) => item.id === "show-later",
  );
  show.onlineSalesOpenAt = `${show.date}T03:00:00.000Z`;
  const snapshot = await (await request.get("/api/state")).json();
  await page.route("**/api/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\nevent: inventory\ndata: ${JSON.stringify(inventory)}\n\n`,
    }),
  );
  await page.route("**/api/live", (route) =>
    route.fulfill({ json: inventory }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await page.getByLabel("Movie release filter").selectOption("upcoming");
  await page
    .getByRole("button", { name: "Book Upcoming Film", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".booking-date-options button").first().click();
  await expect(dialog.getByLabel("Booking date", { exact: true })).toHaveValue(
    show.date,
  );
  await expect(dialog.locator(".booking-opening")).toContainText(
    "Cineplex lists ticket opening:",
  );
  await expect(dialog.locator(".booking-opening")).toContainText(
    "09:00 (Dhaka time)",
  );
});
