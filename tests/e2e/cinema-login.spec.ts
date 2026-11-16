import { test, expect } from "@playwright/test";
import { BrowserDriver } from "../../bot/src/browser";
import { handleCinemaLogin } from "../../bot/src/cinema-login";
import { validateTask } from "../../bot/src/contracts";
import type { CredentialStore } from "../../bot/src/credentials";
import type { Showtime } from "../../packages/core/src";

const credentials = {
  email: "fixture@example.com",
  password: "fixture-password-123",
};
const show: Showtime = {
  id: "login-fixture",
  movie: { id: "m", title: "Fixture" },
  cinema: { id: "star-cineplex", name: "Fixture", location: "Dhaka" },
  hall: { id: "h", name: "Hall", screenType: "standard", capacity: 4 },
  date: "2099-12-01",
  time: "18:00",
  screenType: "standard",
  price: 500,
  currency: "BDT",
  availableSeats: 4,
  totalSeats: 4,
  bookingUrl: "https://starcineplex.com/shows/login-fixture/seats",
};
const task = () =>
  validateTask({
    movieName: "Fixture",
    targetDate: show.date,
    requiredSeats: 2,
    allowedRows: ["B"],
    autoReserve: true,
  });
const login = (destination: string, action = "/session") =>
  `<form action="${action}" onsubmit="event.preventDefault();fetch(this.action,{method:'POST',body:JSON.stringify({email:this.email.value,password:this.password.value})}).then(()=>location.href='${destination}')"><label>Email<input name="email" type="email" autocomplete="email"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>`;
const seats = (destination: string) =>
  `<div style="display:flex;gap:5px">${[1, 2, 3, 4].map((n) => `<button data-seat-label="B${n}" aria-selected="false" style="width:30px;height:34px" onclick="this.setAttribute('aria-selected','true');document.querySelector('#continue').disabled=document.querySelectorAll('[aria-selected=true]').length!==2">B${n}</button>`).join("")}</div><button id="continue" disabled onclick="location.href='${destination}'">Continue</button>`;

for (const phase of ["before seats", "at checkout"] as const) {
  test(`uses saved Cineplex credentials ${phase} and stops at payment`, async ({
    page,
    context,
  }) => {
    let loggedIn = false;
    const submitted: unknown[] = [];
    await context.route("https://starcineplex.com/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/session") {
        submitted.push(route.request().postDataJSON());
        loggedIn = true;
        await route.fulfill({ json: { ok: true } });
        return;
      }
      const body =
        path === "/checkout"
          ? "<h1>Payment fixture</h1><button>Pay now</button>"
          : path === "/login"
            ? login("/checkout")
            : !loggedIn && phase === "before seats"
              ? login("/shows/login-fixture/seats")
              : seats(phase === "at checkout" ? "/login" : "/checkout");
      await route.fulfill({ contentType: "text/html", body });
    });
    await page.goto(show.bookingUrl);
    const driver = new BrowserDriver(".bot-test-data/unused", true, {
      credentials: { get: () => credentials } as CredentialStore,
    });
    Object.assign(driver, {
      context,
      pages: new Map([["fixture:login-fixture", page]]),
    });
    const result = await driver.reserve(
      "fixture",
      show,
      task(),
      new AbortController().signal,
    );
    expect(result.status).toBe("awaiting_payment");
    expect(result.selectedSeats).toHaveLength(2);
    expect(submitted).toEqual([credentials]);
    expect(JSON.stringify(result)).not.toContain(credentials.password);
    await expect(page.getByRole("button", { name: "Pay now" })).toBeVisible();
  });
}

test("checkout login without credentials remains a manual handoff", async ({
  page,
  context,
}) => {
  await context.route("https://starcineplex.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        new URL(route.request().url()).pathname === "/login"
          ? login("/checkout")
          : seats("/login"),
    }),
  );
  await page.goto(show.bookingUrl);
  const driver = new BrowserDriver(".bot-test-data/unused", true);
  Object.assign(driver, {
    context,
    pages: new Map([["fixture:login-fixture", page]]),
  });
  const result = await driver.reserve(
    "fixture",
    show,
    task(),
    new AbortController().signal,
  );
  expect(result.status).toBe("awaiting_user");
  expect(result.message).toContain("requires login");
  expect(result.selectedSeats).toHaveLength(2);
  expect(await page.locator('input[type="password"]').inputValue()).toBe("");
});

test("refuses external login forms and leaves OTP to the user", async ({
  page,
  context,
}) => {
  await context.route("https://starcineplex.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: login("/checkout", "https://external.example/session"),
    }),
  );
  await page.goto(show.bookingUrl);
  const result = await handleCinemaLogin(
    page,
    credentials,
    { submitted: false },
    new AbortController().signal,
  );
  expect(result).toContain("outside");
  expect(await page.locator('input[type="password"]').inputValue()).toBe("");
  await page.setContent(
    '<label>Code<input autocomplete="one-time-code"></label>',
  );
  expect(
    await handleCinemaLogin(
      page,
      credentials,
      { submitted: false },
      new AbortController().signal,
    ),
  ).toContain("OTP or CAPTCHA");
});

test("an unsuccessful password is submitted only once and never reported as payment ready", async ({
  page,
  context,
}) => {
  let submissions = 0;
  await context.route("https://starcineplex.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<form onsubmit="event.preventDefault();document.querySelector(\'#error\').textContent=\'Invalid credentials\'"><input type="email" name="email"><input type="password"><button>Sign in</button><p id="error"></p></form>',
    }),
  );
  await page.goto(show.bookingUrl);
  await page.exposeFunction("countSubmit", () => {
    submissions++;
  });
  await page
    .locator("form")
    .evaluate((form) =>
      form.addEventListener("submit", () =>
        (window as unknown as { countSubmit(): void }).countSubmit(),
      ),
    );
  const attempt = { submitted: false };
  const first = await handleCinemaLogin(
    page,
    credentials,
    attempt,
    new AbortController().signal,
  );
  expect(first).toContain("did not complete login");
  expect(submissions).toBe(1);
  expect(
    await handleCinemaLogin(
      page,
      credentials,
      attempt,
      new AbortController().signal,
    ),
  ).toContain("not completed");
  expect(submissions).toBe(1);
});
