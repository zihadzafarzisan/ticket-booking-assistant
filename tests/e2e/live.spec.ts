import { test, expect } from "@playwright/test";

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
