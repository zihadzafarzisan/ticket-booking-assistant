import { test, expect } from "@playwright/test";

test("shows Chrome approval guidance during an existing-browser connection", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/browser/connect", async (route) => {
    await pending;
    await route.fulfill({
      json: { connected: true, pages: 1, headless: false, mode: "regular" },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect existing browser", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("choose Allow");
  await page.screenshot({
    path: "test-results/chrome-approval-guidance.png",
    fullPage: true,
  });
  release();
  await expect(page.getByRole("status")).toContainText(
    "Connected to your open browser",
  );
});

test("save, replace and remove Cineplex credentials without retrieving the password", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Cineplex login", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Cineplex email", { exact: true })
    .fill("fixture@example.com");
  await page
    .getByLabel("Cineplex password", { exact: true })
    .fill("fixture-password-123");
  await page
    .getByRole("button", { name: "Save Cineplex login", exact: true })
    .click();
  await expect(page.getByText("Login saved", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Cineplex password", { exact: true }),
  ).toHaveValue("");
  expect(await (await request.get("/api/settings")).text()).not.toContain(
    "fixture-password-123",
  );
  await page.screenshot({
    path: "test-results/cineplex-settings.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Cineplex email", { exact: true })).toHaveValue(
    "fixture@example.com",
  );
  await expect(
    page.getByLabel("Cineplex password", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Cineplex password", { exact: true })
    .fill("replacement-fixture");
  await page
    .getByRole("button", { name: "Save Cineplex login", exact: true })
    .click();
  await expect(
    page.getByLabel("Cineplex password", { exact: true }),
  ).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/cineplex-settings-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Remove saved login", exact: true })
    .click();
  await expect(page.getByText("No login saved", { exact: true })).toBeVisible();
  expect(
    (await (await request.get("/api/settings")).json()).credentials.configured,
  ).toBe(false);
});
