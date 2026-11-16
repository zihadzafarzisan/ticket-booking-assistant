import { useMemo, useState } from "react";
import type {
  LiveInventory,
  LiveMovie,
  LiveShow,
  TicketStatus,
} from "../../bot/src/live-types";
import type { TaskInput } from "../../bot/src/contracts";
import { getTimeSlot } from "../../packages/core/src";
import { Icon } from "./icons";
import type { MovieBookingChoice } from "./MovieBooking";

const labels: Record<TicketStatus, string> = {
  open: "Online sales open",
  sold_out: "Sold out",
  not_open: "Not open yet",
  closed: "Online sales closed",
  counter_only: "Counter only",
  started: "Show started",
  unknown: "Status unavailable",
};
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00+06:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dhaka",
  });
const branchName = (show: LiveShow) =>
  show.cinema.name.replace(/^Star Cineplex\s*\(/, "").replace(/\)$/, "");
export default function LiveCineplex({
  inventory,
  connected,
  onRefresh,
  onCreate,
  onChooseMovie,
}: {
  inventory?: LiveInventory;
  connected: boolean;
  onRefresh: () => Promise<unknown>;
  onCreate: (seed: Partial<TaskInput>) => void;
  onChooseMovie: (choice: MovieBookingChoice) => void;
}) {
  const [tab, setTab] = useState<"movies" | "shows" | "halls">("movies");
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [date, setDate] = useState("");
  const [movieScope, setMovieScope] = useState<"now" | "upcoming" | "all">(
    "now",
  );
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fresh = connected && inventory?.status === "live";
  const shows = inventory?.shows || [];
  const today = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
  const dates = useMemo(
    () =>
      [
        ...new Set(shows.filter((s) => s.date >= today).map((s) => s.date)),
      ].sort(),
    [shows, today],
  );
  const scoped = shows.filter(
    (show) =>
      show.ticketStatus !== "started" &&
      (!branch || show.venueId === branch) &&
      (!date || show.date === date) &&
      (!query || show.movie.title.toLowerCase().includes(query.toLowerCase())),
  );
  const listedShows = scoped.filter(
    (show) => !onlyOpen || show.ticketStatus === "open",
  );
  const movies = (inventory?.movies || []).filter(
    (movie) =>
      (!query || movie.title.toLowerCase().includes(query.toLowerCase())) &&
      (movieScope === "all" ||
        (movieScope === "now" ? movie.isNowShowing : movie.isUpcoming)),
  );
  const changes = inventory?.changes || [];
  const newlyOpened = new Set(changes.map((change) => change.showId));
  const halls = (inventory?.halls || [])
    .filter(
      (hall) =>
        (!branch || hall.branchId === branch) &&
        scoped.some(
          (show) => show.hall.id === hall.id && show.venueId === hall.branchId,
        ),
    )
    .map((hall) => {
      const hallShows = scoped.filter(
        (show) => show.hall.id === hall.id && show.venueId === hall.branchId,
      );
      const open = hallShows.filter((show) => show.ticketStatus === "open");
      return {
        ...hall,
        scheduledShows: hallShows.length,
        openShows: open.length,
        reportedAvailableSeats: open.reduce(
          (sum, s) => sum + s.availableSeats,
          0,
        ),
      };
    });
  const seed = (movie: LiveMovie, show?: LiveShow, exact = false) => {
    const matching =
      show ||
      scoped.find(
        (s) => s.movie.id === movie.id && s.ticketStatus === "open",
      ) ||
      scoped.find((s) => s.movie.id === movie.id);
    const chosenBranch = inventory?.branches.find(
      (b) => b.id === (matching?.venueId || branch),
    );
    onCreate({
      movieName: movie.title,
      targetMovieId: movie.id,
      targetDate: matching?.date || date || today,
      source: "live",
      mode: matching?.ticketStatus === "open" ? "instant" : "monitor",
      locationIds: chosenBranch ? [chosenBranch.locationId] : [],
      preferredTimes: exact && matching ? [getTimeSlot(matching.time)] : [],
      ...(exact && matching ? { targetShowId: matching.id } : {}),
      autoReserve: true,
    });
  };
  const chooseMovie = (movie: LiveMovie) =>
    onChooseMovie({
      movie,
      date: date || undefined,
      locationIds: branch
        ? [inventory!.branches.find((item) => item.id === branch)!.locationId]
        : [],
    });
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="live-cineplex">
      <section className="live-source-bar">
        <div className="live-source-heading">
          <span
            className={`provider-dot ${inventory?.status === "live" ? "live" : ""}`}
          />
          <div>
            <strong>Star Cineplex inventory</strong>
            <span>
              {inventory?.fetchedAt
                ? `Last successful update ${new Date(inventory.fetchedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka" })} · Dhaka time`
                : "Connecting to the cinema’s public feed…"}
            </span>
          </div>
        </div>
        <div className="live-source-actions">
          <span className={`freshness ${inventory?.status || "loading"}`}>
            {inventory?.status === "live"
              ? "Live"
              : inventory?.status === "stale"
                ? "Last known data"
                : inventory?.status === "error"
                  ? "Unavailable"
                  : "Loading"}
          </span>
          <button
            className="button secondary compact"
            disabled={!connected || refreshing || inventory?.refreshing}
            onClick={() => void refresh()}
          >
            <Icon name="repeat" size={14} />
            {refreshing || inventory?.refreshing
              ? "Refreshing…"
              : "Refresh now"}
          </button>
          <a
            href="https://starcineplex.com/showtimes"
            target="_blank"
            rel="noreferrer"
            className="provider-link"
            aria-label="Open official Star Cineplex schedule"
          >
            <Icon name="external" size={15} />
          </a>
        </div>
      </section>
      {(inventory?.status === "error" || inventory?.status === "stale") && (
        <div className="connection-banner" role="alert">
          <Icon name="bell" size={18} />
          <div>
            <strong>
              {inventory.status === "stale"
                ? "The latest refresh failed. These are the last successfully fetched listings."
                : "Star Cineplex inventory could not be loaded."}
            </strong>
            <p>
              {inventory.error ||
                "The last successful update is too old to treat as current."}{" "}
              Live mission shortcuts stay disabled until a fresh update
              succeeds.
            </p>
          </div>
        </div>
      )}
      <section
        className="live-metrics"
        aria-label="Star Cineplex inventory statistics"
      >
        {[
          {
            label: "Now showing",
            value: inventory?.counts.nowShowingMovies,
            icon: "film",
          },
          {
            label: "Online shows open",
            value: inventory?.counts.openShows,
            icon: "ticket",
          },
          {
            label: "Halls with open sales",
            value: inventory?.counts.hallsWithOpenTickets,
            icon: "grid",
          },
          {
            label: "Reported seats available",
            value: inventory?.counts.reportedAvailableSeats,
            icon: "activity",
          },
        ].map((item) => (
          <article key={item.label}>
            <Icon name={item.icon} size={19} />
            <div>
              <strong>
                {inventory?.fetchedAt ? item.value?.toLocaleString() : "—"}
              </strong>
              <span>{item.label}</span>
            </div>
          </article>
        ))}
      </section>
      {changes.length > 0 && (
        <section className="ticket-openings">
          <div>
            <span className="live-dot" />
            <strong>Ticket sales opened</strong>
            <small>Detected between successful refreshes</small>
          </div>
          <div className="opening-chips">
            {changes.slice(0, 4).map((change) => (
              <button
                key={change.id}
                disabled={!fresh}
                onClick={() => {
                  setQuery(change.movieTitle);
                  setDate(change.date);
                  setOnlyOpen(true);
                  setTab("shows");
                }}
              >
                <Icon name="bolt" size={13} />
                <span>
                  {change.movieTitle}
                  <small>
                    {change.hallName} · {shortDate(change.date)} · {change.time}
                    {change.type === "tickets_reopened"
                      ? " · Seats reopened"
                      : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="panel live-browser">
        <div className="live-toolbar">
          <div
            className="live-tabs"
            role="tablist"
            aria-label="Cinema inventory views"
          >
            {(
              [
                { id: "movies", label: "Movies", icon: "film" },
                { id: "shows", label: "Showtimes & tickets", icon: "ticket" },
                { id: "halls", label: "Halls", icon: "grid" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} size={15} />
                {item.label}
              </button>
            ))}
          </div>
          <div className="search-input live-search">
            <Icon name="search" size={15} />
            <input
              aria-label="Search live movies"
              placeholder="Search running movies…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="live-filters">
          <label>
            Branch
            <select
              aria-label="Live cinema branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              <option value="">All branches</option>
              {inventory?.branches.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                  {b.active ? "" : " · Inactive"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Show date
            <select
              aria-label="Live show date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            >
              <option value="">All published dates</option>
              {dates.map((day) => (
                <option value={day} key={day}>
                  {shortDate(day)}
                  {day === today ? " · Today" : ""}
                </option>
              ))}
            </select>
          </label>
          {tab === "movies" ? (
            <label>
              Movies
              <select
                aria-label="Movie release filter"
                value={movieScope}
                onChange={(e) =>
                  setMovieScope(e.target.value as typeof movieScope)
                }
              >
                <option value="now">Now showing</option>
                <option value="upcoming">Coming soon</option>
                <option value="all">All catalog movies</option>
              </select>
            </label>
          ) : tab === "shows" ? (
            <label className="live-open-only">
              <input
                type="checkbox"
                checked={onlyOpen}
                onChange={(e) => setOnlyOpen(e.target.checked)}
              />
              Online sales open only
            </label>
          ) : (
            <span className="hall-scope-note">
              Halls listed here have published future shows.
            </span>
          )}
        </div>
        {!inventory?.fetchedAt && (
          <div className="waiting-state">
            <span className="radar">
              <Icon
                name={inventory?.status === "error" ? "bell" : "repeat"}
                size={28}
              />
            </span>
            <h3>
              {inventory?.status === "error"
                ? "Waiting for the cinema feed."
                : "Loading live Star Cineplex data."}
            </h3>
            <p>
              {inventory?.status === "error"
                ? "Use Refresh now to reconnect. Failed requests are never replaced with simulated movies or ticket counts."
                : "Movies, branches, showtimes and ticket sales come directly from the public provider endpoints."}
            </p>
          </div>
        )}
        {inventory?.fetchedAt && tab === "movies" && (
          <>
            <div className="live-section-caption">
              <span>
                {movies.length}{" "}
                {movieScope === "now"
                  ? "now-showing"
                  : movieScope === "upcoming"
                    ? "upcoming"
                    : "catalog"}{" "}
                movie{movies.length === 1 ? "" : "s"}
              </span>
              <small>Catalog release flags are supplied by the cinema.</small>
            </div>
            <div className="live-movie-grid">
              {movies.map((movie) => {
                const options = scoped.filter((s) => s.movie.id === movie.id);
                const open = options.filter((s) => s.ticketStatus === "open");
                return (
                  <article className="live-movie-card" key={movie.id}>
                    <button
                      type="button"
                      className="movie-poster"
                      aria-label={`Book ${movie.title}`}
                      onClick={() => chooseMovie(movie)}
                    >
                      <Icon name="film" size={40} />
                      {movie.posterUrl?.startsWith("https://") && (
                        <img
                          src={movie.posterUrl}
                          alt={`${movie.title} poster`}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      <span>
                        {movie.isNowShowing
                          ? "NOW SHOWING"
                          : movie.isUpcoming
                            ? "COMING SOON"
                            : "CATALOG"}
                      </span>
                    </button>
                    <div className="live-movie-info">
                      <div className="movie-badges">
                        {movie.formats.slice(0, 3).map((format) => (
                          <span key={format}>{format}</span>
                        ))}
                        {movie.duration && <small>{movie.duration} min</small>}
                      </div>
                      <h2>
                        <button
                          type="button"
                          className="movie-title-button"
                          onClick={() => chooseMovie(movie)}
                        >
                          {movie.title}
                        </button>
                      </h2>
                      <p>
                        {movie.language?.toUpperCase() || "Language not listed"}
                        {movie.genres?.length
                          ? ` · ${movie.genres.slice(0, 2).join(", ")}`
                          : ""}
                      </p>
                      <div
                        className={`movie-open-summary ${open.length ? "has-open" : ""}`}
                      >
                        <i />
                        {open.length
                          ? `${open.length} show${open.length === 1 ? "" : "s"} with online sales open`
                          : options.length
                            ? "No online sales open for these filters"
                            : "No published shows for these filters"}
                      </div>
                      <div className="live-movie-actions">
                        <button
                          className="text-button"
                          onClick={() => {
                            setQuery(movie.title);
                            setOnlyOpen(false);
                            setTab("shows");
                          }}
                        >
                          See shows
                          <Icon name="chevron" size={13} />
                        </button>
                        <button
                          className="button primary compact"
                          onClick={() => chooseMovie(movie)}
                        >
                          Choose date & seats
                          <Icon
                            name={open.length ? "arrow" : "clock"}
                            size={13}
                          />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {!movies.length && (
              <div className="quiet-state">
                <Icon name="film" size={28} />
                <p>No movies match this catalog filter.</p>
                <span>Try another title or select all catalog movies.</span>
              </div>
            )}
          </>
        )}
        {inventory?.fetchedAt && tab === "shows" && (
          <>
            <div className="live-section-caption">
              <span>
                {listedShows.length} matching show
                {listedShows.length === 1 ? "" : "s"}
              </span>
              <small>
                Ticket counts are provider-reported totals, not a seat-level
                guarantee.
              </small>
            </div>
            <div className="live-show-list">
              {listedShows.map((show) => (
                <article className="live-show-row" key={show.id}>
                  <div className="live-show-time">
                    <strong>{show.time}</strong>
                    <span>{shortDate(show.date)}</span>
                  </div>
                  <div className="live-show-movie">
                    <h3>
                      {show.movie.title}
                      {newlyOpened.has(show.id) && <em>NEWLY OPENED</em>}
                    </h3>
                    <span>
                      {branchName(show)} <b>·</b> {show.hall.name} <b>·</b>{" "}
                      {show.screenType.toUpperCase()}
                    </span>
                    <small>
                      {show.onlineSalesCloseAt
                        ? `Online cutoff ${new Date(show.onlineSalesCloseAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" })} Dhaka time`
                        : "Online cutoff not reported"}
                      {!show.hallNameResolved ? " · Hall name unavailable" : ""}
                    </small>
                  </div>
                  <div className="live-seat-count">
                    <strong>
                      {show.availableKnown
                        ? show.availableSeats.toLocaleString()
                        : "—"}
                    </strong>
                    <span>reported seats</span>
                    <small>
                      {show.priceKnown
                        ? `from ৳${show.price.toLocaleString()}`
                        : "Price unavailable"}
                    </small>
                  </div>
                  <div className="show-sale-action">
                    <span
                      title={`Provider status: ${show.sourceStatus || "unknown"}; channel: ${show.salesChannel || "unknown"}`}
                      className={`sale-status sale-${show.ticketStatus}`}
                    >
                      <i />
                      {labels[show.ticketStatus]}
                    </span>
                    <button
                      className="button secondary compact"
                      disabled={!fresh || show.ticketStatus !== "open"}
                      onClick={() => seed(show.movie as LiveMovie, show, true)}
                    >
                      Find seats
                      <Icon name="arrow" size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!listedShows.length && (
              <div className="quiet-state">
                <Icon name="ticket" size={28} />
                <p>No shows match these choices.</p>
                <span>
                  {onlyOpen
                    ? "Uncheck “Online sales open only” to see published shows with other sales states."
                    : "The provider has no published shows for these filters."}
                </span>
              </div>
            )}
          </>
        )}
        {inventory?.fetchedAt && tab === "halls" && (
          <>
            <div className="live-section-caption">
              <span>
                {halls.length} hall{halls.length === 1 ? "" : "s"} with
                published shows
              </span>
              <small>
                “Open” refers to online ticket sales, not physical opening
                hours.
              </small>
            </div>
            <div className="live-hall-grid">
              {halls.map((hall) => (
                <article key={hall.key} className="live-hall-card">
                  <div>
                    <span className="hall-icon">
                      <Icon name="grid" size={22} />
                    </span>
                    <span
                      className={`sale-status ${hall.openShows ? "sale-open" : "sale-closed"}`}
                    >
                      <i />
                      {hall.openShows ? "Tickets open" : "No online sales open"}
                    </span>
                  </div>
                  <h2>{hall.name}</h2>
                  <p>{hall.branchName}</p>
                  {!hall.nameResolved && (
                    <small>
                      Public hall name unavailable; identifier shown.
                    </small>
                  )}
                  <dl>
                    <div>
                      <dt>Published shows</dt>
                      <dd>{hall.scheduledShows}</dd>
                    </div>
                    <div>
                      <dt>Online sales open</dt>
                      <dd>{hall.openShows}</dd>
                    </div>
                    <div>
                      <dt>Reported seats in open shows</dt>
                      <dd>{hall.reportedAvailableSeats.toLocaleString()}</dd>
                    </div>
                  </dl>
                  <button
                    className="text-button"
                    onClick={() => {
                      setBranch(hall.branchId);
                      setOnlyOpen(false);
                      setTab("shows");
                    }}
                  >
                    View branch shows
                    <Icon name="arrow" size={14} />
                  </button>
                </article>
              ))}
            </div>
            {!halls.length && (
              <div className="quiet-state">
                <Icon name="grid" size={28} />
                <p>No published halls match these filters.</p>
              </div>
            )}
          </>
        )}
        <footer className="live-data-note">
          <Icon name="shield" size={14} />
          <span>
            Auto-refreshes every {inventory?.refreshIntervalSeconds || 30}s. The
            bot rechecks current listings during a live mission and verifies
            actual seats in the cinema browser.
          </span>
        </footer>
      </section>
      {!!inventory?.warnings.length && (
        <details className="live-warnings">
          <summary>
            {inventory.warnings.length} hall-name lookup notice
            {inventory.warnings.length === 1 ? "" : "s"}
          </summary>
          {inventory.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </details>
      )}
    </div>
  );
}
