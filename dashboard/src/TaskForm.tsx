import { useEffect, useRef, useState } from "react";
import { STAR_CINEPLEX_LOCATIONS } from "../../packages/core/src";
import type {
  LiveMovie,
  LiveBranch,
  LiveShow,
  LiveInventory,
} from "../../bot/src/live-types";
import { explainMovieAvailability } from "../../bot/src/availability";
import { Icon } from "./icons";
import BookingPreferences from "./BookingPreferences";
import ExactSeatPicker from "./ExactSeatPicker";
import {
  SEAT_CATEGORY_OPTIONS,
  parseLocalDateTimeInput,
  toLocalDateTimeInput,
  type ExtendedTaskInput,
} from "./types";

export const today = () =>
  new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);

export default function TaskForm({
  onClose,
  onCreate,
  busy,
  connected = true,
  initial,
  movies,
  branches,
  editing = false,
  pinnedShow,
  inventory,
}: {
  onClose: () => void;
  onCreate: (input: ExtendedTaskInput) => Promise<void>;
  busy: boolean;
  connected?: boolean;
  initial?: Partial<ExtendedTaskInput>;
  movies?: LiveMovie[];
  branches?: LiveBranch[];
  editing?: boolean;
  pinnedShow?: LiveShow;
  inventory?: LiveInventory;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initialMode = initial?.mode ?? "instant";
  const initialSource = initial?.source ?? "live";
  const [form, setForm] = useState<ExtendedTaskInput>({
    movieName: "",
    targetDate: today(),
    requiredSeats: 2,
    mode: initialMode,
    source: initialSource,
    intervalSeconds: 1,
    allowedRows: ["B", "C", "D", "E", "F"],
    preferredTimes: ["afternoon", "evening"],
    locationIds: [
      "bashundhara",
      "sony-square",
      "sks-tower",
      "shimanto-shambhar",
    ],
    preferredCategory: "any",
    rowPreference: "center",
    strategy: "best",
    keepTogether: true,
    autoReserve: true,
    openPaymentGateway: true,
    targetSeats: [],
    exactSeatsOnly: false,
    preferredHall: "",
    preferredShowtime: "",
    refreshBrowserPage:
      initial?.refreshBrowserPage ??
      (initialMode === "monitor" && initialSource === "live"),
    ...initial,
    ...(initial
      ? {
          exactSeatsOnly: Boolean(
            initial.targetSeats?.length && initial.exactSeatsOnly,
          ),
        }
      : {}),
  });
  const [seatCountText, setSeatCountText] = useState(() =>
    String(initial?.requiredSeats ?? 2),
  );
  const [refreshTouched, setRefreshTouched] = useState(
    initial?.refreshBrowserPage !== undefined,
  );
  const branchChoices = branches?.length
    ? branches
        .filter((branch) => branch.active)
        .map((branch) => ({ id: branch.locationId, shortName: branch.name }))
    : STAR_CINEPLEX_LOCATIONS;
  const [schedule, setSchedule] = useState(() =>
    initial?.scheduledAt ? toLocalDateTimeInput(initial.scheduledAt) : "",
  );
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const minSchedule = toLocalDateTimeInput(new Date());

  const availability =
    form.source === "live" &&
    inventory?.status === "live" &&
    form.movieName.trim()
      ? explainMovieAvailability(
          inventory.movies,
          inventory.shows,
          inventory.branches,
          form,
        )
      : undefined;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const update = <K extends keyof ExtendedTaskInput>(
    key: K,
    value: ExtendedTaskInput[K],
  ) =>
    setForm((prev) => {
      const next: ExtendedTaskInput = {
        ...prev,
        [key]: value,
        ...(key === "movieName" ? { targetMovieId: undefined } : {}),
        ...([
          "movieName",
          "targetDate",
          "source",
          "locationIds",
          "preferredTimes",
          "preferredHall",
          "preferredShowtime",
          "strategy",
        ].includes(key as string)
          ? { targetShowId: undefined }
          : {}),
      };
      if ((key === "mode" || key === "source") && !refreshTouched) {
        next.refreshBrowserPage =
          next.mode === "monitor" && next.source === "live";
      }
      return next;
    });

  const toggle = (
    key: "allowedRows" | "locationIds" | "preferredTimes",
    value: string,
  ) =>
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(value as never)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
      ...(key === "locationIds" || key === "preferredTimes"
        ? { targetShowId: undefined }
        : {}),
    }));

  const handleSeatCountChange = (raw: string) => {
    setSeatCountText(raw);
    if (/^\d+$/.test(raw)) {
      const parsed = Number.parseInt(raw, 10);
      if (parsed >= 1 && parsed <= 50) {
        update("requiredSeats", parsed);
      }
    }
  };

  const handleSeatCountBlur = () => {
    const parsed = Number.parseInt(seatCountText, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      setSeatCountText(String(form.requiredSeats));
    } else {
      setSeatCountText(String(parsed));
      update("requiredSeats", parsed);
    }
  };

  const handleTargetSeatsChange = (seats: string[]) => {
    setForm((prev) => ({
      ...prev,
      targetSeats: seats,
      ...(seats.length > 0
        ? { requiredSeats: seats.length }
        : { exactSeatsOnly: false }),
    }));
    if (seats.length > 0) {
      setSeatCountText(String(seats.length));
    }
  };

  const handleExactSeatsOnlyChange = (exactOnly: boolean) => {
    setForm((prev) => {
      const targetCount = prev.targetSeats?.length ?? 0;
      const nextExact = targetCount > 0 ? exactOnly : false;
      const shouldClamp =
        nextExact && targetCount > 0 && prev.requiredSeats > targetCount;
      if (shouldClamp) {
        setSeatCountText(String(targetCount));
      }
      return {
        ...prev,
        exactSeatsOnly: nextExact,
        ...(shouldClamp ? { requiredSeats: targetCount } : {}),
      };
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!connected) {
      setError("The dashboard is disconnected from the local bot service.");
      return;
    }
    const parsedCount = Number.parseInt(seatCountText, 10);
    if (
      !seatCountText.trim() ||
      !Number.isInteger(parsedCount) ||
      parsedCount < 1 ||
      parsedCount > 50
    ) {
      setError("Choose between 1 and 50 seats.");
      return;
    }
    const targetSeats = form.targetSeats?.length ? form.targetSeats : undefined;
    const exactSeatsOnly = Boolean(targetSeats && form.exactSeatsOnly);
    if (exactSeatsOnly && targetSeats && targetSeats.length < parsedCount) {
      setError(
        `Exact seats only requires at least ${parsedCount} selected seat${parsedCount === 1 ? "" : "s"}.`,
      );
      return;
    }
    let scheduledAt: string | undefined;
    if (form.mode === "monitor" && schedule.trim()) {
      scheduledAt = parseLocalDateTimeInput(schedule);
      if (!scheduledAt) {
        setError("Choose a valid start date and time.");
        return;
      }
    }
    try {
      await onCreate({
        ...form,
        requiredSeats: parsedCount,
        targetSeats,
        exactSeatsOnly,
        refreshBrowserPage: Boolean(form.refreshBrowserPage),
        preferredHall: form.preferredHall?.trim() || undefined,
        preferredShowtime: form.preferredShowtime?.trim() || undefined,
        scheduledAt,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="task-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <form onSubmit={submit}>
        <header className="dialog-head">
          <div>
            <span className="eyebrow">
              {editing ? "ADJUST MISSION" : "A NEW MISSION"}
            </span>
            <h2>
              {editing ? "Update your seat search." : "Let’s get you seated."}
            </h2>
            <p>Set your preferences. Your bot takes it from here.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close new task"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">
          {form.targetShowId && (
            <div className="pinned-show">
              <Icon name="pin" size={15} />
              <span>
                Pinned to your selected show.
                {pinnedShow && (
                  <strong>
                    {pinnedShow.date} · {pinnedShow.time} ·{" "}
                    {pinnedShow.cinema.name} · {pinnedShow.hall.name}
                  </strong>
                )}{" "}
                Changing branch or time preferences searches matching shows
                instead.
              </span>
              <button
                type="button"
                className="button secondary compact"
                onClick={() => update("targetShowId", undefined)}
              >
                Unpin show
              </button>
            </div>
          )}
          <div className="mode-picker">
            {(["instant", "monitor"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={form.mode === mode ? "selected" : ""}
                onClick={() => update("mode", mode)}
              >
                <Icon name={mode === "instant" ? "bolt" : "clock"} />
                <span>
                  <strong>
                    {mode === "instant" ? "Instant search" : "Monitor a drop"}
                  </strong>
                  <small>
                    {mode === "instant"
                      ? "Find available seats now"
                      : "Keep watching every 1s until seats open"}
                  </small>
                </span>
                {form.mode === mode && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
          <label className="field">
            Movie name
            <input
              autoFocus
              required
              maxLength={120}
              placeholder="What are we watching?"
              list="live-movie-titles"
              value={form.movieName}
              onChange={(e) => update("movieName", e.target.value)}
            />
          </label>
          <datalist id="live-movie-titles">
            {movies?.map((movie) => (
              <option key={movie.id} value={movie.title} />
            ))}
          </datalist>
          <div className="form-row">
            <label className="field">
              Show date
              <input
                aria-label="Show date"
                type="date"
                required
                min={today()}
                value={form.targetDate}
                onChange={(e) => update("targetDate", e.target.value)}
              />
            </label>
            <label className="field">
              Number of seats
              <input
                aria-label="Number of seats"
                type="number"
                min="1"
                max="50"
                required
                value={seatCountText}
                onChange={(e) => handleSeatCountChange(e.target.value)}
                onBlur={handleSeatCountBlur}
              />
            </label>
          </div>
          {availability && (
            <section
              className="booking-availability"
              role="note"
              aria-label="Current search availability"
            >
              <h3>{availability.title}</h3>
              <p>
                {availability.title === "Tickets available"
                  ? "Published shows have reported tickets. The browser verifies actual seat availability when the task runs."
                  : availability.message}
              </p>
              {availability.title !== "Tickets available" &&
                form.mode === "instant" && (
                  <button
                    type="button"
                    className="button secondary compact"
                    onClick={() => update("mode", "monitor")}
                  >
                    Watch for show announcements
                  </button>
                )}
            </section>
          )}
          <div className="field">
            <div className="label-row">
              <span>Cinema branches</span>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  update(
                    "locationIds",
                    form.locationIds.length
                      ? []
                      : branchChoices.map((l) => l.id),
                  )
                }
              >
                {form.locationIds.length ? "Clear selection" : "Select all"}
              </button>
            </div>
            <div className="branch-choices">
              {branchChoices.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  aria-pressed={form.locationIds.includes(loc.id)}
                  className={`choice ${form.locationIds.includes(loc.id) ? "selected" : ""}`}
                  onClick={() => toggle("locationIds", loc.id)}
                >
                  <Icon name="pin" size={13} />
                  {loc.shortName}
                </button>
              ))}
            </div>
            <small>
              {form.locationIds.length
                ? `${form.locationIds.length} selected`
                : "All supported branches"}
            </small>
          </div>
          <BookingPreferences
            allowedRows={form.allowedRows}
            preferredTimes={form.preferredTimes}
            onRowsChange={(rows) => update("allowedRows", rows)}
            onTimesChange={(times) => update("preferredTimes", times)}
          />
          <div className="form-row">
            <label className="field">
              Preferred hall <span className="muted">(optional)</span>
              <input
                data-testid="preferred-hall-input"
                type="text"
                maxLength={100}
                placeholder="IMAX, VIP, Hall 1 (optional)"
                value={form.preferredHall ?? ""}
                onChange={(e) => update("preferredHall", e.target.value)}
              />
            </label>
            <label className="field">
              Exact showtime <span className="muted">(optional · 24h)</span>
              <input
                data-testid="preferred-showtime-input"
                type="time"
                value={form.preferredShowtime ?? ""}
                onChange={(e) => update("preferredShowtime", e.target.value)}
              />
            </label>
          </div>
          <ExactSeatPicker
            targetSeats={form.targetSeats || []}
            exactSeatsOnly={Boolean(form.exactSeatsOnly)}
            refreshBrowserPage={Boolean(form.refreshBrowserPage)}
            showRefreshToggle={form.source === "live"}
            requiredSeats={form.requiredSeats}
            onTargetSeatsChange={handleTargetSeatsChange}
            onExactSeatsOnlyChange={handleExactSeatsOnlyChange}
            onRefreshBrowserPageChange={(enabled) => {
              setRefreshTouched(true);
              update("refreshBrowserPage", enabled);
            }}
          />
          {form.mode === "monitor" && (
            <div className="form-row">
              <label className="field">
                Check every
                <select
                  value={form.intervalSeconds}
                  onChange={(e) =>
                    update("intervalSeconds", Number(e.target.value))
                  }
                >
                  <option value="1">1 second (Drop sniper)</option>
                  <option value="2.5">2.5 seconds</option>
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">1 minute</option>
                </select>
              </label>
              <label className="field">
                Start at <span className="muted">(optional · local time)</span>
                <input
                  type="datetime-local"
                  min={minSchedule}
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                />
              </label>
            </div>
          )}
          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <Icon name="settings" size={16} />
            Seating & automation
            <Icon
              name="chevron"
              size={15}
              className={advanced ? "rotate" : ""}
            />
          </button>
          {advanced && (
            <div className="advanced-fields">
              <div className="form-row">
                <label className="field">
                  Seat tier
                  <select
                    value={form.preferredCategory}
                    onChange={(e) =>
                      update(
                        "preferredCategory",
                        e.target.value as ExtendedTaskInput["preferredCategory"],
                      )
                    }
                  >
                    {SEAT_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Row preference
                  <select
                    value={form.rowPreference}
                    onChange={(e) =>
                      update(
                        "rowPreference",
                        e.target.value as ExtendedTaskInput["rowPreference"],
                      )
                    }
                  >
                    <option value="center">Best centered seats</option>
                    <option value="front">Front rows first</option>
                    <option value="back">Back rows first</option>
                  </select>
                </label>
              </div>
              <label className="field">
                Booking strategy
                <select
                  value={form.strategy}
                  onChange={(e) =>
                    update(
                      "strategy",
                      e.target.value as ExtendedTaskInput["strategy"],
                    )
                  }
                >
                  <option value="best">Best matching show</option>
                  <option value="each_location">
                    One show per selected branch
                  </option>
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.keepTogether}
                  onChange={(e) => update("keepTogether", e.target.checked)}
                />
                <span>
                  <strong>Keep all seats together</strong>
                  <small>
                    Turn off to allow seats across separate blocks or rows.
                  </small>
                </span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.autoReserve}
                  onChange={(e) => update("autoReserve", e.target.checked)}
                />
                <span>
                  <strong>Automatically select seats</strong>
                  <small>
                    Open the bot browser and continue to checkout when a match
                    is found.
                  </small>
                </span>
              </label>
            </div>
          )}
          <div
            className={`demo-switch ${form.source === "demo" ? "is-demo" : ""}`}
          >
            <Icon name="shield" />
            <div>
              <strong>Demo mode</strong>
              <small>Try the complete dashboard with simulated seats.</small>
            </div>
            <label className="switch">
              <input
                aria-label="Demo mode"
                type="checkbox"
                checked={form.source === "demo"}
                onChange={(e) =>
                  update("source", e.target.checked ? "demo" : "live")
                }
              />
              <span />
            </label>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="dialog-footer">
          <span>
            <Icon name="shield" size={14} />
            Payment stays in your hands.
          </span>
          <button className="button primary" disabled={busy || !connected}>
            {busy
              ? editing
                ? "Saving…"
                : "Creating…"
              : editing
                ? form.mode === "instant"
                  ? "Save & find seats"
                  : "Save & monitor"
                : form.mode === "instant"
                  ? "Find my seats"
                  : "Start monitoring"}
            <Icon name="arrow" size={17} />
          </button>
        </footer>
      </form>
    </dialog>
  );
}
