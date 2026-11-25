import { useEffect, useRef, useState } from "react";
import type { LiveInventory, LiveMovie } from "../../bot/src/live-types";
import {
  movieDateAvailability,
  availabilityLabels,
} from "../../bot/src/availability";
import { Icon } from "./icons";
import { today } from "./TaskForm";
import { getTimeSlot, type TimeSlot } from "../../packages/core/src";
import BookingPreferences from "./BookingPreferences";
import ExactSeatPicker from "./ExactSeatPicker";
import {
  SEAT_CATEGORY_OPTIONS,
  parseLocalDateTimeInput,
  toLocalDateTimeInput,
  type ExtendedTaskInput,
} from "./types";

export interface MovieBookingChoice {
  movie: LiveMovie;
  date?: string;
  locationIds: string[];
}
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00+06:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dhaka",
  });
const timeLabel = (date: string) =>
  new Date(date).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dhaka",
  });
export default function MovieBooking({
  choice,
  inventory,
  connected,
  onClose,
  onCreate,
}: {
  choice: MovieBookingChoice;
  inventory: LiveInventory;
  connected: boolean;
  onClose(): void;
  onCreate(input: ExtendedTaskInput): Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(choice.date || today());
  const [count, setCount] = useState(2);
  const [countText, setCountText] = useState("2");
  const [locations, setLocations] = useState(choice.locationIds);
  const [together, setTogether] = useState(true);
  const [allowedRows, setAllowedRows] = useState<string[]>([]);
  const [preferredTimes, setPreferredTimes] = useState<TimeSlot[]>([]);
  const [targetSeats, setTargetSeats] = useState<string[]>([]);
  const [exactSeatsOnly, setExactSeatsOnly] = useState(false);
  const [refreshBrowserPage, setRefreshBrowserPage] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(1);
  const [schedule, setSchedule] = useState("");
  const [preferredCategory, setPreferredCategory] =
    useState<ExtendedTaskInput["preferredCategory"]>("any");
  const [rowPreference, setRowPreference] =
    useState<ExtendedTaskInput["rowPreference"]>("center");
  const [showSeatPrefs, setShowSeatPrefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const minSchedule = toLocalDateTimeInput(new Date());

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const movie =
    inventory.movies.find((item) => item.id === choice.movie.id) ||
    choice.movie;
  const matchingShows = inventory.shows.filter(
    (show) =>
      !preferredTimes.length || preferredTimes.includes(getTimeSlot(show.time)),
  );
  const dateAvailability = movieDateAvailability(
    inventory.shows,
    inventory.branches,
    movie.id,
    date,
    locations,
    count,
  );
  const availability = movieDateAvailability(
    matchingShows,
    inventory.branches,
    movie.id,
    date,
    locations,
    count,
  );
  const excludedByTimes =
    dateAvailability.shows.length > 0 && availability.shows.length === 0;
  const fresh = connected && inventory.status === "live";
  const canBook = availability.state === "available";
  const parsedCount = Number.parseInt(countText, 10);
  const valid =
    countText.trim() !== "" &&
    Number.isInteger(parsedCount) &&
    parsedCount >= 1 &&
    parsedCount <= 50;
  const dates = [
    ...new Set(
      inventory.shows
        .filter((show) => show.movie.id === movie.id && show.date >= today())
        .map((show) => show.date),
    ),
  ].sort();
  const publishedDates = dates
    .map((day) => ({
      day,
      data: movieDateAvailability(
        matchingShows,
        inventory.branches,
        movie.id,
        day,
        locations,
        count,
      ),
    }))
    .filter(
      (item) =>
        movieDateAvailability(
          inventory.shows,
          inventory.branches,
          movie.id,
          item.day,
          locations,
          count,
        ).shows.length,
    )
    .slice(0, 10);

  const handleCountChange = (raw: string) => {
    setCountText(raw);
    if (/^\d+$/.test(raw)) {
      const value = Number.parseInt(raw, 10);
      if (value >= 1 && value <= 50) setCount(value);
    }
  };

  const handleCountBlur = () => {
    const value = Number.parseInt(countText, 10);
    if (!Number.isInteger(value) || value < 1 || value > 50) {
      setCountText(String(count));
    } else {
      setCount(value);
      setCountText(String(value));
    }
  };

  const handleTargetSeatsChange = (seats: string[]) => {
    setTargetSeats(seats);
    if (seats.length > 0) {
      setCount(seats.length);
      setCountText(String(seats.length));
    }
  };

  const handleExactSeatsOnlyChange = (nextExact: boolean) => {
    setExactSeatsOnly(nextExact);
    if (nextExact && targetSeats.length > 0 && count > targetSeats.length) {
      setCount(targetSeats.length);
      setCountText(String(targetSeats.length));
    }
  };

  const submitTask = async (forceMonitor: boolean) => {
    setError("");
    if (!valid) {
      setError("Choose between 1 and 50 seats.");
      return;
    }
    if (!connected) {
      setError("The dashboard is disconnected from the local bot service.");
      return;
    }
    if (!forceMonitor && !fresh) return;
    if (
      exactSeatsOnly &&
      targetSeats.length > 0 &&
      targetSeats.length < parsedCount
    ) {
      setError(
        `Exact seats only requires at least ${parsedCount} selected seat${parsedCount === 1 ? "" : "s"}.`,
      );
      return;
    }
    const mode: "instant" | "monitor" =
      forceMonitor || !canBook ? "monitor" : "instant";
    let scheduledAt: string | undefined;
    if (mode === "monitor" && schedule.trim()) {
      scheduledAt = parseLocalDateTimeInput(schedule);
      if (!scheduledAt) {
        setError("Choose a valid start date and time.");
        return;
      }
    }
    setBusy(true);
    try {
      await onCreate({
        targetMovieId: movie.id,
        movieName: movie.title,
        targetDate: date,
        requiredSeats: parsedCount,
        locationIds: locations,
        mode,
        source: "live",
        autoReserve: true,
        openPaymentGateway: true,
        intervalSeconds,
        scheduledAt,
        allowedRows,
        preferredTimes,
        preferredCategory,
        rowPreference,
        strategy: "best",
        keepTogether: together,
        targetSeats: targetSeats.length ? targetSeats : undefined,
        exactSeatsOnly,
        refreshBrowserPage: mode === "monitor" ? refreshBrowserPage : false,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitTask(false);
  };

  return (
    <dialog
      ref={dialog}
      className="task-dialog movie-booking-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <form onSubmit={submit}>
        <header className="dialog-head">
          <div>
            <span className="eyebrow">YOUR MOVIE NIGHT</span>
            <h2>{movie.title}</h2>
            <p>
              Choose your date, exact seats, rows, times and locations. Your bot
              handles the seat search.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close movie booking"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">
          <div className="booking-movie">
            <span className="booking-poster">
              {movie.posterUrl?.startsWith("https://") ? (
                <img src={movie.posterUrl} alt={`${movie.title} poster`} />
              ) : (
                <Icon name="film" size={32} />
              )}
            </span>
            <div>
              <strong>
                {!inventory.shows.some(
                  (show) =>
                    show.movie.id === movie.id &&
                    show.ticketStatus !== "started" &&
                    show.date >= today(),
                )
                  ? "No shows announced"
                  : inventory.shows.some(
                        (show) =>
                          show.movie.id === movie.id &&
                          show.ticketStatus === "open" &&
                          show.date >= today(),
                      )
                    ? "Now showing"
                    : movie.isUpcoming
                      ? "Coming soon"
                      : "Now showing"}
              </strong>
              <p>
                {movie.formats.join(" · ")}
                {movie.duration ? ` · ${movie.duration} minutes` : ""}
              </p>
              {movie.releaseDate && (
                <small>
                  Release date: {movie.releaseDate.slice(0, 10)}. Ticket sales
                  may open separately.
                </small>
              )}
            </div>
          </div>
          <div className="form-row">
            <label className="field">
              Show date
              <input
                aria-label="Booking date"
                type="date"
                min={today()}
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="field">
              Number of seats
              <input
                aria-label="Booking seat count"
                type="number"
                min={1}
                max={50}
                required
                value={countText}
                onChange={(event) => handleCountChange(event.target.value)}
                onBlur={handleCountBlur}
              />
            </label>
          </div>
          <section className="field">
            <div className="label-row">
              <span>Locations</span>
              <button
                type="button"
                className="text-button"
                onClick={() => setLocations([])}
              >
                All locations
              </button>
            </div>
            <div className="branch-choices">
              {inventory.branches
                .filter((branch) => branch.active)
                .map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    className={`choice ${!locations.length || locations.includes(branch.locationId) ? "selected" : ""}`}
                    aria-pressed={
                      !locations.length || locations.includes(branch.locationId)
                    }
                    onClick={() =>
                      setLocations((current) =>
                        !current.length
                          ? [branch.locationId]
                          : current.includes(branch.locationId)
                            ? current.filter((id) => id !== branch.locationId)
                            : [...current, branch.locationId],
                      )
                    }
                  >
                    <Icon name="pin" size={13} />
                    {branch.name}
                  </button>
                ))}
            </div>
            <small>
              {!locations.length
                ? "Search all active locations. Click a location to narrow the search."
                : `${locations.length} selected location${locations.length === 1 ? "" : "s"}`}
            </small>
          </section>
          <BookingPreferences
            allowedRows={allowedRows}
            preferredTimes={preferredTimes}
            onRowsChange={setAllowedRows}
            onTimesChange={setPreferredTimes}
          />
          <ExactSeatPicker
            targetSeats={targetSeats}
            exactSeatsOnly={exactSeatsOnly}
            refreshBrowserPage={refreshBrowserPage}
            showRefreshToggle
            requiredSeats={count}
            onTargetSeatsChange={handleTargetSeatsChange}
            onExactSeatsOnlyChange={handleExactSeatsOnlyChange}
            onRefreshBrowserPageChange={setRefreshBrowserPage}
          />
          <section
            className={`booking-availability ${fresh && canBook ? "available" : ""}`}
            aria-live="polite"
            aria-label="Selected date availability"
          >
            <span className="eyebrow">
              {dayLabel(date)} · {count} SEAT{count === 1 ? "" : "S"}
            </span>
            <h3>
              {fresh
                ? excludedByTimes
                  ? "No shows at selected times"
                  : availabilityLabels[availability.state]
                : "Live availability needs a refresh"}
            </h3>
            <p>
              {fresh
                ? excludedByTimes
                  ? "Published shows on this date fall outside your time slots. Choose Any time or change your preferred showtimes."
                  : canBook
                    ? `${availability.bookableShows.length} show${availability.bookableShows.length === 1 ? " has" : "s have"} at least ${count} reported seats matching your locations and time slots. Selected rows are verified in your browser.`
                    : availability.state === "insufficient"
                      ? "Available seats are spread across shows or below your requested count. Try fewer seats, another date or more locations."
                      : availability.state === "unpublished"
                        ? "Cineplex has not published shows for these choices. This does not mean the date is sold out."
                        : "Choose another date or watch these choices for a sales opening."
                : "The last snapshot cannot confirm instant tickets. Refresh Live Cineplex for instant booking, or arm a 1s drop monitor below."}
            </p>
            {!canBook && (
              <p className="booking-opening">
                {availability.openingAt
                  ? `Cineplex lists ticket opening: ${timeLabel(availability.openingAt)} (Dhaka time).`
                  : "Ticket-opening time: not announced by Cineplex for these choices."}
              </p>
            )}
            {availability.openingAt && (
              <button
                type="button"
                data-testid="schedule-opening-btn"
                className="button secondary compact schedule-opening-btn"
                onClick={() =>
                  setSchedule(toLocalDateTimeInput(availability.openingAt!))
                }
              >
                <Icon name="clock" size={13} />
                Schedule for online sales open
              </button>
            )}
            {inventory.fetchedAt && (
              <small>
                Last checked {timeLabel(inventory.fetchedAt)} · Dhaka time. Seat
                counts can change; adjacent seats are verified in your browser.
              </small>
            )}
          </section>
          {(!canBook || !fresh) && (
            <div className="form-row">
              <label className="field">
                Check every
                <select
                  aria-label="Monitor check interval"
                  value={intervalSeconds}
                  onChange={(event) =>
                    setIntervalSeconds(Number(event.target.value))
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
                  aria-label="Monitor start time"
                  type="datetime-local"
                  min={minSchedule}
                  value={schedule}
                  onChange={(event) => setSchedule(event.target.value)}
                />
              </label>
            </div>
          )}
          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={showSeatPrefs}
            onClick={() => setShowSeatPrefs(!showSeatPrefs)}
          >
            <Icon name="settings" size={16} />
            Seat tier & row preferences
            <Icon
              name="chevron"
              size={15}
              className={showSeatPrefs ? "rotate" : ""}
            />
          </button>
          {showSeatPrefs && (
            <div className="advanced-fields">
              <div className="form-row">
                <label className="field">
                  Seat tier
                  <select
                    value={preferredCategory}
                    onChange={(event) =>
                      setPreferredCategory(
                        event.target
                          .value as ExtendedTaskInput["preferredCategory"],
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
                    value={rowPreference}
                    onChange={(event) =>
                      setRowPreference(
                        event.target
                          .value as ExtendedTaskInput["rowPreference"],
                      )
                    }
                  >
                    <option value="center">Best centered seats</option>
                    <option value="front">Front rows first</option>
                    <option value="back">Back rows first</option>
                  </select>
                </label>
              </div>
            </div>
          )}
          {!!availability.shows.length && (
            <section
              className="booking-show-list"
              aria-label="Shows for selected date"
            >
              <h3>Shows on your date</h3>
              {availability.shows.map((show) => (
                <div key={show.id}>
                  <span>
                    <strong>{show.time}</strong>
                    <small>
                      {
                        inventory.branches.find(
                          (branch) => branch.id === show.venueId,
                        )?.name
                      }{" "}
                      · {show.hall.name}
                    </small>
                  </span>
                  <span className={`sale-status sale-${show.ticketStatus}`}>
                    {show.ticketStatus === "open"
                      ? `${show.availableSeats} seats reported`
                      : show.ticketStatus.replaceAll("_", " ")}
                  </span>
                </div>
              ))}
            </section>
          )}
          <section
            className="booking-upcoming"
            aria-label="Upcoming movie dates"
          >
            <h3>Published dates & upcoming shows</h3>
            {publishedDates.length ? (
              <div className="booking-date-options">
                {publishedDates.map(({ day, data }) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={date === day}
                    className={date === day ? "selected" : ""}
                    onClick={() => setDate(day)}
                  >
                    <strong>{dayLabel(day)}</strong>
                    <span>
                      {data.shows.length
                        ? availabilityLabels[data.state]
                        : "No shows at selected times"}
                    </span>
                    {data.openingAt && (
                      <small>Opens {timeLabel(data.openingAt)}</small>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p>
                No future shows have been published yet. You can still choose a
                date above and watch it.
              </p>
            )}
            <small>
              Only dates published by Cineplex appear here. A release date is
              not a ticket-opening announcement.
            </small>
          </section>
          <label className="check-row">
            <input
              type="checkbox"
              checked={together}
              onChange={(event) => setTogether(event.target.checked)}
            />
            <span>
              <strong>Keep seats together</strong>
              <small>
                The bot checks the actual seat map in your connected browser.
              </small>
            </span>
          </label>
          <div className="booking-handoff">
            <Icon name="browser" size={19} />
            <p>
              {canBook
                ? "Your bot will use the connected browser, select the seats and continue toward the payment gateway. You complete login challenges, required checkout details and payment."
                : "Watching checks this exact movie, date, seat count, rows, time slots and locations every 1 second. When tickets become available, the bot uses your connected browser to select seats and open payment."}
            </p>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <div className="dialog-footer-actions">
            {!fresh && (
              <button
                type="button"
                data-testid="arm-stale-monitor-btn"
                className="button secondary"
                disabled={busy || !connected || !valid}
                onClick={() => void submitTask(true)}
              >
                <Icon name="bolt" size={15} />
                Arm 1s drop monitor
              </button>
            )}
            <button
              className="button primary"
              disabled={busy || !fresh || !valid}
            >
              <Icon name={canBook ? "ticket" : "clock"} size={17} />
              {busy
                ? "Starting…"
                : canBook
                  ? "Get seats & open payment"
                  : "Watch selected date"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
