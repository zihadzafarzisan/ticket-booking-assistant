import { test, expect } from "@playwright/test";

test("catalog flags without shows are not advertised as running; the watch task explains why no browser opens", async ({
  page,
  request,
}) => {
  const live = await (await request.get("/api/live")).json();
  const date = live.shows[0].date;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Cineplex", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unannounced Film", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Movie release filter").selectOption("upcoming");
  const card = page
    .locator(".live-movie-card")
    .filter({
      has: page.getByRole("heading", { name: "Unannounced Film", exact: true }),
    });
  await expect(
    card.getByText("SHOWS NOT PUBLISHED", { exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Book Unannounced Film", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("No shows announced", { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Booking date", { exact: true }).fill(date);
  await expect(
    dialog.getByRole("heading", {
      name: "Shows not published for this date",
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Watch selected date", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Waiting for show announcements",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/There is no seat page to open yet/),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/unpublished-mission.png",
    fullPage: true,
  });
  const state = await (await request.get("/api/state")).json();
  const task = state.tasks.find(
    (item: { input: { targetMovieId?: string } }) =>
      item.input.targetMovieId === "movie-unannounced",
  );
  expect(task.waitReason.title).toBe("Waiting for show announcements");
  expect(task.status).toBe("monitoring");
  expect(state.browser.connected).toBe(false);
  await request.post(`/api/tasks/${task.id}/stop`, {
    headers: { "x-ticket-bot": "dashboard" },
    data: {},
  });
  await page
    .getByRole("button", { name: "Adjust search", exact: true })
    .click();
  const edit = page.getByRole("dialog");
  await expect(
    edit.getByRole("note", { name: "Current search availability" }),
  ).toContainText("There is no seat page to open yet");
  await page.screenshot({
    path: "test-results/unpublished-adjust-search.png",
    fullPage: true,
  });
  await edit
    .getByRole("button", { name: "Close new task", exact: true })
    .click();
  await request.post(`/api/tasks/${task.id}/remove`, {
    headers: { "x-ticket-bot": "dashboard" },
    data: {},
  });
});
