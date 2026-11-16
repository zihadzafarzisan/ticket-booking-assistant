import { STAR_CINEPLEX_LOCATIONS } from "../../packages/core/src";
import type { ScreenType } from "../../packages/core/src";
import type {
  InventoryChange,
  LiveBranch,
  LiveHall,
  LiveInventory,
  LiveMovie,
  LiveShow,
  TicketStatus,
} from "./live-types";

export const STAR_ORG_ID = "0ab00001-0000-0000-0000-000000000001";
export const STAR_PUBLIC_ENDPOINTS = {
  movies: "https://api.kichole.com/catalog/api/movies",
  venues: `https://api.kichole.com/catalog/api/venues?orgId=${STAR_ORG_ID}`,
  shows: `https://api.kichole.com/inventory/api/shows?orgId=${STAR_ORG_ID}`,
};
export type InventoryFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<unknown>;
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const localized = (value: unknown) =>
  typeof value === "string"
    ? value
    : text(object(value).en) || text(object(value).bn);
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
const seatCount = (value: unknown) => {
  const count = number(value);
  return count !== undefined && Number.isInteger(count) ? count : undefined;
};
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
function records(value: unknown, label: string): RecordValue[] {
  if (!Array.isArray(value) || value.some((x) => !text(object(x).id)))
    throw new Error(`Unexpected ${label} response from Star Cineplex.`);
  return value.map(object);
}
const format = (raw: unknown): ScreenType => {
  const value = text(raw).toLowerCase();
  if (value.includes("imax")) return "imax";
  if (value.includes("atmos")) return "dolby_atmos";
  if (value.includes("4dx")) return "4dx";
  if (value.includes("3d")) return "3d";
  if (value.includes("2d")) return "2d";
  if (value.includes("premium")) return "premium";
  return "standard";
};
function startTime(date: string, time: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)
  )
    return undefined;
  const calendar = new Date(`${date}T00:00:00Z`);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== date ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return undefined;
  const dateTime = new Date(
    `${date}T${time.length === 5 ? time + ":00" : time}+06:00`,
  );
  return Number.isFinite(dateTime.getTime())
    ? dateTime.toISOString()
    : undefined;
}

export function ticketStatus(
  show: Pick<
    LiveShow,
    | "sourceStatus"
    | "salesChannel"
    | "startsAt"
    | "onlineSalesCloseAt"
    | "onlineSalesOpenAt"
    | "availableKnown"
    | "availableSeats"
    | "branchActive"
  >,
  now = Date.now(),
): TicketStatus {
  if (!show.startsAt || !Number.isFinite(Date.parse(show.startsAt)))
    return "unknown";
  if (Date.parse(show.startsAt) <= now) return "started";
  if (!show.branchActive) return "closed";
  const status = show.sourceStatus.toLowerCase().replace(/[^a-z]/g, "");
  if (status === "soldout") return "sold_out";
  if (["closed", "cancelled", "canceled", "archived"].includes(status))
    return "closed";
  if (status !== "selling") return status ? "not_open" : "unknown";
  if (show.onlineSalesOpenAt && Date.parse(show.onlineSalesOpenAt) > now)
    return "not_open";
  const channel = show.salesChannel.toLowerCase().replace(/[^a-z]/g, "");
  if (channel === "counter" || channel === "counteronly") return "counter_only";
  if (!["both", "online", "onlineonly"].includes(channel)) return "unknown";
  if (
    !show.onlineSalesCloseAt ||
    !Number.isFinite(Date.parse(show.onlineSalesCloseAt))
  )
    return "unknown";
  if (Date.parse(show.onlineSalesCloseAt) <= now) return "closed";
  if (!show.availableKnown) return "unknown";
  return show.availableSeats > 0 ? "open" : "sold_out";
}

async function publicFetch(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(
      `Star Cineplex ${new URL(url).pathname.split("/").at(-1)} request failed (HTTP ${response.status}).`,
    );
  return response.json();
}

export class LiveInventoryService {
  private data?: LiveInventory;
  private lastAttemptAt?: string;
  private lastError?: string;
  private inFlight?: Promise<LiveInventory>;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private listeners = new Set<() => void>();
  private hallNames = new Map<string, { name: string; expires: number }>();
  private stopped = false;
  private now: () => number;
  readonly intervalSeconds: number;
  constructor(
    private fetcher: InventoryFetcher = publicFetch,
    options: { now?: () => number; intervalSeconds?: number } = {},
  ) {
    this.now = options.now || Date.now;
    this.intervalSeconds = options.intervalSeconds ?? 30;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    void this.refresh().catch(() => {});
    this.timer = setInterval(() => {
      void this.refresh().catch(() => {});
    }, this.intervalSeconds * 1000);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.inFlight?.catch(() => {});
  }
  snapshot(): LiveInventory {
    const now = this.now();
    const base: LiveInventory = this.data
      ? structuredClone(this.data)
      : {
          status: this.lastError ? "error" : "loading",
          refreshing: !!this.inFlight,
          refreshIntervalSeconds: this.intervalSeconds,
          sourceUrl: "https://starcineplex.com/showtimes",
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
        };
    base.lastAttemptAt = this.lastAttemptAt;
    base.refreshing = !!this.inFlight;
    base.error = this.lastError;
    base.nextRefreshAt = new Date(
      (this.lastAttemptAt ? Date.parse(this.lastAttemptAt) : now) +
        this.intervalSeconds * 1000,
    ).toISOString();
    if (this.data) {
      base.status =
        this.lastError ||
        now - Date.parse(this.data.fetchedAt!) > this.intervalSeconds * 2000
          ? "stale"
          : "live";
    }
    base.shows = base.shows.map((show) => ({
      ...show,
      ticketStatus: ticketStatus(show, now),
    }));
    base.halls = aggregateHalls(base.shows, now);
    base.counts = {
      nowShowingMovies: base.movies.filter((m) => m.isNowShowing).length,
      openShows: base.shows.filter((s) => s.ticketStatus === "open").length,
      hallsWithOpenTickets: base.halls.filter((h) => h.openShows > 0).length,
      reportedAvailableSeats: base.shows
        .filter((s) => s.ticketStatus === "open")
        .reduce((sum, show) => sum + show.availableSeats, 0),
    };
    return base;
  }
  async fresh(maxAgeMs = 1000): Promise<LiveInventory> {
    if (
      this.data &&
      !this.lastError &&
      this.now() - Date.parse(this.data.fetchedAt!) < maxAgeMs
    )
      return this.snapshot();
    await this.refresh();
    return this.snapshot();
  }
  refresh(): Promise<LiveInventory> {
    if (this.inFlight) return this.inFlight;
    if (this.stopped)
      return Promise.reject(new Error("Live inventory service is stopped."));
    this.lastAttemptAt = new Date(this.now()).toISOString();
    this.controller = new AbortController();
    this.inFlight = this.load(this.controller.signal)
      .then((next) => {
        if (this.stopped)
          throw new Error("Live inventory refresh was cancelled.");
        const previous = new Map(
          this.data?.shows.map((show) => [show.id, show]),
        );
        const changes: InventoryChange[] = [];
        if (this.data)
          for (const show of next.shows) {
            const old = previous.get(show.id);
            if (
              show.ticketStatus === "open" &&
              (!old || old.ticketStatus !== "open")
            )
              changes.push({
                id: `${show.id}:${next.fetchedAt}`,
                showId: show.id,
                movieTitle: show.movie.title,
                branchName: show.cinema.name,
                hallName: show.hall.name,
                date: show.date,
                time: show.time,
                type:
                  old?.ticketStatus === "sold_out"
                    ? "tickets_reopened"
                    : "sales_opened",
                detectedAt: next.fetchedAt!,
              });
          }
        next.changes = [...changes, ...(this.data?.changes || [])]
          .filter(
            (change) =>
              this.now() - Date.parse(change.detectedAt) < 24 * 3600_000,
          )
          .slice(0, 60);
        this.data = next;
        this.lastError = undefined;
        return this.snapshot();
      })
      .catch((error) => {
        if (!this.stopped) this.lastError = (error as Error).message;
        throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
        this.emit();
      });
    this.emit();
    return this.inFlight;
  }
  private async load(signal: AbortSignal): Promise<LiveInventory> {
    const [moviePayload, venuePayload, showPayload] = await Promise.all(
      Object.values(STAR_PUBLIC_ENDPOINTS).map((url) =>
        this.fetcher(url, signal),
      ),
    );
    signal.throwIfAborted();
    const rawMovies = records(moviePayload, "movie catalog");
    const rawVenues = records(venuePayload, "branches");
    const rawShows = records(showPayload, "shows").filter(
      (show) => show.ownerOrgId === STAR_ORG_ID,
    );
    const movieIds = new Set(rawShows.map((show) => text(show.movieId)));
    const movies: LiveMovie[] = rawMovies
      .filter(
        (movie) =>
          movie.organizerOrgId === STAR_ORG_ID ||
          (!movie.organizerOrgId && movieIds.has(text(movie.id))),
      )
      .map((movie) => ({
        id: text(movie.id),
        title: localized(movie.title) || text(movie.slug) || "Untitled movie",
        posterUrl: text(movie.posterUrl),
        synopsis: localized(movie.synopsis),
        duration: number(movie.duration),
        releaseDate: text(movie.localReleaseDate) || text(movie.releaseDate),
        language: text(movie.language),
        genres: strings(movie.genres),
        rating: text(movie.certificate),
        isNowShowing: movie.isNowShowing === true,
        isUpcoming: movie.isUpcoming === true,
        formats: strings(movie.formats),
      }));
    const movieMap = new Map(movies.map((movie) => [movie.id, movie]));
    const branches: LiveBranch[] = rawVenues
      .filter((venue) => venue.ownerOrgId === STAR_ORG_ID)
      .map((venue) => ({
        id: text(venue.id),
        locationId:
          STAR_CINEPLEX_LOCATIONS.find((loc) => loc.venueId === venue.id)?.id ||
          text(venue.id),
        name: localized(venue.name) || `Branch ${text(venue.id).slice(0, 8)}`,
        city: text(venue.cityName),
        address: localized(venue.address),
        active: venue.isActive === true,
      }));
    const branchMap = new Map(branches.map((branch) => [branch.id, branch]));
    const validShows = rawShows.filter(
      (show) =>
        movieMap.has(text(show.movieId)) && branchMap.has(text(show.venueId)),
    );
    if (
      validShows.some(
        (show) => !text(show.hallId) || !text(show.date) || !text(show.time),
      )
    )
      throw new Error("Unexpected show schedule fields from Star Cineplex.");
    const warnings: string[] = [];
    const now = this.now();
    const maps = new Map<string, string>();
    for (const show of validShows)
      if (text(show.seatMapId) && text(show.hallId))
        maps.set(text(show.hallId), text(show.seatMapId));
    const names = new Map<string, string>();
    const metadataSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    const queue = [...maps];
    for (let offset = 0; offset < queue.length; offset += 4)
      await Promise.all(
        queue.slice(offset, offset + 4).map(async ([hallId, mapId]) => {
          const cached = this.hallNames.get(mapId);
          if (cached && cached.expires > now) {
            names.set(hallId, cached.name);
            return;
          }
          try {
            metadataSignal.throwIfAborted();
            const map = object(
              await this.fetcher(
                `https://api.kichole.com/inventory/api/seat-maps/${encodeURIComponent(mapId)}`,
                metadataSignal,
              ),
            );
            if (map.hallId !== hallId || !text(map.name))
              throw new Error("Hall metadata unavailable");
            const name = text(map.name)
              .replace(/\s+seat\s*map\s*$/i, "")
              .trim();
            if (!name) throw new Error("Hall metadata unavailable");
            names.set(hallId, name);
            this.hallNames.set(mapId, { name, expires: now + 24 * 3600_000 });
          } catch (error) {
            signal.throwIfAborted();
            warnings.push(
              `Hall ${hallId.slice(0, 8)}: public name unavailable; showing its identifier.`,
            );
          }
        }),
      );
    signal.throwIfAborted();
    const shows: LiveShow[] = validShows
      .map((raw) => {
        const movie = movieMap.get(text(raw.movieId))!;
        const branch = branchMap.get(text(raw.venueId))!;
        const startsAt = startTime(text(raw.date), text(raw.time));
        const cutoff =
          number(raw.effectiveOnlineSalesCutoffMinutes) ??
          number(raw.onlineSalesCutoffMinutes);
        const prices = Array.isArray(raw.pricing)
          ? raw.pricing
              .map((item) => number(object(item).price))
              .filter((price): price is number => price !== undefined)
          : [];
        const price =
          number(object(raw.priceRange).minPaisa) ??
          (prices.length ? Math.min(...prices) : undefined);
        const available = seatCount(raw.availableSeats);
        const total = seatCount(raw.totalSeats) ?? 0;
        const screenType = format(raw.format);
        const show: LiveShow = {
          id: text(raw.id),
          movie,
          cinema: {
            id: "star-cineplex",
            name: `Star Cineplex (${branch.name})`,
            location: branch.city,
            address: branch.address,
            website: "https://starcineplex.com",
          },
          hall: {
            id: text(raw.hallId),
            name:
              names.get(text(raw.hallId)) ||
              `Hall ${text(raw.hallId).slice(0, 8)}`,
            screenType,
            capacity: total,
          },
          date: text(raw.date),
          time: text(raw.time),
          screenType,
          price: price === undefined ? 0 : price / 100,
          currency: "BDT",
          availableSeats: available ?? 0,
          totalSeats: total,
          seatMapId: text(raw.seatMapId),
          venueId: branch.id,
          bookingUrl: `https://kichole.com/shows/${encodeURIComponent(text(raw.id))}/seats?tenant=star-cineplex`,
          sourceStatus: text(raw.status),
          salesChannel:
            text(raw.effectiveSalesChannel) || text(raw.salesChannel),
          startsAt,
          // Use only explicit sales-opening metadata; never infer from show/release dates.
          onlineSalesOpenAt:
            typeof raw.onlineSalesOpenAt === "string" &&
            /(?:Z|[+-]\d{2}:\d{2})$/.test(raw.onlineSalesOpenAt) &&
            Number.isFinite(Date.parse(raw.onlineSalesOpenAt))
              ? new Date(raw.onlineSalesOpenAt).toISOString()
              : undefined,
          onlineSalesCloseAt:
            startsAt && cutoff !== undefined
              ? new Date(Date.parse(startsAt) - cutoff * 60_000).toISOString()
              : undefined,
          availableKnown: available !== undefined,
          priceKnown: price !== undefined,
          hallNameResolved: names.has(text(raw.hallId)),
          branchActive: branch.active,
          ticketStatus: "unknown",
        };
        show.ticketStatus = ticketStatus(show, now);
        return show;
      })
      .sort((a, b) =>
        `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
      );
    return {
      status: "live",
      refreshing: false,
      fetchedAt: new Date(this.now()).toISOString(),
      refreshIntervalSeconds: this.intervalSeconds,
      sourceUrl: "https://starcineplex.com/showtimes",
      warnings,
      movies,
      branches,
      shows,
      halls: aggregateHalls(shows, now),
      changes: [],
      counts: {
        nowShowingMovies: 0,
        openShows: 0,
        hallsWithOpenTickets: 0,
        reportedAvailableSeats: 0,
      },
    };
  }
}

function aggregateHalls(shows: LiveShow[], now: number): LiveHall[] {
  const halls = new Map<string, LiveHall>();
  for (const show of shows) {
    if (!show.startsAt || Date.parse(show.startsAt) <= now) continue;
    const key = `${show.venueId}:${show.hall.id}`;
    const hall = halls.get(key) || {
      key,
      id: show.hall.id,
      name: show.hall.name,
      nameResolved: show.hallNameResolved,
      branchId: show.venueId!,
      branchName: show.cinema.name,
      scheduledShows: 0,
      openShows: 0,
      reportedAvailableSeats: 0,
    };
    hall.scheduledShows++;
    if (show.ticketStatus === "open") {
      hall.openShows++;
      hall.reportedAvailableSeats += show.availableSeats;
    }
    halls.set(key, hall);
  }
  return [...halls.values()].sort(
    (a, b) =>
      a.branchName.localeCompare(b.branchName) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}
