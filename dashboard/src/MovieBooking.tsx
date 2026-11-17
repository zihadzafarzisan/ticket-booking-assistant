import { useEffect, useRef, useState } from "react";
import type { LiveInventory, LiveMovie } from "../../bot/src/live-types";
import type { TaskInput } from "../../bot/src/contracts";
import {
  movieDateAvailability,
  availabilityLabels,
} from "../../bot/src/availability";
import { Icon } from "./icons";
import { today } from "./TaskForm";
import { getTimeSlot, type TimeSlot } from "../../packages/core/src";
import BookingPreferences from "./BookingPreferences";

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
  onCreate(input: TaskInput): Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(choice.date || today());
  const [count, setCount] = useState(2);
  const [locations, setLocations] = useState(choice.locationIds);
  const [together, setTogether] = useState(true);
  const [allowedRows, setAllowedRows] = useState<string[]>([]);
  const [preferredTimes, setPreferredTimes] = useState<TimeSlot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const valid = Number.isInteger(count) && count >= 1 && count <= 50;
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
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!fresh || !valid) return;
    setBusy(true);
    try {
      await onCreate({
        targetMovieId: movie.id,
        movieName: movie.title,
        targetDate: date,
        requiredSeats: count,
        locationIds: locations,
        mode: canBook ? "instant" : "monitor",
        source: "live",
        autoReserve: true,
        openPaymentGateway: true,
        intervalSeconds: 30,
        allowedRows,
        preferredTimes,
        preferredCategory: "any",
        rowPreference: "center",
        strategy: "best",
        keepTogether: together,
      });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
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
              Choose your date, seats, rows, times and locations. Your bot
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
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
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
                : "The last snapshot cannot confirm tickets. Refresh Live Cineplex before starting a booking."}
            </p>
            {!canBook && (
              <p className="booking-opening">
                {availability.openingAt
                  ? `Cineplex lists ticket opening: ${timeLabel(availability.openingAt)} (Dhaka time).`
                  : "Ticket-opening time: not announced by Cineplex for these choices."}
              </p>
            )}
            {inventory.fetchedAt && (
              <small>
                Last checked {timeLabel(inventory.fetchedAt)} · Dhaka time. Seat
                counts can change; adjacent seats are verified in your browser.
              </small>
            )}
          </section>
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
                  <span className={`sale-status ${show.ticketStatus}`}>
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
                : "Watching checks this exact movie, date, seat count, rows, time slots and locations. When tickets become available, the bot uses your connected browser to select seats and open payment."}
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
        </footer>
      </form>
    </dialog>
  );
}
