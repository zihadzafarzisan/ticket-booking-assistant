import { randomUUID } from "node:crypto";
import { getShowtimeLocationId } from "../../packages/core/src";
import type {
  Activity,
  BotTask,
  Candidate,
  Snapshot,
  TaskInput,
} from "./contracts";
import { validateTask } from "./contracts";
import { TaskStore } from "./store";
import type { BrowserPort } from "./browser";

export interface DiscoveryPort {
  search(input: TaskInput, signal: AbortSignal): Promise<Candidate[]>;
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
  private startedAt = new Date().toISOString();
  private shuttingDown = false;
  constructor(
    private store: TaskStore,
    private discovery: DiscoveryPort,
    readonly browser: BrowserPort,
  ) {}
  async init() {
    for (const task of await this.store.load()) {
      this.tasks.set(task.id, task);
      if (activeStatuses.includes(task.status)) {
        if (task.status === "selecting") {
          task.status = "awaiting_user";
          this.log(
            task,
            "Browser selection was interrupted. Review and retry when ready.",
            "warning",
          );
        } else if (task.input.mode === "monitor") {
          task.status = "monitoring";
          this.log(task, "Monitor restored after bot restart.");
          this.schedule(task, 1000);
        } else {
          task.status = "stopped";
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
    };
  }
  get(id: string) {
    const task = this.tasks.get(id);
    if (!task) throw new Error("Task not found.");
    return task;
  }
  private emit() {
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
  async check(id: string) {
    const task = this.get(id);
    if (
      this.shuttingDown ||
      this.controllers.has(id) ||
      task.status === "stopped" ||
      task.status === "completed"
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
    task.status = "scanning";
    task.checks++;
    task.lastCheckAt = new Date().toISOString();
    task.nextCheckAt = undefined;
    task.error = undefined;
    this.log(
      task,
      `Check ${task.checks}: searching ${task.input.movieName} on ${task.input.targetDate}.`,
    );
    try {
      await this.persist();
      const results = await this.discovery.search(
        task.input,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      task.results = results;
      if (results.length) {
        this.log(
          task,
          `${results.length} matching seat option${results.length === 1 ? "" : "s"} found.`,
          "success",
        );
        task.status = "awaiting_user";
        await this.persist();
        if (task.input.autoReserve && task.input.source === "live")
          await this.reserveResults(task, undefined, controller.signal);
        else if (task.input.source === "demo")
          this.log(
            task,
            "Demo results ready. Inspect seats in the dashboard; live browser actions are disabled.",
          );
      } else if (task.input.mode === "monitor") {
        task.status = "monitoring";
        this.log(task, "No matching seats yet. Monitoring continues.");
      } else {
        task.status = "awaiting_user";
        this.log(
          task,
          "No seats match these choices. Adjust the date, rows or branches and try again.",
          "warning",
        );
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      task.error = (error as Error).message;
      this.log(task, task.error, "error");
      task.status = task.input.mode === "monitor" ? "monitoring" : "error";
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
      if (!controller.signal.aborted && !this.shuttingDown) {
        if (task.status === "monitoring")
          this.schedule(task, task.input.intervalSeconds * 1000);
        await this.persist();
      }
    }
  }
  private async reserveResults(
    task: BotTask,
    key: string | undefined,
    signal: AbortSignal,
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
    await this.persist();
    for (const result of targets) {
      signal.throwIfAborted();
      this.log(
        task,
        `Opening ${result.showtime.cinema.name} at ${result.showtime.time}.`,
      );
      await this.persist();
      const handoff = await this.browser.reserve(
        task.id,
        result.showtime,
        task.input,
        signal,
      );
      signal.throwIfAborted();
      result.handoff = handoff;
      this.log(
        task,
        handoff.message,
        handoff.status === "awaiting_payment" ? "success" : "warning",
      );
    }
    task.status = targets.every((r) => r.handoff?.status === "awaiting_payment")
      ? "awaiting_payment"
      : "awaiting_user";
  }
  async reserve(id: string, key?: string) {
    const task = this.get(id);
    if (this.controllers.has(id))
      throw new Error("This task is busy. Wait or stop it first.");
    if (task.status === "stopped" || task.status === "completed")
      throw new Error("Resume this task before reserving seats.");
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      await this.reserveResults(task, key, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        task.status = "error";
        task.error = (error as Error).message;
        this.log(task, task.error, "error");
      }
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
      await this.persist();
    }
  }
  async stop(id: string) {
    const task = this.get(id);
    const wasSelecting = task.status === "selecting";
    this.controllers.get(id)?.abort();
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    task.status = "stopped";
    task.nextCheckAt = undefined;
    this.log(
      task,
      "Task stopped. No further automated checks will run.",
      "warning",
    );
    if (wasSelecting) await this.browser.cancel(id);
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
    task.nextCheckAt = undefined;
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
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const controller of this.controllers.values()) controller.abort();
    await this.persist();
    await this.browser.close();
    await this.store.flush();
  }
}
