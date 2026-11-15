import { test, expect } from "@playwright/test";
import { BrowserDriver } from "../../bot/src/browser";
import { validateTask } from "../../bot/src/contracts";
import type { Showtime } from "../../packages/core/src";

const show: Showtime = {
  id: "fixture",
  movie: { id: "m", title: "Fixture movie" },
  cinema: { id: "star-cineplex", name: "Fixture cinema", location: "Dhaka" },
  hall: { id: "h", name: "Hall", screenType: "standard", capacity: 5 },
  date: "2099-12-01",
  time: "18:00",
  screenType: "standard",
  price: 500,
  currency: "BDT",
  availableSeats: 4,
  totalSeats: 5,
  bookingUrl: "https://kichole.com/shows/fixture/seats",
};
const input = () =>
  validateTask({
    movieName: "Fixture movie",
    targetDate: show.date,
    requiredSeats: 2,
    allowedRows: ["B"],
    autoReserve: true,
  });
const html = (acceptSelection = true) =>
  `<!doctype html><html><body><main><h1>Fixture cinema</h1><div style="display:flex;gap:5px">${[1, 2, 3, 4, 5].map((n) => `<button data-seat-label="B${n}" aria-selected="false" ${n === 5 ? "disabled" : ""} style="width:30px;height:34px" onclick="${acceptSelection ? `this.setAttribute('aria-selected',this.getAttribute('aria-selected')==='true'?'false':'true');document.querySelector('#proceed').disabled=document.querySelectorAll('[aria-selected=true]').length!==2;` : ""}">B${n}</button>`).join("")}</div><button id="proceed" disabled onclick="location.href='/checkout'">Proceed to checkout</button></main></body></html>`;

test("bot selects the exact live group and only then advances to checkout", async ({
  page,
  context,
}) => {
  await context.route("https://kichole.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().includes("/checkout")
        ? "<h1>Payment fixture</h1>"
        : html(),
    }),
  );
  await page.goto(show.bookingUrl);
  const driver = new BrowserDriver(".bot-test-data/unused-profile", true);
  Object.assign(driver, {
    context,
    pages: new Map([["fixture-task:fixture", page]]),
  });
  const result = await driver.reserve(
    "fixture-task",
    show,
    input(),
    new AbortController().signal,
  );
  expect(result.status).toBe("awaiting_payment");
  expect(result.selectedSeats).toHaveLength(2);
  expect(result.selectedSeats).not.toContain("B5");
  expect(page.url()).toContain("/checkout");
});

test("a rejected click does not report a reservation or advance checkout", async ({
  page,
  context,
}) => {
  await context.route("https://kichole.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html(false) }),
  );
  await page.goto(show.bookingUrl);
  const driver = new BrowserDriver(".bot-test-data/unused-profile", true);
  Object.assign(driver, {
    context,
    pages: new Map([["fixture-task:fixture", page]]),
  });
  const result = await driver.reserve(
    "fixture-task",
    show,
    input(),
    new AbortController().signal,
  );
  expect(result.status).toBe("awaiting_user");
  expect(result.selectedSeats).toEqual([]);
  expect(page.url()).toContain("/seats");
});

test("an already cancelled operation cannot click or navigate", async ({
  page,
  context,
}) => {
  const driver = new BrowserDriver(".bot-test-data/unused-profile", true);
  Object.assign(driver, { context });
  const control = new AbortController();
  control.abort();
  await expect(
    driver.reserve("fixture-task", show, input(), control.signal),
  ).rejects.toThrow();
  expect(page.url()).toBe("about:blank");
});

test("preselected extra seats require review instead of adding an unintended ticket", async ({
  page,
  context,
}) => {
  await context.route("https://kichole.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html() }),
  );
  await page.goto(show.bookingUrl);
  await page
    .locator('[data-seat-label="B5"]')
    .evaluate((el) => el.setAttribute("aria-selected", "true"));
  const driver = new BrowserDriver(".bot-test-data/unused-profile", true);
  Object.assign(driver, {
    context,
    pages: new Map([["fixture-task:fixture", page]]),
  });
  const result = await driver.reserve(
    "fixture-task",
    show,
    input(),
    new AbortController().signal,
  );
  expect(result.status).toBe("awaiting_user");
  expect(result.message).toContain("already selected");
  expect(await page.locator('[aria-selected="true"]').count()).toBe(1);
  expect(page.url()).toContain("/seats");
});
