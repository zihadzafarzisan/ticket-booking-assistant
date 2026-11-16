import { test, expect } from "@playwright/test";
import { BrowserDriver } from "../../bot/src/browser";
import { validateTask } from "../../bot/src/contracts";

test("handles reversed numbering with opaque provider seat IDs", async ({
  page,
  context,
}) => {
  const body = `<!doctype html><html><body><div style="display:flex;gap:5px">${[5, 4, 3, 2, 1].map((n) => `<button role="gridcell" data-seat-id="uuid-${n}" data-category="premium" data-status="available" data-seat-state="available" aria-label="Row B seat B0${n}, available, premium" aria-selected="false" style="width:30px;height:34px" onclick="this.setAttribute('aria-selected','true');this.setAttribute('data-seat-state','selected');document.querySelector('#proceed').disabled=document.querySelectorAll('[aria-selected=true]').length!==2;">${n}</button>`).join("")}</div><button id="proceed" disabled onclick="location.href='/checkout'">Continue</button></body></html>`;
  await context.route("https://kichole.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().includes("/checkout")
        ? "<h1>Payment fixture</h1>"
        : body,
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
  expect(
    Math.abs(
      Number(result.selectedSeats[0].slice(1)) -
        Number(result.selectedSeats[1].slice(1)),
    ),
  ).toBe(1);
});

test("waits for requested rows to hydrate and verifies aria-pressed selection", async ({
  page,
  context,
}) => {
  const body = `<!doctype html><html><body><div style="display:flex;gap:5px">${[1, 2].map((n) => `<button data-seat-id="L${n}" style="width:30px;height:34px">L${n}</button>`).join("")}</div><button id="proceed" disabled onclick="location.href='/checkout'">Continue</button><script>setTimeout(()=>{const row=document.createElement('div');row.style.cssText='display:flex;gap:5px';for(let n=1;n<=4;n++){const seat=document.createElement('button');seat.setAttribute('data-seat-id','uuid-b-'+n);seat.setAttribute('aria-label','Row B seat B0'+n+', available');seat.setAttribute('aria-pressed','false');seat.style.cssText='width:30px;height:34px';seat.textContent=String(n);seat.onclick=()=>{seat.setAttribute('aria-pressed',seat.getAttribute('aria-pressed')==='true'?'false':'true');document.querySelector('#proceed').disabled=document.querySelectorAll('[aria-pressed=true]').length!==2;};row.appendChild(seat);}document.body.appendChild(row);},350);</script></body></html>`;
  await context.route("https://kichole.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().includes("/checkout")
        ? "<h1>Payment fixture</h1>"
        : body,
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
  expect(result.selectedSeats.every((label) => label.startsWith("B"))).toBe(
    true,
  );
});
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
