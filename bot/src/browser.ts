import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { eligibleBlocks } from "./discovery";
import { selectOptimalSeats } from "../../packages/core/src";
import type { Seat, SeatCategory, Showtime } from "../../packages/core/src";
import type { BrowserStatus, Handoff, TaskInput } from "./contracts";
import type { BrowserConnection } from "./browser-connection";
import type { CredentialStore } from "./credentials";
import {
  handleCinemaLogin,
  isCinemaUrl,
  type LoginAttempt,
} from "./cinema-login";
import { isPaymentGatewayUrl, openPaymentGateway } from "./payment-handoff";

export type HandoffReason =
  | "exact_seats_unavailable"
  | "seat_stolen_mid_click"
  | "login_required"
  | "captcha_required"
  | "checkout_blocked"
  | "seat_map_not_ready";

export type BrowserHandoff = Handoff & {
  retryable?: boolean;
  reason?: HandoffReason;
};

export interface PageRefreshResult {
  refreshedAt: string;
  latencyMs: number;
  url: string;
  pageReady: boolean;
  dropDetected: boolean;
  availableSeatCount: number;
  availableTargetSeats: string[];
  warning?: string;
  requiresUserAttention?: boolean;
}

type BrowserTaskInput = TaskInput & {
  targetSeats?: string[];
  exactSeatsOnly?: boolean;
  refreshBrowserPage?: boolean;
  preferredHall?: string;
  preferredShowtime?: string;
};

export interface BrowserPort {
  status(): BrowserStatus;
  onDisconnect?(listener: () => void): () => void;
  openSession(connectOnly?: boolean): Promise<void>;
  refreshPage?(
    taskId: string,
    targetUrl: string,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<PageRefreshResult>;
  reserve(
    taskId: string,
    showtime: Showtime,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<BrowserHandoff>;
  focus(taskId: string, showtime: Showtime): Promise<void>;
  cancel(taskId: string): Promise<void>;
  close(): Promise<void>;
}

const SEAT_DOM_SELECTOR = [
  "[data-seat-id]",
  "[data-seat-label]",
  "[data-seat]",
  "[data-seat-name]",
  "[data-seat-number]",
  '[role="gridcell"]',
  'button[aria-label*="seat" i]',
  'button[title*="seat" i]',
].join(", ");

const SEAT_CONFLICT_PATTERN =
  /\b(seat.*(booked|taken|unavailable|reserved|locked|sold)|already\s+(booked|taken|reserved|sold)|no longer available|selection\s+(expired|failed))\b/i;

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

export function normalizeSeatLabel(raw: string): string | undefined {
  const trimmed = raw.trim().toUpperCase();
  const direct = trimmed.match(/^([A-Z]{1,3})[\s-]*0*([1-9]\d{0,2})$/);
  if (direct) return `${direct[1]}${Number(direct[2])}`;
  const row = trimmed.match(/\bROW:?\s*([A-Z]{1,3})\b/);
  const num = trimmed.match(
    /\bSEAT:?\s*(?:[A-Z]{1,3}[\s-]*)?0*([1-9]\d{0,2})\b/,
  );
  if (row && num) return `${row[1]}${Number(num[1])}`;
  return undefined;
}

function normalizeTargetSeats(input: BrowserTaskInput): string[] {
  const raw = input.targetSeats;
  if (!Array.isArray(raw) || !raw.length) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const label = normalizeSeatLabel(item);
    if (label && !seen.has(label)) {
      seen.add(label);
      normalized.push(label);
    }
  }
  return normalized;
}

function isCheckoutOrPaymentUrl(raw: string): boolean {
  try {
    if (isPaymentGatewayUrl(raw)) return true;
    const parsed = new URL(raw);
    return /\/(checkout|payment)(\/|\?|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function sameTargetPage(current: string, target: string): boolean {
  try {
    const a = new URL(current);
    const b = new URL(target);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

function extractShowIdFromUrl(raw: string): string | undefined {
  try {
    const match = new URL(raw).pathname.match(/\/shows\/([^/]+)\/seats/i);
    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function cleanTransientError(error: unknown): string {
  const first = (error instanceof Error ? error.message : String(error))
    .split("\n")[0]
    .trim();
  return first.slice(0, 220) || "Transient browser refresh error.";
}

type LiveSeat = ReturnType<typeof readLiveSeats>[number];

export class BrowserDriver implements BrowserPort {
  private context?: BrowserContext;
  private launching?: Promise<BrowserContext>;
  private pages = new Map<string, Page>();
  private watchPages = new Map<string, Page>();
  private paymentKeys = new Set<string>();
  private selections = new Map<string, { input: string; labels: string[] }>();
  private watchLoginAttempts = new Map<string, LoginAttempt>();
  private refreshInFlight = new Map<string, Promise<PageRefreshResult>>();
  private bookingQueue: Promise<unknown> = Promise.resolve();
  private disconnectListeners = new Set<() => void>();
  private attachedPages = new WeakSet<Page>();
  private connectionUnsubscribe?: () => void;

  constructor(
    private profilePath: string,
    private headless = false,
    private options: {
      connection?: BrowserConnection;
      credentials?: CredentialStore;
    } = {},
  ) {
    if (this.options.connection?.onDisconnect) {
      this.connectionUnsubscribe = this.options.connection.onDisconnect(() => {
        this.handleContextDisconnected(this.context);
      });
    }
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  private emitDisconnect() {
    for (const listener of this.disconnectListeners) {
      try {
        listener();
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  private handleContextDisconnected(context?: BrowserContext) {
    if (!context || this.context !== context) return;
    this.context = undefined;
    this.pages.clear();
    this.watchPages.clear();
    this.paymentKeys.clear();
    this.selections.clear();
    this.watchLoginAttempts.clear();
    this.emitDisconnect();
  }

  private preparePage(page: Page) {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);
    page.on?.("dialog", (dialog) => {
      void dialog.dismiss().catch(() => {});
    });
    page.on?.("close", () => {
      for (const [key, tracked] of this.pages) {
        if (tracked === page) {
          this.pages.delete(key);
          this.selections.delete(key);
          this.paymentKeys.delete(key);
        }
      }
      for (const [taskId, tracked] of this.watchPages) {
        if (tracked === page) {
          this.watchPages.delete(taskId);
          this.watchLoginAttempts.delete(taskId);
        }
      }
    });
  }

  status(): BrowserStatus {
    const browserConnected = this.context?.browser?.()?.isConnected() ?? true;
    const connectionAlive = this.options.connection
      ? this.options.connection.isConnected()
      : true;
    const connected = !!this.context && browserConnected && connectionAlive;
    return {
      connected,
      pages: connected ? this.context?.pages().length || 0 : 0,
      headless: this.headless,
      mode: this.options.connection ? "regular" : "persistent",
    };
  }

  private async ensureContext(connectOnly = false): Promise<BrowserContext> {
    if (this.context) {
      const browser = this.context.browser?.();
      if (!browser || browser.isConnected()) return this.context;
      this.handleContextDisconnected(this.context);
    }
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
      context.on?.("close", () => {
        this.handleContextDisconnected(context);
      });
      context.browser?.()?.once?.("disconnected", () => {
        this.handleContextDisconnected(context);
      });
      return context;
    })();
    try {
      return await this.launching;
    } finally {
      this.launching = undefined;
    }
  }

  private async raiseWindow(page: Page) {
    await page.bringToFront().catch(() => {});
    if (this.headless) return;
    try {
      const cdp = await page.context().newCDPSession(page);
      const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as {
        windowId: number;
      };
      await cdp
        .send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "normal" },
        })
        .catch(() => {});
      await cdp.detach().catch(() => {});
    } catch {}
    await page.bringToFront().catch(() => {});
  }

  async openSession(connectOnly = false) {
    const context = await this.ensureContext(connectOnly);
    let page = context.pages().find((p) => isCinemaUrl(p.url()));
    if (!page) {
      page = await context.newPage();
      this.preparePage(page);
      await page.goto("https://kichole.com/?tenant=star-cineplex", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } else {
      this.preparePage(page);
    }
    await this.raiseWindow(page);
  }

  async focus(taskId: string, show: Showtime) {
    const key = `${taskId}:${show.id}`;
    const existing = this.pages.get(key) || this.watchPages.get(taskId);
    if (existing && !existing.isClosed()) {
      await this.raiseWindow(existing);
      return;
    }
    const context = await this.ensureContext();
    const opened = await context.newPage();
    this.preparePage(opened);
    this.pages.set(key, opened);
    await opened.goto(allowedBookingUrl(show.bookingUrl), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await this.raiseWindow(opened);
  }

  refreshPage(
    taskId: string,
    targetUrl: string,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<PageRefreshResult> {
    signal.throwIfAborted();
    const active = this.refreshInFlight.get(taskId);
    if (active) return active;
    const run = this.performRefreshPage(taskId, targetUrl, input, signal).finally(
      () => {
        if (this.refreshInFlight.get(taskId) === run)
          this.refreshInFlight.delete(taskId);
      },
    );
    this.refreshInFlight.set(taskId, run);
    return run;
  }

  private async performRefreshPage(
    taskId: string,
    targetUrl: string,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<PageRefreshResult> {
    const started = Date.now();
    const taskInput = input as BrowserTaskInput;
    const url = allowedBookingUrl(targetUrl);
    const targetSeats = normalizeTargetSeats(taskInput);
    const exactOnly = taskInput.exactSeatsOnly === true;
    const showId = extractShowIdFromUrl(url);
    const showKey = showId ? `${taskId}:${showId}` : undefined;

    signal.throwIfAborted();
    const context = await this.ensureContext();
    signal.throwIfAborted();

    let page =
      this.watchPages.get(taskId) ||
      (showKey ? this.pages.get(showKey) : undefined);

    // Never hijack or reload a page that already reached checkout/payment.
    if (
      page &&
      !page.isClosed() &&
      ((showKey && this.paymentKeys.has(showKey)) ||
        isCheckoutOrPaymentUrl(page.url()))
    ) {
      return {
        refreshedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        url: page.url(),
        pageReady: true,
        dropDetected: false,
        availableSeatCount: 0,
        availableTargetSeats: [],
      };
    }

    if (!page || page.isClosed()) {
      page = await context.newPage();
      this.preparePage(page);
      this.watchPages.set(taskId, page);
      if (showKey && !this.pages.has(showKey)) this.pages.set(showKey, page);
    } else {
      this.preparePage(page);
      this.watchPages.set(taskId, page);
      if (showKey && !this.pages.has(showKey)) this.pages.set(showKey, page);
    }

    try {
      signal.throwIfAborted();
      const response = sameTargetPage(page.url(), url)
        ? await page.reload({ waitUntil: "domcontentloaded", timeout: 8000 })
        : await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 });
      signal.throwIfAborted();

      if (response && response.status() >= 500) {
        return {
          refreshedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          url: page.url(),
          pageReady: false,
          dropDetected: false,
          availableSeatCount: 0,
          availableTargetSeats: [],
          warning: `Cineplex page returned HTTP ${response.status()}. Retrying on next tick.`,
        };
      }

      await dismissFloatingBanners(page);
      signal.throwIfAborted();

      const body = await page
        .locator("body")
        .innerText({ timeout: 2000 })
        .catch(() => "");
      if (/verify you are human/i.test(body)) {
        return {
          refreshedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          url: page.url(),
          pageReady: false,
          dropDetected: false,
          availableSeatCount: 0,
          availableTargetSeats: [],
          requiresUserAttention: true,
          warning:
            "Complete the cinema verification challenge in your browser to resume live page monitoring.",
        };
      }

      const attempt = this.watchLoginAttempts.get(taskId) || {
        submitted: false,
      };
      this.watchLoginAttempts.set(taskId, attempt);
      const loginMessage = await handleCinemaLogin(
        page,
        this.options.credentials?.get(),
        attempt,
        signal,
      );
      if (loginMessage) {
        return {
          refreshedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          url: page.url(),
          pageReady: false,
          dropDetected: false,
          availableSeatCount: 0,
          availableTargetSeats: [],
          requiresUserAttention: true,
          warning: loginMessage,
        };
      }

      // Brief bounded hydration check (stays well under 1s cadence).
      let liveSeats = await page.evaluate(readLiveSeats).catch(() => []);
      if (!liveSeats.length) {
        const seatAppeared = await page
          .locator(SEAT_DOM_SELECTOR)
          .first()
          .waitFor({ state: "visible", timeout: 350 })
          .then(() => true)
          .catch(() => false);
        signal.throwIfAborted();
        if (seatAppeared) {
          liveSeats = await page.evaluate(readLiveSeats).catch(() => []);
        }
      }

      const available = liveSeats.filter((s) => s.status === "available");
      const availableSet = new Set(available.map((s) => s.label));
      const availableTargetSeats = targetSeats.filter((label) =>
        availableSet.has(label),
      );
      const dropDetected = targetSeats.length
        ? exactOnly
          ? availableTargetSeats.length === targetSeats.length
          : availableTargetSeats.length === targetSeats.length ||
            available.length >= input.requiredSeats
        : available.length >= input.requiredSeats;

      return {
        refreshedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        url: page.url(),
        pageReady: true,
        dropDetected,
        availableSeatCount: available.length,
        availableTargetSeats,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      if (page.isClosed()) {
        if (this.watchPages.get(taskId) === page) this.watchPages.delete(taskId);
        if (showKey && this.pages.get(showKey) === page) this.pages.delete(showKey);
      }
      return {
        refreshedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        url: page.isClosed() ? url : page.url(),
        pageReady: false,
        dropDetected: false,
        availableSeatCount: 0,
        availableTargetSeats: [],
        warning: cleanTransientError(error),
      };
    }
  }

  reserve(
    taskId: string,
    show: Showtime,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<BrowserHandoff> {
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
  ): Promise<BrowserHandoff> {
    signal.throwIfAborted();
    const taskInput = input as BrowserTaskInput;
    const targetSeats = normalizeTargetSeats(taskInput);
    const exactOnly = taskInput.exactSeatsOnly === true;
    const url = allowedBookingUrl(show.bookingUrl);
    const context = await this.ensureContext();
    signal.throwIfAborted();

    const key = `${taskId}:${show.id}`;
    let page = this.pages.get(key);
    const previous = this.selections.get(key);

    if (
      input.openPaymentGateway &&
      page &&
      !page.isClosed() &&
      previous?.input === JSON.stringify(input) &&
      isCheckoutOrPaymentUrl(page.url())
    ) {
      await page.bringToFront();
      return this.gatewayHandoff(key, page, previous.labels, signal);
    }

    // Reuse pre-warmed watch tab if it is already pointing at this show.
    if (!page || page.isClosed()) {
      const watch = this.watchPages.get(taskId);
      if (
        watch &&
        !watch.isClosed() &&
        !isCheckoutOrPaymentUrl(watch.url()) &&
        watch.url().includes(`/shows/${show.id}/seats`)
      ) {
        page = watch;
        this.pages.set(key, page);
      } else {
        page = await context.newPage();
        this.pages.set(key, page);
      }
    }
    this.preparePage(page);

    signal.throwIfAborted();
    await page.bringToFront();
    if (!page.url().includes(`/shows/${show.id}/seats`)) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    signal.throwIfAborted();

    const userHandoff = (
      message: string,
      selectedSeats: string[] = [],
      extra: { retryable?: boolean; reason?: HandoffReason } = {},
    ): BrowserHandoff => ({
      status: "awaiting_user",
      message,
      url: page!.url(),
      selectedSeats,
      ...extra,
    });

    const body = await page
      .locator("body")
      .innerText({ timeout: 5000 })
      .catch(() => "");
    if (/verify you are human/i.test(body))
      return userHandoff(
        "The cinema needs your attention. Complete login or the on-screen step, then retry selection here.",
        [],
        { reason: "captcha_required" },
      );
    if (/contact counter|online sales.*closed/i.test(body))
      return userHandoff(
        "The cinema needs your attention. Complete login or the on-screen step, then retry selection here.",
        [],
        { reason: "seat_map_not_ready" },
      );

    const loginAttempt: LoginAttempt = { submitted: false };
    const loginMessage = await handleCinemaLogin(
      page,
      this.options.credentials?.get(),
      loginAttempt,
      signal,
    );
    if (loginMessage) {
      return userHandoff(loginMessage, [], {
        reason: /OTP or CAPTCHA/i.test(loginMessage)
          ? "captcha_required"
          : "login_required",
      });
    }

    try {
      await page.waitForSelector(SEAT_DOM_SELECTOR, {
        state: "visible",
        timeout: 12_000,
      });
    } catch {
      signal.throwIfAborted();
      return userHandoff(
        "The seat map is not ready. Complete any login step in the browser, then retry selection.",
        [],
        { reason: "seat_map_not_ready" },
      );
    }
    signal.throwIfAborted();

    let liveSeats = await page.evaluate(readLiveSeats);
    const rowsReady = () => {
      if (!liveSeats.length) return false;
      if (targetSeats.length) {
        const present = new Set(liveSeats.map((s) => s.label));
        return targetSeats.every((label) => present.has(label));
      }
      return (
        !input.allowedRows.length ||
        liveSeats.some((seat) => input.allowedRows.includes(seat.row))
      );
    };
    const hydrationMs =
      liveSeats.length > 0 && targetSeats.length > 0 ? 1500 : 5000;
    const hydrationDeadline = Date.now() + hydrationMs;
    while (!rowsReady() && Date.now() < hydrationDeadline) {
      await abortableDelay(100, signal);
      liveSeats = await page.evaluate(readLiveSeats);
    }
    signal.throwIfAborted();

    let usingExactTarget = false;
    let selected: Seat[] = [];
    if (targetSeats.length) {
      const byLabel = new Map(liveSeats.map((s) => [s.label, s]));
      const exactMatches = targetSeats
        .map((label) => byLabel.get(label))
        .filter(
          (s): s is LiveSeat =>
            !!s && (s.status === "available" || s.selected),
        );
      if (exactMatches.length === targetSeats.length) {
        usingExactTarget = true;
        selected = exactMatches.map((s) => ({ ...s, id: s.token }));
      } else if (exactOnly) {
        const missing = targetSeats.filter((label) => {
          const seat = byLabel.get(label);
          return !seat || (seat.status !== "available" && !seat.selected);
        });
        return userHandoff(
          `Requested exact seats (${missing.join(", ")}) are not available on the live seat map.`,
          [],
          { retryable: true, reason: "exact_seats_unavailable" },
        );
      } else {
        selected = pickFallbackSeats(liveSeats, show, input);
      }
    } else {
      selected = pickFallbackSeats(liveSeats, show, input);
    }

    const expectedSeatCount = usingExactTarget
      ? targetSeats.length
      : input.requiredSeats;

    if (selected.length !== expectedSeatCount) {
      return userHandoff(
        `The live page has no matching group of ${expectedSeatCount} seats. Review the seat map or adjust this task.`,
        [],
        {
          retryable: targetSeats.length > 0,
          reason: "exact_seats_unavailable",
        },
      );
    }

    let desiredLabels = new Set(selected.map((seat) => seat.label));
    if (
      liveSeats.some((seat) => seat.selected && !desiredLabels.has(seat.label))
    ) {
      return userHandoff(
        "Other seats are already selected on this page. Review or clear them in the browser, then retry selection.",
      );
    }

    await dismissFloatingBanners(page);
    signal.throwIfAborted();

    let attemptResult = await clickAndVerifySeats(
      page,
      selected,
      desiredLabels,
      signal,
    );

    // If an exact target seat was stolen mid-click (and partial seats were atomically rolled back),
    // cleanly fall back to best contiguous block when exactSeatsOnly is false.
    if (!attemptResult.ok && usingExactTarget && !exactOnly) {
      signal.throwIfAborted();
      const freshSeats = await page.evaluate(readLiveSeats);
      const exclude = new Set<string>(
        attemptResult.failedLabel ? [attemptResult.failedLabel] : [],
      );
      const fallback = pickFallbackSeats(freshSeats, show, input, exclude);
      const fallbackDesired = new Set(fallback.map((seat) => seat.label));
      if (
        fallback.length === input.requiredSeats &&
        !freshSeats.some(
          (seat) => seat.selected && !fallbackDesired.has(seat.label),
        )
      ) {
        selected = fallback;
        desiredLabels = fallbackDesired;
        usingExactTarget = false;
        attemptResult = await clickAndVerifySeats(
          page,
          selected,
          desiredLabels,
          signal,
        );
      }
    }

    signal.throwIfAborted();
    if (!attemptResult.ok) {
      const reason: HandoffReason = attemptResult.stolen
        ? "seat_stolen_mid_click"
        : "exact_seats_unavailable";
      const msg = attemptResult.stolen
        ? `Seat ${attemptResult.failedLabel || "selection"} was taken during selection. Partial selection was cleanly rolled back.`
        : attemptResult.changed
          ? "The final seat selection changed. Partial selection was cleanly rolled back."
          : `Could not verify ${attemptResult.failedLabel || "seat selection"}. Please check the browser before continuing.`;
      return userHandoff(msg, [], {
        retryable: targetSeats.length > 0 || attemptResult.stolen,
        reason,
      });
    }

    const labels = attemptResult.labels;
    signal.throwIfAborted();
    const checkout = page
      .getByRole("button", {
        name: /^(proceed to checkout|proceed to pay|proceed|continue|confirm seats?|confirm booking|book now|buy tickets?|checkout|review order|next)(\b|$)/i,
      })
      .filter({ visible: true })
      .first();

    this.selections.set(key, {
      input: JSON.stringify(input),
      labels: [...labels],
    });

    if ((await checkout.count()) && (await checkout.isEnabled())) {
      signal.throwIfAborted();
      await dismissFloatingBanners(page);
      signal.throwIfAborted();
      await safeClick(checkout, page, signal);

      // Login or seat-conflict alert can appear only after seats are selected.
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
        page
          .locator('[role="alert"], [role="alertdialog"]')
          .first()
          .waitFor({ state: "visible", timeout: 2000 })
          .catch(() => {}),
      ]);
      signal.throwIfAborted();

      if (!isCheckoutOrPaymentUrl(page.url())) {
        const conflict = await detectSeatConflictAlert(page);
        if (conflict) {
          await rollbackSeats(page, labels, signal);
          return userHandoff(
            `Checkout reported a seat conflict (${conflict}). Partial selection was cleanly cleared.`,
            [],
            { retryable: true, reason: "checkout_blocked" },
          );
        }
      }

      const checkoutLogin = isPaymentGatewayUrl(page.url())
        ? undefined
        : await handleCinemaLogin(
            page,
            this.options.credentials?.get(),
            loginAttempt,
            signal,
          );
      if (checkoutLogin) {
        return userHandoff(checkoutLogin, labels, {
          reason: /OTP or CAPTCHA/i.test(checkoutLogin)
            ? "captcha_required"
            : "login_required",
        });
      }

      if (
        loginAttempt.submitted &&
        !isCheckoutOrPaymentUrl(page.url())
      ) {
        const stillSelected = (await page.evaluate(readLiveSeats)).filter(
          (seat) => seat.selected,
        );
        if (
          stillSelected.length === labels.length &&
          stillSelected.every((seat) => desiredLabels.has(seat.label)) &&
          (await checkout.isVisible()) &&
          (await checkout.isEnabled())
        ) {
          signal.throwIfAborted();
          await dismissFloatingBanners(page);
          await safeClick(checkout, page, signal);
        }
      }

      await page
        .waitForURL((u) => isCheckoutOrPaymentUrl(u.href), { timeout: 10_000 })
        .catch(() => {});
    }

    signal.throwIfAborted();
    const finalLogin = isPaymentGatewayUrl(page.url())
      ? undefined
      : await handleCinemaLogin(
          page,
          this.options.credentials?.get(),
          loginAttempt,
          signal,
        );
    if (finalLogin) {
      return userHandoff(finalLogin, labels, {
        reason: /OTP or CAPTCHA/i.test(finalLogin)
          ? "captcha_required"
          : "login_required",
      });
    }

    if (input.openPaymentGateway)
      return this.gatewayHandoff(key, page, labels, signal, loginAttempt);

    if (isCheckoutOrPaymentUrl(page.url())) {
      this.paymentKeys.add(key);
      await this.raiseWindow(page);
      return {
        status: "awaiting_payment",
        message:
          "Seat selection was verified and the checkout page is open. Complete payment in your browser.",
        url: page.url(),
        selectedSeats: labels,
      };
    }

    const postConflict = await detectSeatConflictAlert(page);
    if (postConflict) {
      await rollbackSeats(page, labels, signal);
      return userHandoff(
        `Checkout could not proceed (${postConflict}). Partial selection was cleanly cleared.`,
        [],
        { retryable: true, reason: "checkout_blocked" },
      );
    }

    return userHandoff(
      "The requested seats are selected. Finish the next cinema step in the browser.",
      labels,
      { reason: "checkout_blocked" },
    );
  }

  private async gatewayHandoff(
    key: string,
    page: Page,
    labels: string[],
    signal: AbortSignal,
    attempt: LoginAttempt = { submitted: false },
  ): Promise<BrowserHandoff> {
    const result = await openPaymentGateway(
      page,
      this.options.credentials?.get(),
      attempt,
      signal,
    );
    this.preparePage(result.page);
    this.pages.set(key, result.page);
    if (result.ready) this.paymentKeys.add(key);
    await this.raiseWindow(result.page);
    return {
      status: result.ready ? "awaiting_payment" : "awaiting_user",
      url: result.page.url(),
      selectedSeats: [...labels],
      message: result.message,
    };
  }

  async cancel(taskId: string) {
    // Close in-progress watch/selection pages without ever closing tabs already awaiting payment.
    const watch = this.watchPages.get(taskId);
    this.watchPages.delete(taskId);
    this.watchLoginAttempts.delete(taskId);

    const paymentPages = new Set<Page>();
    for (const key of this.paymentKeys) {
      if (key.startsWith(`${taskId}:`)) {
        const tracked = this.pages.get(key);
        if (tracked) paymentPages.add(tracked);
      }
    }

    for (const [key, page] of [...this.pages]) {
      if (!key.startsWith(`${taskId}:`)) continue;
      if (
        this.paymentKeys.has(key) ||
        paymentPages.has(page) ||
        (!page.isClosed() && isCheckoutOrPaymentUrl(page.url()))
      ) {
        continue;
      }
      await page.close().catch(() => {});
      this.pages.delete(key);
      this.selections.delete(key);
    }

    if (
      watch &&
      !watch.isClosed() &&
      !paymentPages.has(watch) &&
      !isCheckoutOrPaymentUrl(watch.url())
    ) {
      await watch.close().catch(() => {});
    }
  }

  async close() {
    this.connectionUnsubscribe?.();
    this.connectionUnsubscribe = undefined;
    if (this.options.connection) await this.options.connection.disconnect();
    else await this.context?.close().catch(() => {});
    this.context = undefined;
    this.pages.clear();
    this.watchPages.clear();
    this.paymentKeys.clear();
    this.selections.clear();
    this.watchLoginAttempts.clear();
  }
}

function pickFallbackSeats(
  liveSeats: LiveSeat[],
  show: Showtime,
  input: TaskInput,
  excludeLabels: Set<string> = new Set(),
): Seat[] {
  const rows = new Map<string, Seat[]>();
  // Separate physical arms before using the shared block detector.
  const grouped = new Map<string, LiveSeat[]>();
  for (const seat of liveSeats) {
    const list = grouped.get(seat.row) || [];
    list.push(seat);
    grouped.set(seat.row, list);
  }
  for (const [row, seats] of grouped) {
    seats.sort((a, b) => a.x - b.x);
    let arm = 0;
    let previous: LiveSeat | undefined;
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
        status: excludeLabels.has(seat.label) ? "occupied" : seat.status,
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
    availableSeats: liveSeats.filter(
      (s) => s.status === "available" && !excludeLabels.has(s.label),
    ).length,
    fetchedAt: new Date(),
  };
  const domHasCategories = liveSeats.some((seat) => !!seat.category);
  const blocks = eligibleBlocks(map, {
    ...input,
    allowedRows: [],
    preferredCategory: domHasCategories ? input.preferredCategory : "any",
  });
  return blocks.length
    ? selectOptimalSeats(blocks[0], input.requiredSeats)
    : [];
}

async function resolveSeatToken(
  page: Page,
  label: string,
  preferredToken?: string,
): Promise<LiveSeat | undefined> {
  if (preferredToken) {
    const existing = page.locator(`[data-ticket-bot-seat="${preferredToken}"]`);
    if ((await existing.count().catch(() => 0)) === 1) {
      // Confirm React didn't reuse the token on a different seat.
      const seats = await page.evaluate(readLiveSeats);
      return seats.find((s) => s.label === label);
    }
  }
  const seats = await page.evaluate(readLiveSeats);
  return seats.find((s) => s.label === label);
}

async function waitForSeatSelectionState(
  page: Page,
  label: string,
  expectedSelected: boolean,
  timeout: number,
  signal: AbortSignal,
): Promise<{ matched: boolean; seat?: LiveSeat }> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const seats = await page.evaluate(readLiveSeats).catch(() => []);
    const found = seats.find((s) => s.label === label);
    if (!found) return { matched: false };
    if (found.selected === expectedSelected)
      return { matched: true, seat: found };
    if (expectedSelected && found.status === "occupied")
      return { matched: false, seat: found };
    await abortableDelay(80, signal);
  }
  const seats = await page.evaluate(readLiveSeats).catch(() => []);
  const found = seats.find((s) => s.label === label);
  return { matched: !!found && found.selected === expectedSelected, seat: found };
}

async function rollbackSeats(
  page: Page,
  labelsToDeselect: string[],
  signal: AbortSignal,
): Promise<void> {
  if (!labelsToDeselect.length || page.isClosed()) return;
  for (const label of [...labelsToDeselect].reverse()) {
    if (signal.aborted || page.isClosed()) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const seat = await resolveSeatToken(page, label);
      if (!seat || !seat.selected) break;
      const element = page.locator(`[data-ticket-bot-seat="${seat.token}"]`);
      try {
        await element.click({ timeout: 2500 });
      } catch {
        await dismissFloatingBanners(page).catch(() => {});
        await element
          .evaluate((el) => (el as HTMLElement).click())
          .catch(() => {});
      }
      const res = await waitForSeatSelectionState(
        page,
        label,
        false,
        800,
        signal,
      ).catch(() => ({ matched: false }));
      if (res.matched) break;
    }
  }
}

async function clickAndVerifySeats(
  page: Page,
  selected: Seat[],
  desiredLabels: Set<string>,
  signal: AbortSignal,
): Promise<
  | { ok: true; labels: string[] }
  | { ok: false; failedLabel?: string; stolen: boolean; changed?: boolean }
> {
  const labels: string[] = [];
  const clickedByBot: string[] = [];

  for (const seat of selected) {
    signal.throwIfAborted();
    let live = await resolveSeatToken(page, seat.label, seat.id);
    if (!live) {
      await rollbackSeats(page, clickedByBot, signal);
      return { ok: false, failedLabel: seat.label, stolen: true };
    }
    if (live.selected) {
      labels.push(seat.label);
      continue;
    }
    if (live.status === "occupied") {
      await rollbackSeats(page, clickedByBot, signal);
      return { ok: false, failedLabel: seat.label, stolen: true };
    }

    let accepted = false;
    let stolen = false;
    for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
      signal.throwIfAborted();
      if (attempt > 0) {
        live = await resolveSeatToken(page, seat.label);
        if (!live || live.status === "occupied") {
          stolen = true;
          break;
        }
        if (live.selected) {
          accepted = true;
          break;
        }
      }
      const element = page.locator(`[data-ticket-bot-seat="${live.token}"]`);
      try {
        await element.click({ timeout: 5000 });
      } catch (clickError) {
        signal.throwIfAborted();
        if (/intercepts pointer events/i.test((clickError as Error).message)) {
          await dismissFloatingBanners(page);
          await element
            .evaluate((el) => (el as HTMLElement).click())
            .catch(() => {});
        } else {
          // Element may have been disabled or re-rendered mid-click; re-check live DOM.
          live = await resolveSeatToken(page, seat.label);
          if (!live || live.status === "occupied") {
            stolen = true;
            break;
          }
          continue;
        }
      }

      const check = await waitForSeatSelectionState(
        page,
        seat.label,
        true,
        1200,
        signal,
      );
      if (check.matched) {
        accepted = true;
        break;
      }
      if (
        (check.seat && check.seat.status === "occupied") ||
        (await detectSeatConflictAlert(page))
      ) {
        stolen = true;
        break;
      }
    }

    signal.throwIfAborted();
    if (!accepted) {
      await rollbackSeats(page, clickedByBot, signal);
      return { ok: false, failedLabel: seat.label, stolen };
    }
    clickedByBot.push(seat.label);
    labels.push(seat.label);
  }

  signal.throwIfAborted();
  const verified = (await page.evaluate(readLiveSeats)).filter(
    (seat) => seat.selected,
  );
  if (
    verified.length !== selected.length ||
    verified.some((seat) => !desiredLabels.has(seat.label))
  ) {
    await rollbackSeats(page, clickedByBot, signal);
    return { ok: false, stolen: true, changed: true };
  }

  return { ok: true, labels };
}

async function safeClick(
  locator: ReturnType<Page["locator"]>,
  page: Page,
  signal: AbortSignal,
) {
  try {
    await locator.click({ timeout: 4000 });
  } catch (clickError) {
    signal.throwIfAborted();
    if (!/intercepts pointer events/i.test((clickError as Error).message))
      throw clickError;
    await dismissFloatingBanners(page);
    await locator.evaluate((el) => (el as HTMLElement).click());
  }
}

async function detectSeatConflictAlert(page: Page): Promise<string | undefined> {
  const alerts = page
    .locator('[role="alert"], [role="alertdialog"], .toast-error, .alert-danger')
    .filter({ visible: true });
  const count = await alerts.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 4); i++) {
    const text = (await alerts.nth(i).innerText().catch(() => "")).trim();
    if (text && SEAT_CONFLICT_PATTERN.test(text)) {
      return text.slice(0, 140);
    }
  }
  return undefined;
}

export async function dismissFloatingBanners(page: Page) {
  const banner = page
    .locator(
      '[role="region"][aria-label*="Install" i], [role="dialog"][aria-label*="Install" i], [role="dialog"][aria-label*="cookie" i], [role="region"][aria-label*="cookie" i], [role="dialog"][aria-label*="promo" i]',
    )
    .filter({ visible: true });
  const count = await banner.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const current = banner.nth(i);
    // Never dismiss login, OTP, or payment dialogs.
    const sensitive = await current
      .locator('input[type="password"], input[name*="otp" i], input[autocomplete="cc-number"]')
      .count()
      .catch(() => 0);
    if (sensitive) continue;
    const close = current
      .locator(
        'button[aria-label*="close" i], button[aria-label*="dismiss" i], button:has-text("Not now"), button:has-text("Later"), button:has-text("Dismiss"), button:has-text("Close"), button:has-text("Accept"), button:has-text("×")',
      )
      .filter({ visible: true })
      .first();
    if (await close.count().catch(() => 0)) {
      await close.click({ timeout: 1500 }).catch(() => {});
    }
  }
}

export function isSeatSelected(el: Element): boolean {
  const aria = el.getAttribute("aria-label") || "";
  return (
    el.getAttribute("aria-selected") === "true" ||
    el.getAttribute("aria-checked") === "true" ||
    el.getAttribute("aria-pressed") === "true" ||
    el.getAttribute("data-seat-state") === "selected" ||
    el.getAttribute("data-seat-status") === "selected" ||
    el.getAttribute("data-state") === "selected" ||
    el.getAttribute("data-selected") === "true" ||
    el.getAttribute("data-seat-selected") === "true" ||
    el.classList.contains("selected") ||
    el.classList.contains("is-selected") ||
    (!/\b(unselected|not selected|deselected)\b/i.test(aria) &&
      /\bselected\b/i.test(aria))
  );
}

// Self-contained because Playwright serializes this function into the cinema page.
export function readLiveSeats() {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-seat-id], [data-seat-label], [data-seat], [data-seat-name], [data-seat-number], [role="gridcell"], button[aria-label*="seat" i], button[title*="seat" i]',
    ),
  );
  const seen = new Set<string>();
  const unavailableStates = new Set([
    "occupied",
    "booked",
    "sold",
    "unavailable",
    "blocked",
    "reserved",
    "locked",
    "taken",
  ]);
  const knownCategories = new Set([
    "regular",
    "standard",
    "premium",
    "vip",
    "lounger",
    "couple",
    "wheelchair",
    "semi-recliner",
  ]);
  const extractPair = (raw: string): [string, string] | undefined => {
    const value = raw.trim().toUpperCase();
    if (!value) return undefined;
    const direct = value.match(/^([A-Z]{1,3})[\s-]?0*([1-9]\d{0,2})$/);
    if (direct) return [direct[1], direct[2]];
    const row = value.match(/\bROW:?\s*([A-Z]{1,3})\b/);
    const num = value.match(
      /\bSEAT:?\s*(?:[A-Z]{1,3}[\s-]*)?0*([1-9]\d{0,2})\b/,
    );
    if (row && num) return [row[1], num[1]];
    const seatInline = value.match(
      /\bSEAT:?\s*([A-Z]{1,3})[\s-]?0*([1-9]\d{0,2})\b/,
    );
    if (seatInline) return [seatInline[1], seatInline[2]];
    const leading = value.match(/^([A-Z]{1,3})[\s-]?0*([1-9]\d{0,2})\b/);
    if (leading) return [leading[1], leading[2]];
    return undefined;
  };
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
    const dataLabel = el.getAttribute("data-seat-label") || "";
    const dataSeat =
      el.getAttribute("data-seat") || el.getAttribute("data-seat-name") || "";
    const dataRow = (el.getAttribute("data-row") || "").trim().toUpperCase();
    const dataNum = (
      el.getAttribute("data-seat-number") ||
      el.getAttribute("data-col") ||
      el.getAttribute("data-number") ||
      ""
    ).trim();
    const opaqueId = (el.getAttribute("data-seat-id") || "").trim();
    const aria = el.getAttribute("aria-label") || "";
    const title = el.getAttribute("title") || "";
    const text = (el.textContent || "").trim();

    const pair =
      extractPair(dataLabel) ||
      extractPair(dataSeat) ||
      (dataRow && /^[A-Z]{1,3}$/.test(dataRow) && /^0*[1-9]\d{0,2}$/.test(dataNum)
        ? ([dataRow, dataNum] as [string, string])
        : undefined) ||
      extractPair(aria) ||
      extractPair(title) ||
      extractPair(text) ||
      extractPair(opaqueId);
    if (!pair) continue;

    const row = pair[0];
    const number = Number(pair[1]);
    const label = `${row}${number}`;
    if (seen.has(label)) continue;
    seen.add(label);

    const token = `seat-${result.length}`;
    el.setAttribute("data-ticket-bot-seat", token);

    const statusAttrs = [
      el.getAttribute("data-status"),
      el.getAttribute("data-seat-status"),
      el.getAttribute("data-seat-state"),
      el.getAttribute("data-state"),
    ]
      .filter((v): v is string => !!v)
      .map((v) => v.trim().toLowerCase());

    const unavailable =
      el.hasAttribute("disabled") ||
      el.getAttribute("aria-disabled") === "true" ||
      el.getAttribute("data-seat-disabled") === "true" ||
      el.getAttribute("data-disabled") === "true" ||
      el.getAttribute("data-available") === "false" ||
      el.getAttribute("data-seat-readonly") === "true" ||
      /(^|\s)(occupied|booked|sold|unavailable|blocked|reserved|locked|taken|disabled)(\s|$)/i.test(
        el.className?.toString() || "",
      ) ||
      /\b(occupied|booked|sold|unavailable|blocked|reserved|locked|taken)\b/i.test(
        `${aria} ${title}`,
      ) ||
      statusAttrs.some((s) => unavailableStates.has(s));

    const selected =
      el.getAttribute("aria-selected") === "true" ||
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("aria-pressed") === "true" ||
      el.getAttribute("data-seat-state") === "selected" ||
      el.getAttribute("data-seat-status") === "selected" ||
      el.getAttribute("data-state") === "selected" ||
      el.getAttribute("data-selected") === "true" ||
      el.getAttribute("data-seat-selected") === "true" ||
      el.classList.contains("selected") ||
      el.classList.contains("is-selected") ||
      (!/\b(unselected|not selected|deselected)\b/i.test(aria) &&
        /\bselected\b/i.test(aria));

    const rawCategory = (
      el.getAttribute("data-category") ||
      el.getAttribute("data-seat-category") ||
      el.getAttribute("data-tier") ||
      ""
    )
      .trim()
      .toLowerCase();
    const category = knownCategories.has(rawCategory)
      ? (rawCategory as SeatCategory)
      : undefined;

    result.push({
      id: token,
      token,
      row,
      number,
      label,
      status: unavailable ? "occupied" : "available",
      selected,
      category,
      x: box.x,
      y: box.y,
      width: box.width,
    });
  }
  return result;
}
