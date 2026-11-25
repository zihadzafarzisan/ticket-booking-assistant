import { randomUUID } from "node:crypto";
import {
  DEFAULT_WEIGHTS,
  createExactSeatBlock,
  getShowtimeLocationId,
  normalizeSeatLabel,
  scoreResult,
  type Seat,
  type Showtime,
} from "../../packages/core/src";
import type {
  Activity,
  BotTask,
  Candidate,
  PageRefreshResult,
  Snapshot,
  TaskInput,
} from "./contracts";
import { validateTask } from "./contracts";
import { TaskStore } from "./store";
import type { BrowserPort as BaseBrowserPort } from "./browser";

export interface BrowserPort extends BaseBrowserPort {
  onDisconnect?(listener: () => void): () => void;
  refreshPage?(
    taskId: string,
    targetUrl: string,
    input: TaskInput,
    signal: AbortSignal,
  ): Promise<PageRefreshResult>;
}

export interface DiscoveryPort {
  search(input: TaskInput, signal: AbortSignal): Promise<Candidate[]>;
  explainEmptyResult?(
    input: TaskInput,
    signal?: AbortSignal,
  ): Promise<{ title: string; message: string } | undefined>;
  resolveMonitorTarget?(
    input: TaskInput,
  ): { url: string; show?: Showtime } | undefined;
}
const activeStatuses = [
  "queued",
  "scheduled",
  "scanning",
  "monitoring",
  "selecting",
];
export class BotRunner {
  private tasks = new Map<string, BotTask>();
  private controllers = new Map<string, AbortController>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private lastPageWarnings = new Map<string, string>();
  private domGatedShows = new Map<string, Set<string>>();
  private unsubscribeBrowser?: () => void;
  private startedAt = new Date().toISOString();
  private seq = 0;
  private shuttingDown = false;
  constructor(
    private store: TaskStore,
    private discovery: DiscoveryPort,
    readonly browser: BrowserPort,
  ) {
    this.unsubscribeBrowser = this.browser.onDisconnect?.(() => {
      if (!this.shuttingDown) this.emit();
    });
  }
  async init() {
    for (const task of await this.store.load()) {
      task.pageRefreshCount ??= 0;
      task.pageRefreshState ??= "idle";
      task.consecutiveErrors ??= 0;
      this.tasks.set(task.id, task);
      if (activeStatuses.includes(task.status)) {
        if (task.status === "selecting") {
          task.status = "awaiting_user";
          task.pageRefreshState = "idle";
          this.log(
            task,
            "Browser selection was interrupted. Review and retry when ready.",
            "warning",
          );
        } else if (task.input.mode === "monitor") {
          task.status = "monitoring";
          task.pageRefreshState = "idle";
          this.log(task, "Monitor restored after bot restart.");
          this.schedule(task, 1000);
        } else {
          task.status = "stopped";
          task.pageRefreshState = "idle";
          this.log(
            task,
            "Instant search was interrupted. Run it again when ready.",
            "warning",
          );
        }
      }
    }
    await this.persist();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  notifyBrowserChange() {
    if (!this.shuttingDown) this.emit();
  }
  snapshot(): Snapshot {
    return {
      tasks: structuredClone(
        [...this.tasks.values()].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      ),
      browser: this.browser.status(),
      startedAt: this.startedAt,
      version: "0.2.0",
      seq: this.seq,
    };
  }
  get(id: string) {
    const task = this.tasks.get(id);
    if (!task) throw new Error("Task not found.");
    return task;
  }
  private emit() {
    this.seq++;
    for (const listener of this.listeners) listener();
  }
  private async persist() {
    await this.store.save([...this.tasks.values()]);
    this.emit();
  }
  private log(
    task: BotTask,
    message: string,
    level: Activity["level"] = "info",
  ) {
    task.updatedAt = new Date().toISOString();
    task.logs.unshift({
      id: randomUUID(),
      taskId: task.id,
      time: task.updatedAt,
      level,
      message,
    });
    task.logs = task.logs.slice(0, 100);
  }
  async create(value: unknown) {
    if (this.tasks.size >= 200)
      throw new Error("Remove old tasks before creating more (limit: 200).");
    const input = validateTask(value);
    const now = new Date().toISOString();
    const task: BotTask = {
      id: randomUUID(),
      input,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      checks: 0,
      pageRefreshCount: 0,
      pageRefreshState: "idle",
      consecutiveErrors: 0,
      results: [],
      logs: [],
    };
    this.tasks.set(task.id, task);
    this.log(
      task,
      input.source === "demo"
        ? "Demo task created. No cinema booking will be made."
        : "Task created.",
    );
    await this.persist();
    this.schedule(task, 50);
    return structuredClone(task);
  }
  private schedule(task: BotTask, delay: number) {
    if (this.shuttingDown) return;
    clearTimeout(this.timers.get(task.id));
    const until = task.input.scheduledAt
      ? Date.parse(task.input.scheduledAt) - Date.now()
      : 0;
    if (until > delay) {
      task.status = "scheduled";
      delay = Math.min(until, 60_000);
    }
    task.nextCheckAt = new Date(Date.now() + delay).toISOString();
    this.timers.set(
      task.id,
      setTimeout(() => {
        this.timers.delete(task.id);
        void this.check(task.id);
      }, delay),
    );
    this.emit();
  }
  private nextMonitorDelay(
    task: BotTask,
    elapsedMs: number,
    useFullInterval = false,
  ): number {
    const baseMs = task.input.intervalSeconds * 1000;
    const errors = task.consecutiveErrors ?? 0;
    if (errors === 0) {
      return useFullInterval ? baseMs : Math.max(50, baseMs - elapsedMs);
    }
    if (errors <= 3) return baseMs;
    if (errors <= 6) return Math.min(5_000, baseMs * 2);
    return Math.min(10_000, baseMs * 4);
  }
  private buildDomDropCandidate(
    task: BotTask,
    target: { url: string; show?: Showtime },
    pageResult: PageRefreshResult,
  ): Candidate {
    const showtime: Showtime = target.show || {
      id: task.input.targetShowId || `dom-drop-${task.id}`,
      movie: {
        id: task.input.targetMovieId || "live-movie",
        title: task.input.movieName,
      },
      cinema: {
        id: "star-cineplex",
        name: "Star Cineplex",
        location: "Dhaka",
      },
      hall: {
        id: "live-hall",
        name: task.input.preferredHall || "Star Cineplex Hall",
        screenType: "standard",
        capacity: Math.max(task.input.requiredSeats, pageResult.availableSeatCount),
      },
      date: task.input.targetDate,
      time: task.input.preferredShowtime || "00:00",
      screenType: "standard",
      price: 0,
      currency: "BDT",
      availableSeats: Math.max(
        task.input.requiredSeats,
        pageResult.availableSeatCount,
      ),
      totalSeats: Math.max(
        task.input.requiredSeats,
        pageResult.availableSeatCount,
      ),
      bookingUrl: target.url,
    };
    const labels = pageResult.availableTargetSeats.length
      ? pageResult.availableTargetSeats.slice(0, task.input.requiredSeats)
      : [];
    const seats: Seat[] = labels.map((label, idx) => {
      const match = label.match(/^([A-Z]+)(\d+)$/);
      return {
        id: label,
        row: match?.[1] || "A",
        number: match ? Number(match[2]) : idx + 1,
        label,
        status: "available",
      };
    });
    const seatBlock = labels.length
      ? createExactSeatBlock(seats, task.input.requiredSeats)
      : {
          id: `dom-drop-${showtime.id}`,
          row: "",
          seats: [],
          startSeat: "",
          endSeat: "",
          capacity: Math.max(0, pageResult.availableSeatCount),
          availableCount: Math.max(0, pageResult.availableSeatCount),
          centerScore: 0.5,
          meetsRequirement:
            pageResult.availableSeatCount >= task.input.requiredSeats,
        };
    return {
      ...scoreResult(showtime, seatBlock, DEFAULT_WEIGHTS),
      key: `${showtime.id}:${seatBlock.id}`,
      seatLabels: labels,
      simulated: false,
    };
  }
  async check(id: string) {
    const task = this.get(id);
    if (
      this.shuttingDown ||
      this.controllers.has(id) ||
      task.status === "stopped" ||
      task.status === "completed" ||
      task.status === "awaiting_payment"
    )
      return;
    if (
      task.input.scheduledAt &&
      Date.parse(task.input.scheduledAt) > Date.now()
    ) {
      this.schedule(task, 1000);
      return;
    }
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const tickStartedAt = Date.now();
    const prevWait = task.waitReason?.message;
    const isRepeatMonitorCheck =
      task.input.mode === "monitor" && task.checks > 0 && !task.results.length;
    task.status = "scanning";
    task.checks++;
    task.lastCheckAt = new Date(tickStartedAt).toISOString();
    task.nextCheckAt = undefined;
    task.error = undefined;
    task.waitReason = undefined;
    if (!isRepeatMonitorCheck) {
      this.log(
        task,
        `Check ${task.checks}: searching ${task.input.movieName} on ${task.input.targetDate}.`,
      );
    }
    let shouldPersist = !isRepeatMonitorCheck || task.checks % 30 === 0;
    let domGateHold = false;
    let retryableReserveMiss = false;
    const hadDropDetectedBefore = Boolean(task.dropDetectedAt);
    try {
      if (shouldPersist) await this.persist();
      else this.emit();
      let results = await this.discovery.search(
        task.input,
        controller.signal,
      );
      controller.signal.throwIfAborted();

      const refreshPage = this.browser.refreshPage?.bind(this.browser);
      const canRefreshPage =
        task.input.mode === "monitor" &&
        task.input.source === "live" &&
        task.input.refreshBrowserPage !== false &&
        Boolean(refreshPage);
      const primaryShow = results[0]?.showtime;
      const needsDomGate =
        results.length > 0 &&
        canRefreshPage &&
        (Boolean(task.input.targetSeats?.length) ||
          Boolean(
            primaryShow &&
              this.domGatedShows.get(task.id)?.has(primaryShow.id),
          ));

      // Coordinate live 1s Cineplex page refresh alongside API poll when a show page exists.
      // When monitoring an open show for targetSeats (or after a retryable exact_seats_unavailable /
      // seat_map_not_ready miss), gate reserve() on live DOM confirmation from refreshPage().
      if (canRefreshPage && refreshPage && (!results.length || needsDomGate)) {
        const target =
          needsDomGate && primaryShow?.bookingUrl
            ? { url: primaryShow.bookingUrl, show: primaryShow }
            : this.discovery.resolveMonitorTarget?.(task.input);
        if (target?.url) {
          task.pageRefreshState =
            (task.pageRefreshCount ?? 0) === 0 ? "warming" : "refreshing";
          task.lastPageUrl = target.url;
          this.emit();
          try {
            const pageResult = await refreshPage(
              task.id,
              target.url,
              task.input,
              controller.signal,
            );
            controller.signal.throwIfAborted();
            task.pageRefreshCount = (task.pageRefreshCount ?? 0) + 1;
            task.lastPageRefreshAt = pageResult.refreshedAt;
            task.lastPageUrl = pageResult.url || target.url;
            if (pageResult.dropDetected) {
              shouldPersist = true;
              task.dropDetectedAt ||= new Date().toISOString();
              task.pageRefreshState = "drop_detected";
              this.lastPageWarnings.delete(task.id);
              if (primaryShow) {
                this.domGatedShows.get(task.id)?.delete(primaryShow.id);
              }
              this.log(
                task,
                "Ticket drop detected on the live Cineplex page! Acquiring seats immediately.",
                "success",
              );
              if (!results.length) {
                results = [this.buildDomDropCandidate(task, target, pageResult)];
              }
            } else {
              if (needsDomGate) {
                results = [];
                domGateHold = true;
              }
              if (pageResult.warning) {
                task.pageRefreshState = pageResult.requiresUserAttention
                  ? "error"
                  : "refreshing";
                if (this.lastPageWarnings.get(task.id) !== pageResult.warning) {
                  this.lastPageWarnings.set(task.id, pageResult.warning);
                  shouldPersist = true;
                  this.log(task, pageResult.warning, "warning");
                }
              } else {
                this.lastPageWarnings.delete(task.id);
                task.pageRefreshState = "refreshing";
              }
            }
          } catch (pageError) {
            if (controller.signal.aborted) return;
            if (needsDomGate) {
              results = [];
              domGateHold = true;
            }
            task.pageRefreshState = "error";
            const msg = `Page refresh hiccup (API monitoring continues): ${cleanErrorMessage(pageError)}`;
            if (this.lastPageWarnings.get(task.id) !== msg) {
              this.lastPageWarnings.set(task.id, msg);
              shouldPersist = true;
              this.log(task, msg, "warning");
            }
          }
        }
      }

      task.consecutiveErrors = 0;
      task.lastCheckLatencyMs = Math.max(0, Date.now() - tickStartedAt);
      task.results = results;
      if (results.length) {
        shouldPersist = true;
        if (task.input.mode === "monitor" && !task.dropDetectedAt) {
          task.dropDetectedAt = new Date().toISOString();
          task.pageRefreshState = "drop_detected";
        }
        this.log(
          task,
          `${results.length} matching seat option${results.length === 1 ? "" : "s"} found.`,
          "success",
        );
        task.status = "awaiting_user";
        await this.persist();
        if (task.input.autoReserve && task.input.source === "live") {
          retryableReserveMiss = await this.reserveResults(
            task,
            undefined,
            controller.signal,
            true,
          );
          if (retryableReserveMiss && !hadDropDetectedBefore) {
            task.dropDetectedAt = undefined;
          }
        } else if (task.input.source === "demo")
          this.log(
            task,
            "Demo results ready. Inspect seats in the dashboard; live browser actions are disabled.",
          );
      } else {
        task.waitReason = domGateHold
          ? {
              title: task.input.targetSeats?.length
                ? "Waiting for target seats on live page"
                : "Waiting for live seat map",
              message:
                this.lastPageWarnings.get(task.id) ||
                (task.input.targetSeats?.length
                  ? `Watching live Cineplex page for target seats (${task.input.targetSeats.join(", ")}).`
                  : "Watching live Cineplex page for available seats."),
            }
          : await this.discovery.explainEmptyResult?.(
              task.input,
              controller.signal,
            );
        controller.signal.throwIfAborted();
        task.status =
          task.input.mode === "monitor" ? "monitoring" : "awaiting_user";
        const nextMsg =
          task.waitReason?.message ||
          (task.input.mode === "monitor"
            ? "No matching seats yet. Monitoring continues."
            : "No seats match these choices. Adjust the date, rows or branches and try again.");
        if (!isRepeatMonitorCheck || nextMsg !== prevWait) {
          shouldPersist = true;
          this.log(
            task,
            nextMsg,
            task.input.mode === "monitor" ? "info" : "warning",
          );
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      shouldPersist = true;
      task.consecutiveErrors = (task.consecutiveErrors ?? 0) + 1;
      task.lastCheckLatencyMs = Math.max(0, Date.now() - tickStartedAt);
      task.error = cleanErrorMessage(error);
      this.log(task, task.error, "error");
      task.status = task.input.mode === "monitor" ? "monitoring" : "error";
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
      if (!controller.signal.aborted && !this.shuttingDown) {
        if (task.status === "monitoring")
          this.schedule(
            task,
            this.nextMonitorDelay(
              task,
              Date.now() - tickStartedAt,
              domGateHold || retryableReserveMiss,
            ),
          );
        if (shouldPersist) await this.persist();
        else this.emit();
      }
    }
  }
  private verifyHandoff(
    task: BotTask,
    handoff: NonNullable<Candidate["handoff"]>,
  ): NonNullable<Candidate["handoff"]> {
    if (handoff.status !== "awaiting_payment") return handoff;
    const normalizedAcquired = handoff.selectedSeats.map(
      (label) => normalizeSeatLabel(label) || label.trim().toUpperCase(),
    );
    if (normalizedAcquired.length !== task.input.requiredSeats) {
      return {
        ...handoff,
        status: "awaiting_user",
        message: `Expected ${task.input.requiredSeats} verified seat(s), but ${normalizedAcquired.length} were reported. Review the browser before paying.`,
      };
    }
    if (task.input.exactSeatsOnly && task.input.targetSeats?.length) {
      const allowed = new Set(
        task.input.targetSeats.map(
          (label) => normalizeSeatLabel(label) || label.trim().toUpperCase(),
        ),
      );
      if (normalizedAcquired.some((label) => !allowed.has(label))) {
        return {
          ...handoff,
          status: "awaiting_user",
          message: `Selected seats (${handoff.selectedSeats.join(", ")}) did not strictly match target seats (${task.input.targetSeats.join(", ")}). Review the browser before paying.`,
        };
      }
    }
    return handoff;
  }
  private async reserveResults(
    task: BotTask,
    key: string | undefined,
    signal: AbortSignal,
    fromMonitorCheck = false,
  ) {
    if (task.input.source === "demo")
      throw new Error("Demo tasks cannot open a live booking.");
    let targets: Candidate[] = [];
    if (key) {
      const found = task.results.find((r) => r.key === key);
      if (!found) throw new Error("Seat option not found.");
      targets = [found];
    } else if (task.input.strategy === "each_location") {
      const seen = new Set<string>();
      for (const result of task.results) {
        const branch = getShowtimeLocationId(result.showtime);
        if (!seen.has(branch)) {
          seen.add(branch);
          targets.push(result);
        }
      }
    } else targets = task.results.slice(0, 1);
    if (!targets.length)
      throw new Error("No seat option is available. Run another check.");
    task.status = "selecting";
    task.pageRefreshState = "selecting";
    await this.persist();
    for (const result of targets) {
      signal.throwIfAborted();
      if (result.handoff?.status === "awaiting_payment") continue;
      this.log(
        task,
        `Opening ${result.showtime.cinema.name} at ${result.showtime.time}.`,
      );
      await this.persist();
      const rawHandoff = await this.browser.reserve(
        task.id,
        result.showtime,
        task.input,
        signal,
      );
      signal.throwIfAborted();
      const handoff = this.verifyHandoff(task, rawHandoff);
      result.handoff = handoff;
      this.log(
        task,
        handoff.message,
        handoff.status === "awaiting_payment" ? "success" : "warning",
      );
    }
    if (
      fromMonitorCheck &&
      task.input.mode === "monitor" &&
      targets.every((r) => r.handoff?.retryable === true)
    ) {
      for (const r of targets) {
        if (
          r.handoff?.reason === "exact_seats_unavailable" ||
          r.handoff?.reason === "seat_map_not_ready"
        ) {
          let gated = this.domGatedShows.get(task.id);
          if (!gated) {
            gated = new Set<string>();
            this.domGatedShows.set(task.id, gated);
          }
          gated.add(r.showtime.id);
        }
      }
      task.status = "monitoring";
      task.pageRefreshState = "refreshing";
      task.waitReason = {
        title: "Retrying seat selection",
        message: targets[0].handoff?.message || "Retrying seat selection.",
      };
      task.results = [];
      return true;
    }
    this.domGatedShows.delete(task.id);
    const allPaymentReady = targets.every(
      (r) => r.handoff?.status === "awaiting_payment",
    );
    task.status = allPaymentReady ? "awaiting_payment" : "awaiting_user";
    task.pageRefreshState =
      allPaymentReady || targets.some((r) => r.handoff?.selectedSeats.length)
        ? "handoff"
        : "idle";
    return false;
  }
  async reserve(id: string, key?: string) {
    const task = this.get(id);
    if (this.controllers.has(id))
      throw new Error("This task is busy. Wait or stop it first.");
    if (task.status === "stopped" || task.status === "completed")
      throw new Error("Resume this task before reserving seats.");
    if (task.status === "awaiting_payment" && !key)
      throw new Error("Seats are already held and awaiting payment.");
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      await this.reserveResults(task, key, controller.signal, false);
    } catch (error) {
      if (!controller.signal.aborted) {
        task.status = "error";
        task.pageRefreshState = "error";
        task.error = cleanErrorMessage(error);
        this.log(task, task.error, "error");
      }
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
      await this.persist();
    }
  }
  async stop(id: string) {
    const task = this.get(id);
    const shouldCancelBrowser =
      task.status === "selecting" ||
      ((task.status === "monitoring" || task.status === "scanning") &&
        ((task.pageRefreshCount ?? 0) > 0 ||
          task.pageRefreshState === "warming" ||
          task.pageRefreshState === "refreshing" ||
          task.pageRefreshState === "drop_detected" ||
          Boolean(task.lastPageUrl)));
    this.controllers.get(id)?.abort();
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.lastPageWarnings.delete(id);
    this.domGatedShows.delete(id);
    task.status = "stopped";
    task.nextCheckAt = undefined;
    task.pageRefreshState = "idle";
    this.log(
      task,
      "Task stopped. No further automated checks will run.",
      "warning",
    );
    if (shouldCancelBrowser) await this.browser.cancel(id);
    await this.persist();
    return task;
  }
  async resume(id: string) {
    const task = this.get(id);
    if (this.controllers.has(id))
      throw new Error(
        "The previous operation is still stopping. Try again shortly.",
      );
    task.input.scheduledAt = undefined;
    task.status = "queued";
    task.error = undefined;
    task.consecutiveErrors = 0;
    task.dropDetectedAt = undefined;
    task.pageRefreshState = "idle";
    this.lastPageWarnings.delete(id);
    this.domGatedShows.delete(id);
    this.log(task, "Task resumed.");
    await this.persist();
    this.schedule(task, 50);
    return task;
  }
  async update(id: string, value: unknown) {
    const input = validateTask(value);
    const task = this.get(id);
    if (this.controllers.has(id))
      throw new Error(
        "Stop the running operation and wait for it to finish before adjusting the search.",
      );
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    task.input = input;
    task.status = "queued";
    task.error = undefined;
    task.results = [];
    task.waitReason = undefined;
    task.nextCheckAt = undefined;
    task.consecutiveErrors = 0;
    task.dropDetectedAt = undefined;
    task.pageRefreshCount = 0;
    task.lastPageRefreshAt = undefined;
    task.lastPageUrl = undefined;
    task.pageRefreshState = "idle";
    this.lastPageWarnings.delete(id);
    this.domGatedShows.delete(id);
    this.log(task, "Search preferences updated. Checking again.");
    await this.persist();
    this.schedule(task, 50);
    return structuredClone(task);
  }
  async complete(id: string) {
    const task = this.get(id);
    if (!["awaiting_user", "awaiting_payment"].includes(task.status))
      throw new Error(
        "Only a task awaiting your attention can be marked complete.",
      );
    await this.stop(id);
    task.status = "completed";
    this.log(task, "Marked complete by you.", "success");
    await this.persist();
    return task;
  }
  async remove(id: string) {
    const task = this.get(id);
    if (activeStatuses.includes(task.status) || this.controllers.has(id))
      throw new Error("Stop the task before removing it.");
    this.tasks.delete(id);
    this.lastPageWarnings.delete(id);
    this.domGatedShows.delete(id);
    await this.persist();
  }
  async focus(id: string, key: string) {
    const task = this.get(id);
    const result = task.results.find((r) => r.key === key);
    if (!result || result.simulated)
      throw new Error("A live booking option is required.");
    await this.browser.focus(id, result.showtime);
    this.emit();
  }
  async shutdown() {
    this.shuttingDown = true;
    this.unsubscribeBrowser?.();
    this.unsubscribeBrowser = undefined;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const controller of this.controllers.values()) controller.abort();
    await this.persist();
    await this.browser.close();
    await this.store.flush();
  }
}

function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
}
