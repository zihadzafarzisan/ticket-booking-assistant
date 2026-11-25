import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity, TaskStatus } from "../../bot/src/contracts";
import { Icon } from "./icons";
import { api, subscribe } from "./api";
import TaskForm from "./TaskForm";
import SeatInspector from "./SeatInspector";
import LiveCineplex from "./LiveCineplex";
import { CinemaSettings } from "./CinemaSettings";
import MovieBooking, { type MovieBookingChoice } from "./MovieBooking";
import type { LiveInventory } from "../../bot/src/live-types";
import { explainMovieAvailability } from "../../bot/src/availability";
import {
  STAR_CINEPLEX_LOCATIONS,
  TIME_SLOT_CONFIG,
} from "../../packages/core/src";
import type {
  ExtendedBotTask,
  ExtendedCandidate,
  ExtendedSnapshot,
  ExtendedTaskInput,
  PageRefreshState,
} from "./types";

const statusLabels: Record<TaskStatus, string> = {
  queued: "Queued",
  scheduled: "Scheduled",
  scanning: "Searching",
  monitoring: "Monitoring",
  selecting: "Selecting seats",
  awaiting_user: "Needs attention",
  awaiting_payment: "Ready for payment",
  completed: "Completed",
  stopped: "Stopped",
  error: "Needs a retry",
};
const pageRefreshLabels: Record<PageRefreshState, string> = {
  idle: "Idle",
  warming: "Warming cinema tab",
  refreshing: "Refreshing live (1s)",
  drop_detected: "Ticket drop detected",
  selecting: "Locking exact seats",
  handoff: "Handed off to checkout",
  error: "Transient error (retrying)",
};
const running = ["queued", "scheduled", "scanning", "monitoring", "selecting"];
const attention = ["awaiting_user", "awaiting_payment"];
const alertStatuses: TaskStatus[] = ["awaiting_payment", "awaiting_user", "error"];
const formatDate = (date: string) =>
  new Date(`${date}T12:00:00+06:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dhaka",
  });
const formatDhakaTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Dhaka",
      })
    : "—";
const playAlertChime = (kind: "awaiting_payment" | "awaiting_user" | "error") => {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const freq =
      kind === "awaiting_payment" ? 660 : kind === "awaiting_user" ? 520 : 330;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (kind === "awaiting_payment") {
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.14);
    }
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => void ctx.close();
  } catch {}
};
const timeAgo = (time: string) => {
  const diff = Math.max(0, Date.now() - Date.parse(time));
  return diff < 60_000
    ? "Just now"
    : diff < 3600_000
      ? `${Math.floor(diff / 60_000)}m ago`
      : diff < 86400_000
        ? `${Math.floor(diff / 3600_000)}h ago`
        : new Date(time).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          });
};
function Status({ status }: { status: TaskStatus }) {
  return (
    <span className={`status status-${status}`}>
      <i
        className={
          status === "scanning" || status === "selecting" ? "pulse" : ""
        }
      />
      {statusLabels[status]}
    </span>
  );
}
function MovieTile({
  title,
  small = false,
}: {
  title: string;
  small?: boolean;
}) {
  return (
    <div className={`movie-tile ${small ? "small" : ""}`}>
      <Icon name="film" size={small ? 20 : 28} />
      <span>{title.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}
function LogList({
  logs,
  compact = false,
}: {
  logs: Activity[];
  compact?: boolean;
}) {
  return logs.length ? (
    <div className={`log-list ${compact ? "compact" : ""}`}>
      {logs.map((log) => (
        <div key={log.id} className={`log-item log-${log.level}`}>
          <span className="log-mark">
            <Icon
              name={
                log.level === "success"
                  ? "check"
                  : log.level === "error"
                    ? "close"
                    : log.level === "warning"
                      ? "bell"
                      : "activity"
              }
              size={13}
            />
          </span>
          <div>
            <p>{log.message}</p>
            <time>
              {compact
                ? timeAgo(log.time)
                : new Date(log.time).toLocaleString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    month: "short",
                    day: "numeric",
                  })}
            </time>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="quiet-state">
      <Icon name="activity" size={24} />
      <p>All quiet for now.</p>
      <span>Your bot’s activity will appear here.</span>
    </div>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<ExtendedSnapshot>({
    tasks: [],
    browser: { connected: false, pages: 0, headless: false },
    startedAt: new Date().toISOString(),
    version: "0.2.0",
  });
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<
    "overview" | "cinema" | "tasks" | "activity" | "settings" | "detail"
  >("overview");
  const [selectedId, setSelectedId] = useState<string>();
  const [showForm, setShowForm] = useState(false);
  const [inventory, setInventory] = useState<LiveInventory>();
  const [missionSeed, setMissionSeed] = useState<Partial<ExtendedTaskInput>>();
  const [bookingChoice, setBookingChoice] = useState<MovieBookingChoice>();
  const [editingTaskId, setEditingTaskId] = useState<string>();
  const [inspecting, setInspecting] = useState<ExtendedCandidate>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ message: string; error?: boolean }>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [logFilter, setLogFilter] = useState("all");
  const [sound, setSound] = useState(
    () => localStorage.getItem("cinebot:sound") === "1",
  );
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );
  const notified = useRef(new Map<string, TaskStatus>());
  const latestSnapshot = useRef({ startedAt: "", seq: -1 });
  const applySnapshot = (value: ExtendedSnapshot) => {
    const seq = value.seq ?? 0;
    if (
      value.startedAt === latestSnapshot.current.startedAt &&
      seq < latestSnapshot.current.seq
    )
      return;
    latestSnapshot.current = { startedAt: value.startedAt, seq };
    setSnapshot(value);
  };
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let mounted = true;
    api<LiveInventory>("/live")
      .then((value) => {
        if (mounted) setInventory(value);
      })
      .catch((error) => {
        if (mounted) {
          setInventory(
            (prev) =>
              prev ?? {
                status: "error",
                refreshing: false,
                refreshIntervalSeconds: 30,
                sourceUrl: "https://starcineplex.com/showtimes",
                error:
                  (error as Error).message ||
                  "Could not reach Star Cineplex live inventory.",
                warnings: [],
                movies: [],
                branches: [],
                shows: [],
                halls: [],
                changes: [],
                counts: {
                  nowShowingMovies: 0,
                  openShows: 0,
                  hallsWithOpenTickets: 0,
                  reportedAvailableSeats: 0,
                },
              },
          );
        }
      });
    api<ExtendedSnapshot>("/state")
      .then((value) => {
        if (mounted) {
          applySnapshot(value);
          setConnected(true);
          setLoading(false);
          for (const task of value.tasks) {
            if (alertStatuses.includes(task.status)) {
              notified.current.set(task.id, task.status);
            }
          }
        }
      })
      .catch((error) => {
        if (mounted) {
          setLoading(false);
          setToast({ message: error.message, error: true });
        }
      });
    const close = subscribe(
      (value) => {
        if (!mounted) return;
        const activeIds = new Set(value.tasks.map((t) => t.id));
        for (const id of notified.current.keys()) {
          if (!activeIds.has(id)) notified.current.delete(id);
        }
        for (const task of value.tasks) {
          if (running.includes(task.status)) {
            notified.current.delete(task.id);
            continue;
          }
          if (
            alertStatuses.includes(task.status) &&
            notified.current.get(task.id) !== task.status
          ) {
            notified.current.set(task.id, task.status);
            const acquiredSeats =
              task.results.find((r) => r.handoff?.selectedSeats?.length)
                ?.handoff?.selectedSeats || [];
            if (task.status === "awaiting_payment") {
              const seatText = acquiredSeats.length
                ? `Seats ${acquiredSeats.join(", ")} locked — `
                : "";
              setToast({
                message: `${task.input.movieName}: ${seatText}checkout is ready.`,
              });
              if (
                "Notification" in window &&
                Notification.permission === "granted"
              )
                new Notification("Your movie seats are ready", {
                  body: `${seatText}Complete payment for ${task.input.movieName} in the cinema browser.`,
                });
              if (soundRef.current) playAlertChime("awaiting_payment");
            } else if (task.status === "awaiting_user") {
              setToast({
                message: `${task.input.movieName}: action needed in cinema browser (login, OTP, or CAPTCHA).`,
                error: true,
              });
              if (
                "Notification" in window &&
                Notification.permission === "granted"
              )
                new Notification("Cinema browser needs attention", {
                  body: `Finish login, OTP, or checkout verification for ${task.input.movieName}.`,
                });
              if (soundRef.current) playAlertChime("awaiting_user");
            } else if (task.status === "error") {
              setToast({
                message: `${task.input.movieName}: ${task.error || "mission needs a retry."}`,
                error: true,
              });
              if (
                "Notification" in window &&
                Notification.permission === "granted"
              )
                new Notification("Cinebot mission error", {
                  body: `${task.input.movieName}: ${task.error || "Needs a retry."}`,
                });
              if (soundRef.current) playAlertChime("error");
            }
          }
        }
        applySnapshot(value);
        setLoading(false);
      },
      setConnected,
      (value) => {
        if (mounted) setInventory(value);
      },
    );
    return () => {
      mounted = false;
      close();
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const tasks = snapshot.tasks;
  const active = tasks.filter((t) => running.includes(t.status));
  const needsAttention = tasks.filter((t) => attention.includes(t.status));
  const completed = tasks.filter((t) => t.status === "completed");
  const logs = useMemo(
    () =>
      tasks.flatMap((t) => t.logs).sort((a, b) => b.time.localeCompare(a.time)),
    [tasks],
  );
  const selected = tasks.find((t) => t.id === selectedId);
  const selectedWaitReason =
    selected && selected.input.source === "live" && !selected.results.length
      ? inventory?.status === "live"
        ? explainMovieAvailability(
            inventory.movies,
            inventory.shows,
            inventory.branches,
            selected.input,
          )
        : selected.waitReason
      : undefined;
  const visible = tasks.filter(
    (t) =>
      (!query ||
        t.input.movieName.toLowerCase().includes(query.toLowerCase())) &&
      (filter === "all" ||
        (filter === "active"
          ? running.includes(t.status)
          : filter === "attention"
            ? attention.includes(t.status)
            : t.status === filter)),
  );
  const taskList =
    page === "overview"
      ? tasks
          .filter((t) => !["completed", "stopped"].includes(t.status))
          .slice(0, 5)
      : visible;
  const navigate = (target: typeof page) => {
    setPage(target);
    setQuery("");
    setFilter("all");
  };
  const openTask = (task: ExtendedBotTask) => {
    setSelectedId(task.id);
    setPage("detail");
  };
  const action = async (
    path: string,
    body: unknown = {},
    success?: string,
  ): Promise<boolean> => {
    setBusy(path);
    const taskActionMatch = /^\/tasks\/([^/]+)\/(resume|reserve|check)$/.exec(
      path,
    );
    if (taskActionMatch) {
      notified.current.delete(taskActionMatch[1]);
    }
    try {
      await api(path, body);
      const state = await api<ExtendedSnapshot>("/state");
      applySnapshot(state);
      if (success) setToast({ message: success });
      return true;
    } catch (error) {
      setToast({ message: (error as Error).message, error: true });
      return false;
    } finally {
      setBusy("");
    }
  };
  const createTask = async (input: ExtendedTaskInput) => {
    setCreating(true);
    try {
      if (editingTaskId) {
        notified.current.delete(editingTaskId);
      }
      const task = await api<ExtendedBotTask>(
        editingTaskId ? `/tasks/${editingTaskId}/update` : "/tasks",
        input,
      );
      notified.current.delete(task.id);
      setShowForm(false);
      setBookingChoice(undefined);
      setMissionSeed(undefined);
      setEditingTaskId(undefined);
      setSelectedId(task.id);
      setPage("detail");
      applySnapshot(await api<ExtendedSnapshot>("/state"));
      setToast({
        message:
          input.mode === "monitor"
            ? "Your monitor is armed."
            : "Your bot is on it.",
      });
    } finally {
      setCreating(false);
    }
  };
  const openBrowser = () =>
    void action(
      "/browser/open",
      {},
      "Cinema tab opened in your regular browser.",
    );
  const resolveBranchNames = (ids: string[]) => {
    if (!ids.length) return "All supported branches";
    return ids
      .map((id) => {
        const liveMatch = inventory?.branches.find(
          (branch) => branch.locationId === id || branch.id === id,
        );
        if (liveMatch) return liveMatch.name;
        const staticMatch = STAR_CINEPLEX_LOCATIONS.find(
          (loc) => loc.id === id,
        );
        return staticMatch?.shortName || id;
      })
      .join(", ");
  };
  const TaskRow = ({ task }: { task: ExtendedBotTask }) => (
    <button
      className={`task-row ${selectedId === task.id ? "is-selected" : ""}`}
      onClick={() => openTask(task)}
    >
      <MovieTile title={task.input.movieName} small />
      <div className="task-name">
        <strong>{task.input.movieName}</strong>
        <span>
          {task.input.mode === "monitor" ? "Drop monitor" : "Instant search"}{" "}
          <b>·</b> {formatDate(task.input.targetDate)} <b>·</b>{" "}
          {task.input.requiredSeats} seats{" "}
          {task.input.targetSeats?.length ? (
            <>
              <b>·</b> {task.input.targetSeats.join(", ")}{" "}
            </>
          ) : null}
          {task.input.source === "demo" && <em>DEMO</em>}
        </span>
      </div>
      <Status status={task.status} />
      <span className="row-checks">
        {task.checks} check{task.checks === 1 ? "" : "s"}
      </span>
      <Icon name="chevron" size={17} />
    </button>
  );
  const title =
    page === "cinema"
      ? "Star Cineplex, live."
      : page === "overview"
        ? "Mission control."
        : page === "tasks"
          ? "Your missions."
          : page === "activity"
            ? "The latest, live."
            : page === "settings"
              ? "Make it yours."
              : selected?.input.movieName || "Mission details";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Cinebot home">
          <span className="brand-icon">
            <Icon name="film" size={23} />
          </span>
          <span>
            cinebot<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-tag">
          <span className="workspace-avatar">P</span>
          <div>
            Personal workspace<small>LOCAL BOT</small>
          </div>
          <Icon name="shield" size={15} />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {(
            [
              { id: "overview", label: "Overview", icon: "grid" },
              { id: "cinema", label: "Live Cineplex", icon: "film" },
              { id: "tasks", label: "Missions", icon: "ticket" },
              { id: "activity", label: "Activity", icon: "activity" },
              { id: "settings", label: "Settings", icon: "settings" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={
                page === item.id || (page === "detail" && item.id === "tasks")
                  ? "active"
                  : ""
              }
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.id === "tasks" && active.length > 0 && (
                <b>{active.length}</b>
              )}
              {item.id === "activity" && connected && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-tip">
          <span className="orbit-icon">
            <Icon name="bolt" size={22} />
          </span>
          <h3>
            A little less refreshing.
            <br />A lot more movie time.
          </h3>
          <p>Your bot keeps an eye on the seats, so you don’t have to.</p>
          <button onClick={() => setShowForm(true)}>
            Set up a mission <Icon name="arrow" size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className={`runtime-status ${connected ? "online" : ""}`}>
            <i />
            <div>
              {connected ? "Bot is online" : "Reconnecting…"}
              <small>
                {connected
                  ? "Running on this computer"
                  : "Keep the local bot service running"}
              </small>
            </div>
          </div>
          <div className="sidebar-version">
            <span>CINEBOT v{snapshot.version}</span>
            <Icon name="shield" size={13} />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="chevron" size={12} />
            <strong>
              {page === "cinema"
                ? "Live Cineplex"
                : page === "tasks"
                  ? "Missions"
                  : page === "detail"
                    ? "Mission details"
                    : page[0].toUpperCase() + page.slice(1)}
            </strong>
          </div>
          <div className="topbar-right">
            <span
              className={`session-dot ${snapshot.browser.connected ? "ready" : ""}`}
            />
            <button
              className="browser-link"
              disabled={!!busy || !connected}
              title={
                snapshot.browser.connected
                  ? "Open or focus a cinema tab in your connected browser."
                  : "Opens your regular Chrome or Edge browser with a persistent Star Cineplex session. Click Allow if Chrome prompts for remote debugging."
              }
              onClick={openBrowser}
            >
              {busy === "/browser/open"
                ? "Opening browser…"
                : snapshot.browser.connected
                  ? "Browser connected"
                  : "Open cinema browser"}
              <Icon name="external" size={13} />
            </button>
            <span className="topbar-divider" />
            <span className="user-avatar">P</span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              {page === "detail" && (
                <button className="back-link" onClick={() => navigate("tasks")}>
                  ← All missions
                </button>
              )}
              <span className="eyebrow">
                {page === "cinema"
                  ? "LIVE SOURCE · STAR CINEPLEX"
                  : page === "overview"
                    ? new Date(clock).toLocaleDateString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })
                    : page === "detail"
                      ? `MISSION ${selectedId?.slice(0, 8).toUpperCase()}`
                      : "YOUR PERSONAL TICKET ASSISTANT"}
              </span>
              <h1>{title}</h1>
              <p>
                {page === "cinema"
                  ? "Running movies, published halls, and online ticket sales — refreshed from the provider."
                  : page === "overview"
                    ? "A clear view of every search, every drop, and every seat."
                    : page === "tasks"
                      ? "Every movie night starts with a mission."
                      : page === "activity"
                        ? "Everything your bot is doing, as it happens."
                        : page === "settings"
                          ? "Your browser, your preferences, your movie nights."
                          : selected
                            ? `${selected.input.source === "demo" ? "Demo mission" : "Star Cineplex"} · Created ${timeAgo(selected.createdAt)}`
                            : "Select a mission from the list."}
              </p>
            </div>
            {page !== "settings" && (
              <button
                className="button primary new-mission"
                onClick={() => setShowForm(true)}
                disabled={!connected}
              >
                <Icon name="plus" size={18} />
                New mission
              </button>
            )}
          </div>
          {!connected && !loading && (
            <div className="connection-banner">
              <Icon name="activity" size={18} />
              The dashboard is reconnecting. Leave the bot service running to
              continue your missions.
            </div>
          )}
          {page === "cinema" && (
            <LiveCineplex
              inventory={inventory}
              connected={connected}
              onRefresh={() => action("/live/refresh")}
              onCreate={(seed) => {
                setMissionSeed(seed);
                setShowForm(true);
              }}
              onChooseMovie={setBookingChoice}
            />
          )}
          {page === "overview" && (
            <>
              <section className="hero-banner">
                <div>
                  <span className="hero-kicker">
                    <span />
                    GOOD SEATS. ZERO GUESSWORK.
                  </span>
                  <h2>
                    Your next movie night,
                    <br />
                    <span>handled.</span>
                  </h2>
                  <p>
                    Find seats right now, or be first in line when they drop.
                  </p>
                  <button
                    className="button hero-button"
                    onClick={() => setShowForm(true)}
                    disabled={!connected}
                  >
                    Give your bot a mission
                    <Icon name="arrow" size={17} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="floating-ticket">
                    <div className="ticket-stub">
                      <Icon name="film" size={23} />
                      <span>ADMIT TWO</span>
                    </div>
                    <div className="ticket-main">
                      <span>THE BEST SEAT IS YOURS</span>
                      <strong>
                        MOVIE
                        <br />
                        NIGHT.
                      </strong>
                      <div className="ticket-barcode" />
                      <small>YOUR PLANS, ON AUTOPILOT</small>
                    </div>
                  </div>
                  <span className="spark spark-one">✳</span>
                  <span className="spark spark-two">+</span>
                  <span className="art-coordinate">
                    CINEBOT / ALWAYS ON THE LOOKOUT
                  </span>
                </div>
              </section>
              <button
                className="live-overview-strip"
                onClick={() => navigate("cinema")}
              >
                <Icon name="film" size={21} />
                <div>
                  <strong>Star Cineplex live inventory</strong>
                  <span>
                    {inventory?.fetchedAt
                      ? `${inventory.counts.nowShowingMovies} now-showing movies · ${inventory.counts.openShows} shows with online sales open · ${inventory.counts.hallsWithOpenTickets} halls${inventory.status !== "live" ? " · Last known data" : ""}`
                      : inventory?.status === "error"
                        ? "Provider unavailable — view connection details"
                        : "Loading running movies, halls and ticket sales…"}
                  </span>
                </div>
                <Icon name="arrow" size={17} />
              </button>
              <section className="stats-grid" aria-label="Bot statistics">
                {[
                  {
                    label: "Active missions",
                    value: active.length,
                    icon: "bolt",
                    note: active.length
                      ? "Your bot is on the lookout"
                      : "Ready when you are",
                    color: "lime",
                  },
                  {
                    label: "Needs your attention",
                    value: needsAttention.length,
                    icon: "ticket",
                    note: needsAttention.length
                      ? "Seats found. Take a look."
                      : "You’re all caught up",
                    color: "amber",
                  },
                  {
                    label: "Checks performed",
                    value: tasks
                      .reduce((n, t) => n + t.checks, 0)
                      .toLocaleString(),
                    icon: "repeat",
                    note: "A little persistence pays off",
                    color: "blue",
                  },
                  {
                    label: "Completed missions",
                    value: completed.length,
                    icon: "check",
                    note: "Here’s to more movie nights",
                    color: "purple",
                  },
                ].map((metric) => (
                  <article className="stat-card" key={metric.label}>
                    <div>
                      <span>{metric.label}</span>
                      <span className={`stat-icon ${metric.color}`}>
                        <Icon name={metric.icon} size={16} />
                      </span>
                    </div>
                    <strong>{metric.value}</strong>
                    <small>{metric.note}</small>
                  </article>
                ))}
              </section>
            </>
          )}
          {(page === "overview" || page === "tasks") && (
            <div
              className={
                page === "overview" ? "overview-columns" : "missions-page"
              }
            >
              <section className="panel missions-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {page === "overview" ? "Your missions" : "Mission queue"}{" "}
                      <span className="count-badge">
                        {page === "overview" ? taskList.length : tasks.length}
                      </span>
                    </h2>
                    <p>
                      {page === "overview"
                        ? "The plans your bot is working on."
                        : "Search, monitor, pause, and pick up where you left off."}
                    </p>
                  </div>
                  {page === "overview" && (
                    <button
                      className="text-button"
                      onClick={() => navigate("tasks")}
                    >
                      View all
                      <Icon name="arrow" size={14} />
                    </button>
                  )}
                </div>
                {page === "tasks" && (
                  <div className="list-toolbar">
                    <div className="search-input">
                      <Icon name="search" size={16} />
                      <input
                        aria-label="Search missions"
                        placeholder="Search a movie…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Filter missions"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All missions</option>
                      <option value="active">Active</option>
                      <option value="attention">Needs attention</option>
                      <option value="completed">Completed</option>
                      <option value="stopped">Stopped</option>
                      <option value="error">Needs a retry</option>
                    </select>
                  </div>
                )}
                {loading ? (
                  <div className="loading-placeholder">
                    Connecting to your bot…
                  </div>
                ) : taskList.length ? (
                  <div className="task-list">
                    {taskList.map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </div>
                ) : (
                  <div className="empty-missions">
                    <div className="empty-orbit">
                      <Icon name="ticket" size={35} />
                      <i>
                        <Icon name="plus" size={12} />
                      </i>
                    </div>
                    <h3>
                      {query || filter !== "all"
                        ? "No missions match this view."
                        : "Your first mission is waiting."}
                    </h3>
                    <p>
                      {query || filter !== "all"
                        ? "Try another search or status filter."
                        : "Pick a movie and your favorite seats. We’ll handle the refreshing."}
                    </p>
                    {!query && filter === "all" && (
                      <button
                        className="button secondary"
                        onClick={() => setShowForm(true)}
                      >
                        <Icon name="plus" size={16} />
                        Create a mission
                      </button>
                    )}
                  </div>
                )}
                {page === "overview" && (
                  <div className="panel-footnote">
                    <Icon name="shield" size={14} />
                    <span>
                      Your bot runs locally. Your payment stays with the cinema.
                    </span>
                  </div>
                )}
              </section>
              {page === "overview" && (
                <aside className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        <span className="live-dot" />
                        Live activity
                      </h2>
                      <p>A pulse on your bot.</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="View all activity"
                      onClick={() => navigate("activity")}
                    >
                      <Icon name="arrow" size={17} />
                    </button>
                  </div>
                  <LogList logs={logs.slice(0, 5)} compact />
                  <div className="activity-footer">
                    <span className="tiny-dot" />
                    {connected
                      ? "Connected · updates in real time"
                      : "Waiting for connection"}
                  </div>
                </aside>
              )}
            </div>
          )}
          {page === "activity" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Activity stream</h2>
                  <p>Latest events across all your missions.</p>
                </div>
                <select
                  aria-label="Filter activity"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                >
                  <option value="all">All events</option>
                  <option value="success">Success</option>
                  <option value="warning">Warnings</option>
                  <option value="error">Errors</option>
                </select>
              </div>
              <LogList
                logs={logs
                  .filter(
                    (log) => logFilter === "all" || log.level === logFilter,
                  )
                  .slice(0, 150)}
              />
            </section>
          )}
          {page === "detail" && selected && (
            <>
              <section className="mission-summary">
                <div className="mission-identity">
                  <MovieTile title={selected.input.movieName} />
                  <div>
                    <Status status={selected.status} />
                    <h2>
                      {selected.input.mode === "monitor"
                        ? "Ticket drop monitor"
                        : "Instant seat search"}
                    </h2>
                    <span>
                      {selected.input.source === "demo"
                        ? "SIMULATED DATA"
                        : "LIVE CINEMA"}{" "}
                      <b>·</b>{" "}
                      {selected.input.keepTogether
                        ? "Seats together"
                        : "Split seating allowed"}
                    </span>
                  </div>
                </div>
                <div className="mission-actions">
                  {!running.includes(selected.status) && (
                    <button
                      className="button secondary"
                      disabled={!!busy}
                      onClick={() => {
                        setEditingTaskId(selected.id);
                        setMissionSeed(selected.input);
                        setShowForm(true);
                      }}
                    >
                      <Icon name="settings" size={15} />
                      Adjust search
                    </button>
                  )}
                  {running.includes(selected.status) ? (
                    <>
                      <button
                        className="button secondary"
                        disabled={
                          !!busy ||
                          selected.status === "selecting" ||
                          selected.status === "scanning"
                        }
                        onClick={() =>
                          void action(`/tasks/${selected.id}/check`)
                        }
                      >
                        <Icon name="repeat" size={15} />
                        Check now
                      </button>
                      <button
                        className="button danger-outline"
                        disabled={!!busy}
                        onClick={() =>
                          void action(
                            `/tasks/${selected.id}/stop`,
                            {},
                            "Mission stopped.",
                          )
                        }
                      >
                        <Icon name="pause" size={15} />
                        Stop
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="button secondary"
                        disabled={!!busy}
                        onClick={() =>
                          void action(
                            `/tasks/${selected.id}/resume`,
                            {},
                            "Mission restarted.",
                          )
                        }
                      >
                        <Icon name="repeat" size={15} />
                        Run again
                      </button>
                      {attention.includes(selected.status) && (
                        <button
                          className="button primary"
                          disabled={!!busy}
                          onClick={() =>
                            void action(
                              `/tasks/${selected.id}/complete`,
                              {},
                              "Mission marked complete.",
                            )
                          }
                        >
                          <Icon name="check" size={16} />
                          Mark complete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>
              <section className="mission-specs">
                <div>
                  <span>SHOW DATE</span>
                  <strong>{formatDate(selected.input.targetDate)}</strong>
                </div>
                <div>
                  <span>SEATS</span>
                  <strong>
                    {selected.input.requiredSeats}{" "}
                    {selected.input.keepTogether ? "together" : "total"}
                  </strong>
                </div>
                <div>
                  <span>ROWS</span>
                  <strong>
                    {selected.input.allowedRows.join(", ") || "Any row"}
                  </strong>
                </div>
                <div>
                  <span>SHOWTIMES</span>
                  <strong>
                    {selected.input.preferredTimes
                      .map((slot) => TIME_SLOT_CONFIG[slot].label)
                      .join(", ") || "Any time"}
                  </strong>
                </div>
                <div>
                  <span>CHECKS</span>
                  <strong>
                    {selected.checks}
                    {selected.nextCheckAt &&
                      running.includes(selected.status) && (
                        <small>
                          next in{" "}
                          {Math.max(
                            0,
                            Math.ceil(
                              (Date.parse(selected.nextCheckAt) - clock) / 1000,
                            ),
                          )}
                          s
                        </small>
                      )}
                  </strong>
                </div>
              </section>
              {(() => {
                const handoffResult =
                  selected.results.find(
                    (r) =>
                      r.handoff?.status === "awaiting_payment" ||
                      r.handoff?.selectedSeats?.length,
                  ) || selected.results.find((r) => r.handoff);
                const acquiredSeats =
                  handoffResult?.handoff?.selectedSeats || [];
                const isLiveRefreshing =
                  running.includes(selected.status) &&
                  selected.status !== "scheduled";
                const refreshState: PageRefreshState =
                  selected.pageRefreshState ||
                  (selected.status === "awaiting_payment" ||
                  selected.status === "awaiting_user"
                    ? "handoff"
                    : selected.status === "selecting"
                      ? "selecting"
                      : selected.status === "error"
                        ? "error"
                        : isLiveRefreshing
                          ? "refreshing"
                          : "idle");
                const heartbeatAgeMs = selected.lastCheckAt
                  ? Math.max(0, clock - Date.parse(selected.lastCheckAt))
                  : undefined;
                return (
                  <section
                    className={`sniper-monitor-panel state-${refreshState}`}
                    data-testid="sniper-monitor-panel"
                    aria-label="Live sniper telemetry"
                  >
                    <div className="sniper-header">
                      <div className="sniper-heartbeat">
                        <span
                          className={`heartbeat-dot ${isLiveRefreshing ? "pulsing" : ""} state-${refreshState}`}
                        />
                        <div>
                          <strong>
                            {selected.input.mode === "monitor"
                              ? `${selected.input.intervalSeconds}s Drop Sniper Telemetry`
                              : "Seat Acquisition Telemetry"}
                          </strong>
                          <span>
                            {selected.input.refreshBrowserPage
                              ? "Live Cineplex tab + API refresh"
                              : "Live API polling"}
                            {" · "}
                            Every {selected.input.intervalSeconds}s
                            {selected.dropDetectedAt && (
                              <>
                                {" · "}
                                <em className="drop-badge">
                                  Drop detected{" "}
                                  {formatDhakaTime(selected.dropDetectedAt)}
                                </em>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="sniper-badges">
                        {!!selected.consecutiveErrors &&
                          selected.consecutiveErrors > 0 && (
                            <span className="sniper-error-pill">
                              {selected.consecutiveErrors} transient error
                              {selected.consecutiveErrors === 1 ? "" : "s"}
                            </span>
                          )}
                        <span
                          className={`sniper-state-pill state-${refreshState}`}
                          data-testid="sniper-page-refresh-state"
                        >
                          {pageRefreshLabels[refreshState]}
                        </span>
                      </div>
                    </div>

                    <div className="sniper-metrics">
                      <div className="sniper-metric">
                        <span>CHECKS</span>
                        <strong data-testid="sniper-check-count">
                          {selected.checks}
                        </strong>
                        <small>
                          {selected.lastCheckAt
                            ? `Last ${formatDhakaTime(selected.lastCheckAt)}${heartbeatAgeMs !== undefined && isLiveRefreshing ? ` (${Math.floor(heartbeatAgeMs / 1000)}s ago)` : ""}`
                            : "Waiting for first check"}
                        </small>
                      </div>
                      <div className="sniper-metric">
                        <span>LATENCY</span>
                        <strong data-testid="sniper-latency-ms">
                          {selected.lastCheckLatencyMs !== undefined
                            ? `${Math.round(selected.lastCheckLatencyMs)} ms`
                            : "—"}
                        </strong>
                        <small>
                          {selected.nextCheckAt && isLiveRefreshing
                            ? `Next tick in ${Math.max(0, Math.ceil((Date.parse(selected.nextCheckAt) - clock) / 1000))}s`
                            : "Dhaka time"}
                        </small>
                      </div>
                      <div className="sniper-metric">
                        <span>PAGE REFRESHES</span>
                        <strong data-testid="sniper-page-refresh-count">
                          {selected.pageRefreshCount ?? 0}
                        </strong>
                        <small>
                          {selected.lastPageRefreshAt
                            ? `Tab ${formatDhakaTime(selected.lastPageRefreshAt)}`
                            : selected.input.refreshBrowserPage
                              ? "Arms once show URL is live"
                              : "Tab refresh off"}
                        </small>
                      </div>
                      <div className="sniper-metric">
                        <span>BRANCHES</span>
                        <strong className="sniper-branch-text">
                          {resolveBranchNames(selected.input.locationIds)}
                        </strong>
                        <small>
                          {selected.input.preferredCategory !== "any"
                            ? `${selected.input.preferredCategory} tier · `
                            : ""}
                          {selected.input.rowPreference} rows
                        </small>
                      </div>
                    </div>

                    <div className="sniper-seats-row">
                      <div
                        className="sniper-seat-group"
                        data-testid="sniper-target-seats"
                      >
                        <span className="sniper-seat-label">TARGET SEATS</span>
                        {selected.input.targetSeats?.length ? (
                          <div className="sniper-chips">
                            {selected.input.targetSeats.map((seat) => (
                              <span className="seat-chip target" key={seat}>
                                {seat}
                              </span>
                            ))}
                            <span className="policy-chip">
                              {selected.input.exactSeatsOnly
                                ? "Exact seats only"
                                : "Fallback contiguous"}
                            </span>
                          </div>
                        ) : (
                          <span className="sniper-seat-empty">
                            Best available in{" "}
                            {selected.input.allowedRows.length
                              ? `rows ${selected.input.allowedRows.join(", ")}`
                              : "any row"}
                          </span>
                        )}
                      </div>

                      {(acquiredSeats.length > 0 ||
                        attention.includes(selected.status)) && (
                        <div
                          className={`sniper-handoff-banner ${selected.status === "awaiting_payment" ? "payment" : "attention"}`}
                        >
                          <div
                            className="sniper-seat-group"
                            data-testid="sniper-acquired-seats"
                          >
                            <span className="sniper-seat-label">
                              {selected.status === "awaiting_payment"
                                ? "ACQUIRED SEATS · READY FOR PAYMENT"
                                : "BROWSER ACTION NEEDED"}
                            </span>
                            {acquiredSeats.length > 0 ? (
                              <div className="sniper-chips">
                                {acquiredSeats.map((seat) => (
                                  <span
                                    className="seat-chip acquired"
                                    key={seat}
                                  >
                                    {seat}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="sniper-seat-empty">
                                {handoffResult?.handoff?.message ||
                                  "Complete login, OTP, or CAPTCHA in the cinema browser."}
                              </span>
                            )}
                          </div>
                          {handoffResult && !handoffResult.simulated && (
                            <button
                              type="button"
                              className="button primary compact"
                              disabled={!!busy}
                              onClick={() =>
                                void action(`/tasks/${selected.id}/focus`, {
                                  key: handoffResult.key,
                                })
                              }
                            >
                              <Icon name="external" size={13} />
                              Focus payment tab
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })()}
              {selected.status === "selecting" && !snapshot.browser.connected && (
                <div className="schedule-notice" role="status">
                  <Icon name="browser" size={20} />
                  <div>
                    <strong>Connecting to your cinema browser…</strong>
                    <span>
                      If Chrome asks to allow remote debugging, click Allow in
                      your open Chrome window (or open Settings → Open regular
                      browser).
                    </span>
                  </div>
                </div>
              )}
              {selected.error && (
                <div className="form-error">
                  <Icon name="bell" size={17} />
                  {selected.error}
                </div>
              )}
              {selected.input.source === "demo" && (
                <div className="demo-notice">
                  <Icon name="shield" size={17} />
                  <span>
                    This is a demo mission. Seat data is simulated and no live
                    booking is made.
                  </span>
                </div>
              )}
              {selected.status === "scheduled" && (
                <div className="schedule-notice">
                  <Icon name="clock" size={20} />
                  <div>
                    <strong>Armed and ready.</strong>
                    <span>
                      Monitoring begins{" "}
                      {new Date(selected.input.scheduledAt!).toLocaleString()}.
                      Keep the bot service running.
                    </span>
                  </div>
                </div>
              )}
              <div className="detail-columns">
                <section className="panel results-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Seat options{" "}
                        <span className="count-badge">
                          {selected.results.length}
                        </span>
                      </h2>
                      <p>
                        {selected.results.length
                          ? "Ranked by seat quality, showtime, and your preferences."
                          : "Your matching seats will appear here."}
                      </p>
                    </div>
                    {(selected.status === "scanning" ||
                      selected.status === "selecting") && (
                      <span className="working-indicator">
                        <i />
                        Bot is working
                      </span>
                    )}
                  </div>
                  {selected.results.length ? (
                    <div className="result-list">
                      {selected.results.slice(0, 18).map((result, index) => (
                        <article className="result-card" key={result.key}>
                          <div className="result-top">
                            <span className="option-rank">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div>
                              <h3>{result.showtime.cinema.name}</h3>
                              <span>
                                <Icon name="pin" size={12} />
                                {result.showtime.cinema.location} <b>·</b>{" "}
                                {result.showtime.hall.name}
                              </span>
                            </div>
                            {index === 0 && (
                              <span className="best-match">
                                <Icon name="bolt" size={11} />
                                Top match
                              </span>
                            )}
                          </div>
                          <div className="result-facts">
                            <div>
                              <span>SHOWTIME</span>
                              <strong>
                                {formatDate(result.showtime.date)} <b>·</b>{" "}
                                {result.showtime.time}
                              </strong>
                            </div>
                            <div>
                              <span>
                                {result.simulated
                                  ? "PROPOSED SEATS"
                                  : "LAYOUT CANDIDATE"}
                              </span>
                              <strong>{result.seatLabels.join(", ")}</strong>
                            </div>
                            <div>
                              <span>PER PERSON</span>
                              <strong>
                                ৳{result.showtime.price.toLocaleString()}
                              </strong>
                            </div>
                          </div>
                          <p className="result-reason">
                            {result.reasoning[0]?.toUpperCase() +
                              result.reasoning.slice(1)}
                          </p>
                          {result.handoff && (
                            <div
                              className={`handoff-note ${result.handoff.status === "awaiting_payment" ? "payment" : ""}`}
                            >
                              <Icon name="browser" size={16} />
                              <span>
                                {result.handoff.message}
                                {result.handoff.selectedSeats.length > 0 && (
                                  <strong>
                                    Selected:{" "}
                                    {result.handoff.selectedSeats.join(", ")}
                                  </strong>
                                )}
                              </span>
                            </div>
                          )}
                          <div className="result-actions">
                            <button
                              className="text-button"
                              onClick={() => setInspecting(result)}
                            >
                              <Icon name="grid" size={15} />
                              Inspect block
                            </button>
                            {!result.simulated && (
                              <div>
                                {result.handoff && (
                                  <button
                                    className="button secondary compact"
                                    disabled={!!busy}
                                    onClick={() =>
                                      void action(
                                        `/tasks/${selected.id}/focus`,
                                        { key: result.key },
                                      )
                                    }
                                  >
                                    Open browser
                                    <Icon name="external" size={12} />
                                  </button>
                                )}
                                <button
                                  className="button primary compact"
                                  disabled={
                                    !!busy ||
                                    running.includes(selected.status) ||
                                    selected.status === "stopped" ||
                                    selected.status === "completed"
                                  }
                                  onClick={() =>
                                    void action(
                                      `/tasks/${selected.id}/reserve`,
                                      { key: result.key },
                                    )
                                  }
                                >
                                  {result.handoff
                                    ? "Retry selection"
                                    : "Select seats"}
                                  <Icon name="arrow" size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="waiting-state">
                      <span
                        className={
                          running.includes(selected.status)
                            ? "radar scanning"
                            : "radar"
                        }
                      >
                        <Icon
                          name={
                            running.includes(selected.status)
                              ? "search"
                              : "ticket"
                          }
                          size={30}
                        />
                      </span>
                      <h3>
                        {selectedWaitReason &&
                        !["scanning", "selecting"].includes(selected.status)
                          ? selectedWaitReason.title
                          : running.includes(selected.status)
                            ? "Your bot is on the lookout."
                            : "No matching seats yet."}
                      </h3>
                      <p>
                        {selectedWaitReason &&
                        !["scanning", "selecting"].includes(selected.status)
                          ? selectedWaitReason.message
                          : running.includes(selected.status)
                            ? "Feel free to close this tab. Monitoring continues while the bot service is running."
                            : "Run another check or create a mission with different preferences."}
                      </p>
                      {selectedWaitReason &&
                        !running.includes(selected.status) &&
                        !["completed", "stopped"].includes(selected.status) && (
                          <button
                            className="button secondary"
                            onClick={() => {
                              setMissionSeed({
                                ...selected.input,
                                mode: "monitor",
                              });
                              setEditingTaskId(selected.id);
                              setShowForm(true);
                            }}
                          >
                            Watch selected date
                          </button>
                        )}
                    </div>
                  )}
                </section>
                <aside className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Mission activity</h2>
                      <p>Every step, accounted for.</p>
                    </div>
                    <Icon name="activity" size={18} />
                  </div>
                  <LogList logs={selected.logs.slice(0, 12)} compact />
                  {!running.includes(selected.status) && (
                    <button
                      className="remove-task"
                      disabled={!!busy}
                      onClick={() => {
                        void action(
                          `/tasks/${selected.id}/remove`,
                          {},
                          "Mission removed.",
                        ).then((ok) => {
                          if (ok) navigate("tasks");
                        });
                      }}
                    >
                      <Icon name="trash" size={14} />
                      Remove mission
                    </button>
                  )}
                </aside>
              </div>
            </>
          )}
          {page === "detail" && !selected && (
            <div className="quiet-state">
              <p>This mission is no longer in your workspace.</p>
              <button
                className="button secondary"
                onClick={() => navigate("tasks")}
              >
                View missions
              </button>
            </div>
          )}
          {page === "settings" && (
            <div className="settings-grid">
              <CinemaSettings
                browser={snapshot.browser}
                onChanged={async () =>
                  applySnapshot(await api<ExtendedSnapshot>("/state"))
                }
              />
              <section className="panel settings-card">
                <div className="settings-title">
                  <span className="settings-symbol amber">
                    <Icon name="bell" size={23} />
                  </span>
                  <div>
                    <h2>A heads-up, your way</h2>
                    <p>Be there when your seats are ready.</p>
                  </div>
                </div>
                <div className="setting-line">
                  <div>
                    <strong>Dashboard sound</strong>
                    <p>A short chime when checkout is ready.</p>
                  </div>
                  <label className="switch">
                    <input
                      aria-label="Dashboard sound"
                      type="checkbox"
                      checked={sound}
                      onChange={(e) => {
                        setSound(e.target.checked);
                        localStorage.setItem(
                          "cinebot:sound",
                          e.target.checked ? "1" : "0",
                        );
                      }}
                    />
                    <span />
                  </label>
                </div>
                <div className="setting-line">
                  <div>
                    <strong>Desktop notifications</strong>
                    <p>
                      {notificationPermission === "granted"
                        ? "Enabled for seat locks, login prompts, and errors."
                        : notificationPermission === "denied"
                          ? "Blocked in browser settings. Allow notifications for this site to re-enable."
                          : notificationPermission === "unsupported"
                            ? "This browser does not support desktop notifications."
                            : "Alerts while this dashboard is open."}
                    </p>
                  </div>
                  <button
                    className="button secondary compact"
                    disabled={
                      notificationPermission === "granted" ||
                      notificationPermission === "denied" ||
                      notificationPermission === "unsupported"
                    }
                    onClick={() => {
                      if (!("Notification" in window)) {
                        setNotificationPermission("unsupported");
                        setToast({
                          message:
                            "This browser does not support desktop notifications.",
                          error: true,
                        });
                        return;
                      }
                      void Notification.requestPermission().then((value) => {
                        setNotificationPermission(value);
                        setToast({
                          message:
                            value === "granted"
                              ? "Notifications enabled."
                              : "Notifications were not enabled.",
                          error: value !== "granted",
                        });
                      });
                    }}
                  >
                    {notificationPermission === "granted"
                      ? "Enabled"
                      : notificationPermission === "denied"
                        ? "Blocked"
                        : notificationPermission === "unsupported"
                          ? "Unsupported"
                          : "Enable"}
                  </button>
                </div>
              </section>
              <section className="panel settings-card local-card">
                <div>
                  <span className="eyebrow">BUILT FOR YOUR COMPUTER</span>
                  <h2>Your bot. Your control.</h2>
                  <p>
                    Missions run in the local bot service, independently of this
                    tab. Keep the service and computer running for scheduled
                    drops. After a restart, saved monitors resume automatically.
                  </p>
                  <div className="local-facts">
                    <span>
                      <Icon name="shield" size={16} />
                      Login stored locally
                    </span>
                    <span>
                      <Icon name="check" size={16} />
                      No extension required
                    </span>
                    <span>
                      <Icon name="ticket" size={16} />
                      You complete payment
                    </span>
                  </div>
                </div>
                <span className="local-graphic">
                  <Icon name="shield" size={66} />
                </span>
              </section>
            </div>
          )}
          <footer className="workspace-footer">
            <span>MADE FOR MOVIE NIGHTS, NOT MANUAL REFRESHES.</span>
            <span>
              <i />
              Local workspace <b>·</b> Asia/Dhaka show dates
            </span>
          </footer>
        </main>
      </div>
      {bookingChoice && inventory && (
        <MovieBooking
          choice={bookingChoice}
          inventory={inventory}
          connected={connected}
          onClose={() => setBookingChoice(undefined)}
          onCreate={createTask}
        />
      )}
      {showForm && (
        <TaskForm
          busy={creating}
          connected={connected}
          initial={missionSeed}
          editing={!!editingTaskId}
          pinnedShow={inventory?.shows.find(
            (show) => show.id === missionSeed?.targetShowId,
          )}
          movies={inventory?.movies}
          branches={inventory?.branches}
          inventory={inventory}
          onClose={() => {
            setShowForm(false);
            setMissionSeed(undefined);
            setEditingTaskId(undefined);
          }}
          onCreate={createTask}
        />
      )}
      {inspecting && (
        <SeatInspector
          candidate={inspecting}
          onClose={() => setInspecting(undefined)}
        />
      )}
      {toast && (
        <div
          data-testid="handoff-toast"
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          <Icon name={toast.error ? "bell" : "check"} size={17} />
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(undefined)}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
