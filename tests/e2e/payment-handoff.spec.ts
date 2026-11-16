import { test, expect } from "@playwright/test";
import { BrowserDriver } from "../../bot/src/browser";
import { validateTask } from "../../bot/src/contracts";
import { openPaymentGateway } from "../../bot/src/payment-handoff";
import type { Showtime } from "../../packages/core/src";

const show: Showtime = {
  id: "gateway-fixture",
  movie: { id: "fixture-movie", title: "Fixture movie" },
  cinema: { id: "star-cineplex", name: "Fixture", location: "Dhaka" },
  hall: { id: "h", name: "Hall", screenType: "standard", capacity: 4 },
  date: "2099-12-01",
  time: "18:00",
  screenType: "standard",
  price: 500,
  currency: "BDT",
  availableSeats: 4,
  totalSeats: 4,
  bookingUrl: "https://starcineplex.com/shows/gateway-fixture/seats",
};
const input = () =>
  validateTask({
    movieName: "Fixture movie",
    targetDate: show.date,
    requiredSeats: 2,
    openPaymentGateway: true,
    allowedRows: ["B"],
  });
const seats = `<div style="display:flex;gap:5px">${[1, 2, 3, 4].map((number) => `<button data-seat-label="B${number}" aria-selected="false" style="width:30px;height:34px" onclick="this.setAttribute('aria-selected','true');document.querySelector('#continue').disabled=document.querySelectorAll('[aria-selected=true]').length!==2">B${number}</button>`).join("")}</div><button id="continue" disabled onclick="location.href='/checkout'">Continue</button>`;
const gateway =
  "https://securepay.sslcommerz.com/gwprocess/v4/gw.php?fixture=1";

for (const popup of [false, true])
  test(`verified seat selection opens a hosted gateway ${popup ? "in a popup" : "in the same tab"} and never pays`, async ({
    page,
    context,
  }) => {
    let seatPages = 0;
    await context.route("https://starcineplex.com/**", (route) => {
      const checkout = new URL(route.request().url()).pathname === "/checkout";
      if (!checkout) seatPages++;
      return route.fulfill({
        contentType: "text/html",
        body: checkout
          ? `<button onclick="${popup ? `window.open('${gateway}')` : `location.href='${gateway}'`}">Continue to payment</button>`
          : seats,
      });
    });
    await context.route("https://securepay.sslcommerz.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<h1>Hosted payment fixture</h1><input autocomplete="cc-number"><button onclick="window.paymentSubmitted=true">Pay now</button>',
      }),
    );
    await page.goto(show.bookingUrl);
    const driver = new BrowserDriver(".bot-test-data/unused", true);
    Object.assign(driver, {
      context,
      pages: new Map([["task:gateway-fixture", page]]),
    });
    const result = await driver.reserve(
      "task",
      show,
      input(),
      new AbortController().signal,
    );
    expect(result.status).toBe("awaiting_payment");
    expect(result.url).toBe(gateway);
    expect(result.selectedSeats).toHaveLength(2);
    expect(seatPages).toBe(1);
    const paymentPage = context.pages().find((item) => item.url() === gateway)!;
    expect(
      await paymentPage.evaluate(
        () =>
          (window as unknown as { paymentSubmitted?: boolean })
            .paymentSubmitted,
      ),
    ).toBeUndefined();
    const repeated = await driver.reserve(
      "task",
      show,
      input(),
      new AbortController().signal,
    );
    expect(repeated.status).toBe("awaiting_payment");
    expect(seatPages).toBe(1);
  });

test("checkout details remain manual and retry keeps the existing seat selection", async ({
  page,
  context,
}) => {
  let seatPages = 0;
  await context.route("https://starcineplex.com/**", (route) => {
    const checkout = new URL(route.request().url()).pathname === "/checkout";
    if (!checkout) seatPages++;
    return route.fulfill({
      contentType: "text/html",
      body: checkout
        ? `<label>Contact<input id="contact" oninput="document.querySelector('#payment').disabled=!this.value"></label><button id="payment" disabled onclick="location.href='${gateway}'">Proceed to payment</button>`
        : seats,
    });
  });
  await context.route("https://securepay.sslcommerz.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Payment fixture</h1>",
    }),
  );
  await page.goto(show.bookingUrl);
  const driver = new BrowserDriver(".bot-test-data/unused", true);
  Object.assign(driver, {
    context,
    pages: new Map([["task:gateway-fixture", page]]),
  });
  const result = await driver.reserve(
    "task",
    show,
    input(),
    new AbortController().signal,
  );
  expect(result.status).toBe("awaiting_user");
  expect(result.message).toContain("checkout details");
  expect(result.selectedSeats).toHaveLength(2);
  await page.getByLabel("Contact", { exact: true }).fill("Fixture contact");
  const retry = await driver.reserve(
    "task",
    show,
    input(),
    new AbortController().signal,
  );
  expect(retry.status).toBe("awaiting_payment");
  expect(seatPages).toBe(1);
});

test("ambiguous charge controls and unrecognized gateway links stay manual", async ({
  page,
  context,
}) => {
  await context.route("https://starcineplex.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<button onclick="window.charged=true">Pay now</button><a href="https://securepay.sslcommerz.com.attacker.example/pay">Continue to payment</a>',
    }),
  );
  await page.goto("https://starcineplex.com/checkout");
  const result = await openPaymentGateway(
    page,
    undefined,
    { submitted: false },
    new AbortController().signal,
  );
  expect(result.ready).toBe(false);
  expect(page.url()).toBe("https://starcineplex.com/checkout");
  expect(
    await page.evaluate(
      () => (window as unknown as { charged?: boolean }).charged,
    ),
  ).toBeUndefined();
  const control = new AbortController();
  control.abort();
  await expect(
    openPaymentGateway(page, undefined, { submitted: false }, control.signal),
  ).rejects.toThrow();
});
