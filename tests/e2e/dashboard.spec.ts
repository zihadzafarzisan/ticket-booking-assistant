import { test, expect } from "@playwright/test";

test("create a demo mission, inspect seats, reconnect and manage history", async ({
  page,
  request,
}) => {
  // Every fixture task is removed so no test data is left in the operator workspace.
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Mission control." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New mission", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "test-results/dashboard-overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "New mission", exact: true }).click();
  await page.getByLabel("Movie name").fill("Interstellar");
  await page.getByLabel("Demo mode", { exact: true }).check();
  await page.getByRole("button", { name: "Find my seats" }).click();
  await expect(
    page.getByRole("heading", { name: "Interstellar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This is a demo mission.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect block" }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-mission.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Inspect block" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Proposed seats", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close seat map" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Missions", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /Interstellar.*Demo|Interstellar.*Instant search/,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Interstellar.*Instant search/ })
    .click();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove mission" }).click();
  await expect(
    page.getByRole("heading", { name: "Your missions." }),
  ).toBeVisible();
  const state = await (await request.get("/api/state")).json();
  expect(
    state.tasks.filter(
      (t: { input: { movieName: string } }) =>
        t.input.movieName === "Interstellar",
    ),
  ).toHaveLength(0);
});

test("mobile dashboard and scheduled monitor cancellation", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New mission", exact: true }).click();
  await page.getByLabel("Movie name").fill("Dune scheduled fixture");
  await page.getByRole("button", { name: "Any row", exact: true }).click();
  await page.getByRole("button", { name: "D", exact: true }).click();
  await page.getByRole("button", { name: "Any time", exact: true }).click();
  await page.getByRole("button", { name: /Night.*After 9 PM/ }).click();
  await page.getByRole("button", { name: /Monitor a drop/ }).click();
  await page.getByLabel("Demo mode", { exact: true }).check();
  const future = new Date(Date.now() + 3600_000);
  future.setMinutes(future.getMinutes() - future.getTimezoneOffset());
  await page
    .getByLabel("Start at", { exact: false })
    .fill(future.toISOString().slice(0, 16));
  await page
    .getByRole("button", { name: "Start monitoring", exact: true })
    .click();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Armed and ready.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".mission-specs")).toContainText("Night");
  const saved = await (await request.get("/api/state")).json();
  expect(
    saved.tasks.find(
      (task: { input: { movieName: string } }) =>
        task.input.movieName === "Dune scheduled fixture",
    ).input,
  ).toMatchObject({ allowedRows: ["D"], preferredTimes: ["night"] });
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove mission" }).click();
  const state = await (await request.get("/api/state")).json();
  expect(
    state.tasks.filter(
      (t: { input: { movieName: string } }) =>
        t.input.movieName === "Dune scheduled fixture",
    ),
  ).toHaveLength(0);
});
