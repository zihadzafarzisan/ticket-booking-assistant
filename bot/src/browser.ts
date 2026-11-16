import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { eligibleBlocks } from "./discovery";
import { selectOptimalSeats } from "../../packages/core/src";
import type { Seat, Showtime } from "../../packages/core/src";
import type { BrowserStatus, Handoff, TaskInput } from "./contracts";
import type { BrowserConnection } from "./browser-connection";
import type { CredentialStore } from "./credentials";
import { handleCinemaLogin, isCinemaUrl } from "./cinema-login";

export interface BrowserPort {
  status(): BrowserStatus;
  openSession(connectOnly?: boolean): Promise<void>;
  reserve(
    taskId: string,
    showtime: Showtime,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<Handoff>;
  focus(taskId: string, showtime: Showtime): Promise<void>;
  cancel(taskId: string): Promise<void>;
  close(): Promise<void>;
}

export function allowedBookingUrl(raw: string): string {
  const url = new URL(raw);
  const hosts = [
    "kichole.com",
    "starcineplex.com",
    "cineplexbd.com",
    "cineplex.com.bd",
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !hosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new Error("Unsupported cinema booking URL.");
  return url.href;
}

export class BrowserDriver implements BrowserPort {
  private context?: BrowserContext;
  private launching?: Promise<BrowserContext>;
  private pages = new Map<string, Page>();
  private bookingQueue: Promise<unknown> = Promise.resolve();
  constructor(
    private profilePath: string,
    private headless = false,
    private options: {
      connection?: BrowserConnection;
      credentials?: CredentialStore;
    } = {},
  ) {}
  status(): BrowserStatus {
    return {
      connected: !!this.context,
      pages: this.context?.pages().length || 0,
      headless: this.headless,
      mode: this.options.connection ? "regular" : "persistent",
    };
  }
  private async ensureContext(connectOnly = false): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      await mkdir(this.profilePath, { recursive: true });
      const context = this.options.connection
        ? await (connectOnly
            ? this.options.connection.connect()
            : this.options.connection.openRegular())
        : await chromium.launchPersistentContext(this.profilePath, {
            headless: this.headless,
            viewport: null,
          });
      this.context = context;
      context.on("close", () => {
        if (this.context === context) {
          this.context = undefined;
          this.pages.clear();
        }
      });
      return context;
    })();
    try {
      return await this.launching;
    } finally {
      this.launching = undefined;
    }
  }
  async openSession(connectOnly = false) {
    const context = await this.ensureContext(connectOnly);
    let page = context.pages().find((p) => isCinemaUrl(p.url()));
    if (!page) {
      page = await context.newPage();
      await page.goto("https://kichole.com/?tenant=star-cineplex", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    }
    await page.bringToFront();
  }
  async focus(taskId: string, show: Showtime) {
    const page = this.pages.get(`${taskId}:${show.id}`);
    if (page && !page.isClosed()) {
      await page.bringToFront();
      return;
    }
    const context = await this.ensureContext();
    const opened = await context.newPage();
    this.pages.set(`${taskId}:${show.id}`, opened);
    await opened.goto(allowedBookingUrl(show.bookingUrl), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await opened.bringToFront();
  }
  reserve(
    taskId: string,
    show: Showtime,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<Handoff> {
    const next = this.bookingQueue
      .catch(() => {})
      .then(() => this.performReservation(taskId, show, input, signal));
    this.bookingQueue = next;
    return next;
  }
  private async performReservation(
    taskId: string,
    show: Showtime,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<Handoff> {
    signal.throwIfAborted();
    const url = allowedBookingUrl(show.bookingUrl);
    const context = await this.ensureContext();
    signal.throwIfAborted();
    const key = `${taskId}:${show.id}`;
    let page = this.pages.get(key);
    if (!page || page.isClosed()) {
      page = await context.newPage();
      this.pages.set(key, page);
    }
    signal.throwIfAborted();
    await page.bringToFront();
    if (!page.url().includes(`/shows/${show.id}/seats`))
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    signal.throwIfAborted();
    const userHandoff = (
      message: string,
      selectedSeats: string[] = [],
    ): Handoff => ({
      status: "awaiting_user",
      message,
      url: page!.url(),
      selectedSeats,
    });
    const body = await page.locator("body").innerText();
    if (/verify you are human|contact counter|online sales.*closed/i.test(body))
      return userHandoff(
        "The cinema needs your attention. Complete login or the on-screen step, then retry selection here.",
      );
    const loginAttempt = { submitted: false };
    const loginMessage = await handleCinemaLogin(
      page,
      this.options.credentials?.get(),
      loginAttempt,
      signal,
    );
    if (loginMessage) return userHandoff(loginMessage);
    try {
      await page.waitForSelector(
        '[data-seat-id], [data-seat-label], [role="gridcell"], button[aria-label*="seat" i]',
        { state: "visible", timeout: 12_000 },
      );
    } catch {
      signal.throwIfAborted();
      return userHandoff(
        "The seat map is not ready. Complete any login step in the browser, then retry selection.",
      );
    }
    signal.throwIfAborted();
    let liveSeats = await page.evaluate(readLiveSeats);
    const rowsReady = () =>
      liveSeats.length > 0 &&
      (!input.allowedRows.length ||
        liveSeats.some((seat) => input.allowedRows.includes(seat.row)));
    const hydrationDeadline = Date.now() + 5000;
    while (!rowsReady() && Date.now() < hydrationDeadline) {
      signal.throwIfAborted();
      await new Promise((done) => setTimeout(done, 100));
      liveSeats = await page.evaluate(readLiveSeats);
    }
    signal.throwIfAborted();
    const rows = new Map<string, Seat[]>();
    // Separate physical arms before using the shared block detector.
    const grouped = new Map<string, typeof liveSeats>();
    for (const seat of liveSeats) {
      const list = grouped.get(seat.row) || [];
      list.push(seat);
      grouped.set(seat.row, list);
    }
    for (const [row, seats] of grouped) {
      seats.sort((a, b) => a.x - b.x);
      let arm = 0;
      let previous: (typeof seats)[number] | undefined;
      const widths = seats
        .map((s) => s.width)
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      const typical = widths[Math.floor(widths.length / 2)] || 30;
      for (const seat of seats) {
        if (
          previous &&
          (seat.x - previous.x > typical * 2.1 ||
            Math.abs(seat.number - previous.number) !== 1)
        )
          arm++;
        const group = `${row}:${arm}`;
        const normalized: Seat = {
          ...seat,
          id: seat.token,
        };
        const list = rows.get(group) || [];
        list.push(normalized);
        rows.set(group, list);
        previous = seat;
      }
    }
    // Row keys are physical arms; filter allowed rows on seat metadata first.
    for (const [key, seats] of rows)
      if (input.allowedRows.length && !input.allowedRows.includes(seats[0].row))
        rows.delete(key);
    const map = {
      cinemaId: show.cinema.id,
      movieId: show.movie.id,
      showtimeId: show.id,
      rows,
      blocks: [],
      hallName: show.hall.name,
      screenType: show.screenType,
      totalSeats: liveSeats.length,
      availableSeats: liveSeats.filter((s) => s.status === "available").length,
      fetchedAt: new Date(),
    };
    const blocks = eligibleBlocks(map, { ...input, allowedRows: [] });
    const selected = blocks.length
      ? selectOptimalSeats(blocks[0], input.requiredSeats)
      : [];
    if (selected.length !== input.requiredSeats)
      return userHandoff(
        `The live page has no matching group of ${input.requiredSeats} seats. Review the seat map or adjust this task.`,
      );
    const desiredLabels = new Set(selected.map((seat) => seat.label));
    if (
      liveSeats.some((seat) => seat.selected && !desiredLabels.has(seat.label))
    )
      return userHandoff(
        "Other seats are already selected on this page. Review or clear them in the browser, then retry selection.",
      );
    const labels: string[] = [];
    for (const seat of selected) {
      signal.throwIfAborted();
      const element = page.locator(`[data-ticket-bot-seat="${seat.id}"]`);
      const accepted = await element.evaluate(isSeatSelected);
      if (!accepted) {
        signal.throwIfAborted();
        await element.click({ timeout: 5000 });
        await page
          .waitForFunction(
            (token) => {
              const el = document.querySelector(
                `[data-ticket-bot-seat="${token}"]`,
              );
              return (
                !!el &&
                (el.getAttribute("aria-selected") === "true" ||
                  el.getAttribute("aria-checked") === "true" ||
                  el.getAttribute("aria-pressed") === "true" ||
                  el.getAttribute("data-seat-state") === "selected" ||
                  el.getAttribute("data-selected") === "true" ||
                  el.classList.contains("selected") ||
                  el.classList.contains("is-selected"))
              );
            },
            seat.id,
            { timeout: 2500 },
          )
          .catch(() => {});
      }
      signal.throwIfAborted();
      if (!(await element.evaluate(isSeatSelected)))
        return userHandoff(
          `Could not verify ${seat.label}. Please check the browser before continuing.`,
          labels,
        );
      labels.push(seat.label);
    }
    signal.throwIfAborted();
    const verified = (await page.evaluate(readLiveSeats)).filter(
      (seat) => seat.selected,
    );
    if (
      verified.length !== input.requiredSeats ||
      verified.some((seat) => !desiredLabels.has(seat.label))
    )
      return userHandoff(
        "The final seat selection changed. Review the browser before continuing.",
        labels,
      );
    signal.throwIfAborted();
    const checkout = page
      .getByRole("button", {
        name: /^(proceed to checkout|proceed|continue|buy tickets|next)(\b|$)/i,
      })
      .filter({ visible: true })
      .first();
    if ((await checkout.count()) && (await checkout.isEnabled())) {
      signal.throwIfAborted();
      await checkout.click({ timeout: 5000 });
      // Login can appear as a dialog or a redirect only after seats are selected.
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await Promise.race([
        page
          .waitForURL(/\/(checkout|payment|login|signin)(\/|\?|$)/, {
            timeout: 2000,
          })
          .catch(() => {}),
        page
          .locator('input[type="password"]')
          .first()
          .waitFor({ state: "visible", timeout: 2000 })
          .catch(() => {}),
      ]);
      const checkoutLogin = await handleCinemaLogin(
        page,
        this.options.credentials?.get(),
        loginAttempt,
        signal,
      );
      if (checkoutLogin) return userHandoff(checkoutLogin, labels);
      if (
        loginAttempt.submitted &&
        !/\/(checkout|payment)(\/|\?|$)/.test(new URL(page.url()).pathname)
      ) {
        const stillSelected = (await page.evaluate(readLiveSeats)).filter(
          (seat) => seat.selected,
        );
        if (
          stillSelected.length === input.requiredSeats &&
          stillSelected.every((seat) => desiredLabels.has(seat.label)) &&
          (await checkout.isVisible()) &&
          (await checkout.isEnabled())
        ) {
          signal.throwIfAborted();
          await checkout.click({ timeout: 5000 });
        }
      }
      await page
        .waitForURL(/\/(checkout|payment)(\/|\?|$)/, { timeout: 10_000 })
        .catch(() => {});
    }
    signal.throwIfAborted();
    const finalLogin = await handleCinemaLogin(
      page,
      this.options.credentials?.get(),
      loginAttempt,
      signal,
    );
    if (finalLogin) return userHandoff(finalLogin, labels);
    if (/\/(checkout|payment)(\/|\?|$)/.test(new URL(page.url()).pathname))
      return {
        status: "awaiting_payment",
        message:
          "Seat selection was verified and the checkout page is open. Complete payment in your browser.",
        url: page.url(),
        selectedSeats: labels,
      };
    return userHandoff(
      "The requested seats are selected. Finish the next cinema step in the browser.",
      labels,
    );
  }
  async cancel(taskId: string) {
    // Closing in-progress selection pages cancels pending locator/navigation operations.
    for (const [key, page] of this.pages)
      if (key.startsWith(`${taskId}:`)) {
        await page.close().catch(() => {});
        this.pages.delete(key);
      }
  }
  async close() {
    if (this.options.connection) await this.options.connection.disconnect();
    else await this.context?.close();
    this.context = undefined;
    this.pages.clear();
  }
}

export function isSeatSelected(el: Element): boolean {
  return (
    el.getAttribute("aria-selected") === "true" ||
    el.getAttribute("aria-checked") === "true" ||
    el.getAttribute("aria-pressed") === "true" ||
    el.getAttribute("data-seat-state") === "selected" ||
    el.getAttribute("data-selected") === "true" ||
    el.classList.contains("selected") ||
    el.classList.contains("is-selected")
  );
}

// Self-contained because Playwright serializes this function into the cinema page.
export function readLiveSeats() {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-seat-id], [data-seat-label], [role="gridcell"], button[aria-label*="seat" i]',
    ),
  );
  const seen = new Set<string>();
  const result: Array<{
    id: string;
    token: string;
    row: string;
    number: number;
    label: string;
    status: "available" | "occupied";
    category?: Seat["category"];
    x: number;
    y: number;
    width: number;
    selected: boolean;
  }> = [];
  for (const el of nodes) {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const data = (el.getAttribute("data-seat-label") || "")
      .trim()
      .toUpperCase();
    const opaqueId = (el.getAttribute("data-seat-id") || "")
      .trim()
      .toUpperCase();
    const aria = (el.getAttribute("aria-label") || "").toUpperCase();
    const text = (el.textContent || "").trim().toUpperCase();
    let match = data.match(/^([A-Z]+)[ -]?0*(\d+)$/);
    if (!match) {
      const row = aria.match(/ROW:?\s*([A-Z]+)/);
      const num = aria.match(/SEAT:?\s*(?:[A-Z]+)?0*(\d+)/);
      if (row && num) match = [aria, row[1], num[1]];
    }
    if (!match)
      match =
        text.match(/^([A-Z]+)[ -]?0*(\d+)$/) ||
        opaqueId.match(/^([A-Z]+)[ -]?0*(\d+)$/);
    if (!match) continue;
    const row = match[1];
    const number = Number(match[2]);
    const label = `${row}${number}`;
    if (seen.has(label)) continue;
    seen.add(label);
    const token = `seat-${result.length}`;
    el.setAttribute("data-ticket-bot-seat", token);
    const unavailable =
      el.hasAttribute("disabled") ||
      el.getAttribute("aria-disabled") === "true" ||
      el.getAttribute("data-seat-disabled") === "true" ||
      el.getAttribute("data-seat-readonly") === "true" ||
      /(^|\s)(occupied|booked|sold|unavailable|blocked)(\s|$)/i.test(
        el.className?.toString() || "",
      ) ||
      /\b(occupied|booked|sold|unavailable)\b/i.test(aria) ||
      ["occupied", "booked", "sold", "unavailable", "blocked"].includes(
        el.getAttribute("data-status") || "",
      );
    result.push({
      id: token,
      token,
      row,
      number,
      label,
      status: unavailable ? "occupied" : "available",
      selected:
        el.getAttribute("aria-selected") === "true" ||
        el.getAttribute("aria-checked") === "true" ||
        el.getAttribute("aria-pressed") === "true" ||
        el.getAttribute("data-seat-state") === "selected" ||
        el.getAttribute("data-selected") === "true" ||
        el.classList.contains("selected") ||
        el.classList.contains("is-selected"),
      category: (el.getAttribute("data-category") ||
        undefined) as Seat["category"],
      x: box.x,
      y: box.y,
      width: box.width,
    });
  }
  return result;
}
