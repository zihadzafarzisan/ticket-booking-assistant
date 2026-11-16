import { useEffect, useRef, useState } from "react";
import {
  STAR_CINEPLEX_LOCATIONS,
  TIME_SLOT_CONFIG,
  type TimeSlot,
} from "../../packages/core/src";
import type { TaskInput } from "../../bot/src/contracts";
import type { LiveMovie, LiveBranch, LiveShow } from "../../bot/src/live-types";
import { Icon } from "./icons";
export const today = () =>
  new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
export default function TaskForm({
  onClose,
  onCreate,
  busy,
  initial,
  movies,
  branches,
  editing = false,
  pinnedShow,
}: {
  onClose: () => void;
  onCreate: (input: TaskInput) => Promise<void>;
  busy: boolean;
  initial?: Partial<TaskInput>;
  movies?: LiveMovie[];
  branches?: LiveBranch[];
  editing?: boolean;
  pinnedShow?: LiveShow;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<TaskInput>({
    movieName: "",
    targetDate: today(),
    requiredSeats: 2,
    mode: "instant",
    source: "live",
    intervalSeconds: 5,
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
    ...initial,
  });
  const branchChoices = branches?.length
    ? branches
        .filter((branch) => branch.active)
        .map((branch) => ({ id: branch.locationId, shortName: branch.name }))
    : STAR_CINEPLEX_LOCATIONS;
  const [schedule, setSchedule] = useState(() => {
    if (!initial?.scheduledAt) return "";
    const date = new Date(initial.scheduledAt);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...([
        "movieName",
        "targetDate",
        "source",
        "locationIds",
        "preferredTimes",
        "strategy",
      ].includes(key)
        ? { targetShowId: undefined }
        : {}),
    }));
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
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await onCreate({
        ...form,
        scheduledAt:
          form.mode === "monitor" && schedule
            ? new Date(schedule).toISOString()
            : undefined,
      });
    } catch (error) {
      setError((error as Error).message);
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
                      : "Keep watching until seats open"}
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
              value={form.movieName}
              onChange={(e) => update("movieName", e.target.value)}
            />
          </label>
          <div className="form-row">
            <label className="field">
              Show date
              <input
                list="live-movie-titles"
                aria-label="Show date"
                type="date"
                required
                min={today()}
                value={form.targetDate}
                onChange={(e) => update("targetDate", e.target.value)}
              />
              <datalist id="live-movie-titles">
                {movies?.map((movie) => (
                  <option key={movie.id} value={movie.title} />
                ))}
              </datalist>
            </label>
            <label className="field">
              Number of seats
              <input
                aria-label="Number of seats"
                type="number"
                min="1"
                max="50"
                required
                value={form.requiredSeats}
                onChange={(e) =>
                  update("requiredSeats", Number(e.target.value))
                }
              />
            </label>
          </div>
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
          <div className="field">
            Preferred showtimes
            <div className="slot-choices">
              {(Object.keys(TIME_SLOT_CONFIG) as TimeSlot[]).map((slot) => (
                <button
                  type="button"
                  key={slot}
                  aria-pressed={form.preferredTimes.includes(slot)}
                  className={`choice ${form.preferredTimes.includes(slot) ? "selected" : ""}`}
                  onClick={() => toggle("preferredTimes", slot)}
                >
                  {TIME_SLOT_CONFIG[slot].label}
                  <small>{TIME_SLOT_CONFIG[slot].desc}</small>
                </button>
              ))}
            </div>
          </div>
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
              <div className="field">
                Rows
                <div className="row-choices">
                  {[
                    "A",
                    "B",
                    "C",
                    "D",
                    "E",
                    "F",
                    "G",
                    "H",
                    "J",
                    "K",
                    "L",
                    "M",
                    "N",
                  ].map((row) => (
                    <button
                      key={row}
                      type="button"
                      aria-pressed={form.allowedRows.includes(row)}
                      className={`choice ${form.allowedRows.includes(row) ? "selected" : ""}`}
                      onClick={() => toggle("allowedRows", row)}
                    >
                      {row}
                    </button>
                  ))}
                </div>
                <small>
                  {form.allowedRows.length
                    ? "Only these rows will be selected."
                    : "Any available row."}
                </small>
              </div>
              <div className="form-row">
                <label className="field">
                  Seat tier
                  <select
                    value={form.preferredCategory}
                    onChange={(e) =>
                      update(
                        "preferredCategory",
                        e.target.value as TaskInput["preferredCategory"],
                      )
                    }
                  >
                    <option value="any">Any tier</option>
                    <option value="regular">Regular</option>
                    <option value="premium">Premium</option>
                    <option value="vip">VIP</option>
                    <option value="lounger">Lounger</option>
                  </select>
                </label>
                <label className="field">
                  Row preference
                  <select
                    value={form.rowPreference}
                    onChange={(e) =>
                      update(
                        "rowPreference",
                        e.target.value as TaskInput["rowPreference"],
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
                    update("strategy", e.target.value as TaskInput["strategy"])
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
          <button className="button primary" disabled={busy}>
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
