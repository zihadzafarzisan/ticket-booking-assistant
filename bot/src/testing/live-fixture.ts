import type { BrowserContext } from "playwright";
import { STAR_ORG_ID, type InventoryFetcher } from "../live-inventory";

export interface InventoryFixtureOptions {
  /** Automatically open `dropShowId` (default "show-later") on this 1-based /shows fetch count */
  dropAfterRefreshes?: number;
  /** Show ID to transition from Scheduled/not_open -> Selling/open (default "show-later") */
  dropShowId?: string;
  /** Seat count once dropped (default 10) */
  dropAvailableSeats?: number;
  /** 1-based /shows fetch indices that throw a transient network/HTTP error */
  failOnRefreshes?: number[];
  /** Custom error message for transient failures */
  failureMessage?: string;
}

export function inventoryFixture(
  date = "2026-11-17",
  options: InventoryFixtureOptions = {},
) {
  const movies = [
    {
      id: "movie-running",
      title: { en: "Running Film" },
      isNowShowing: true,
      isUpcoming: false,
      organizerOrgId: STAR_ORG_ID,
      formats: ["2D", "3D"],
      duration: 140,
      language: "en",
      genres: ["Drama"],
    },
    {
      id: "movie-upcoming",
      title: { en: "Upcoming Film" },
      isNowShowing: false,
      isUpcoming: true,
      organizerOrgId: STAR_ORG_ID,
      formats: ["2D"],
      duration: 120,
      language: "bn",
    },
    {
      id: "movie-other",
      title: { en: "Other cinema film" },
      isNowShowing: true,
      organizerOrgId: "other-org",
    },
  ];
  const venues = [
    {
      id: "8be12859-1385-45b6-89da-46ab8154ea3d",
      ownerOrgId: STAR_ORG_ID,
      name: { en: "Bashundhara City" },
      cityName: "Dhaka",
      address: { en: "Panthapath" },
      isActive: true,
    },
    {
      id: "07ce0273-2b9f-4563-a02c-bb160284cb3b",
      ownerOrgId: STAR_ORG_ID,
      name: { en: "Sony Square" },
      cityName: "Dhaka",
      address: { en: "Mirpur" },
      isActive: true,
    },
  ];
  const base = {
    ownerOrgId: STAR_ORG_ID,
    movieId: "movie-running",
    venueId: venues[0].id,
    hallId: "hall-one",
    seatMapId: "map-one",
    date,
    time: "14:00",
    status: "Selling",
    effectiveSalesChannel: "Both",
    effectiveOnlineSalesCutoffMinutes: 60,
    totalSeats: 20,
    availableSeats: 8,
    format: "2D",
    pricing: [{ category: "premium", price: 50000 }],
    priceRange: { minPaisa: 50000, maxPaisa: 50000 },
  };
  const shows = [
    { id: "show-open", ...base },
    { id: "show-sold", ...base, time: "18:00", availableSeats: 0 },
    {
      id: "show-closed",
      ...base,
      venueId: venues[1].id,
      hallId: "hall-two",
      seatMapId: "map-two",
      time: "19:00",
      status: "Closed",
      availableSeats: 7,
    },
    {
      id: "show-later",
      ...base,
      movieId: "movie-upcoming",
      venueId: venues[1].id,
      hallId: "hall-two",
      seatMapId: "map-two",
      time: "20:00",
      status: "Scheduled",
      availableSeats: 10,
    },
    {
      id: "show-counter",
      ...base,
      venueId: venues[1].id,
      hallId: "hall-two",
      seatMapId: "map-two",
      time: "21:00",
      effectiveSalesChannel: "CounterOnly",
      availableSeats: 4,
    },
  ];

  const dropShowId = options.dropShowId || "show-later";
  const dropAvailableSeats = options.dropAvailableSeats ?? 10;
  const failIndices = new Set(options.failOnRefreshes || []);
  const requests: string[] = [];
  let showsFetches = 0;
  let queuedFailures = 0;
  let queuedFailureMessage =
    options.failureMessage || "Star Cineplex shows request failed (HTTP 503).";

  const triggerDrop = (showId = dropShowId, availableSeats = dropAvailableSeats) => {
    const show = shows.find((item) => item.id === showId);
    if (!show) return;
    show.status = "Selling";
    show.effectiveSalesChannel = "Both";
    show.availableSeats = availableSeats;
    const movie = movies.find((item) => item.id === show.movieId);
    if (movie) {
      movie.isNowShowing = true;
      movie.isUpcoming = false;
    }
  };

  const setTransientFailures = (
    count: number,
    message = "Star Cineplex shows request failed (HTTP 503).",
  ) => {
    queuedFailures = Math.max(0, Math.floor(count));
    queuedFailureMessage = message;
  };

  const isDropped = (showId = dropShowId) =>
    shows.find((item) => item.id === showId)?.status === "Selling";

  const fetcher: InventoryFetcher = async (url, signal) => {
    signal.throwIfAborted();
    requests.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith("/movies")) return structuredClone(movies);
    if (path.endsWith("/venues")) return structuredClone(venues);
    if (path.endsWith("/shows")) {
      showsFetches++;
      if (queuedFailures > 0) {
        queuedFailures--;
        throw new Error(queuedFailureMessage);
      }
      if (failIndices.has(showsFetches)) {
        throw new Error(queuedFailureMessage);
      }
      if (
        options.dropAfterRefreshes !== undefined &&
        showsFetches >= options.dropAfterRefreshes
      ) {
        triggerDrop();
      }
      return structuredClone(shows);
    }
    if (path.endsWith("/seat-maps/map-one"))
      return { hallId: "hall-one", name: "Hall 1 Seat Map", sections: [] };
    if (path.endsWith("/seat-maps/map-two"))
      return { hallId: "hall-two", name: "VIP Hall Seat Map", sections: [] };
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
  return {
    movies,
    venues,
    shows,
    requests,
    fetcher,
    showsRefreshCount: () => showsFetches,
    triggerDrop,
    setTransientFailures,
    isDropped,
  };
}

export interface CineplexPageFixtureOptions {
  showId?: string;
  initiallyOpen?: boolean;
  /** Automatically open seat map on this 1-based page load/reload count */
  dropAfterLoads?: number;
  rows?: string[];
  seatsPerRow?: number;
  occupiedSeats?: string[];
  /** Seat labels that become occupied mid-click when clicked (triggers atomic rollback tests) */
  stealSeatsOnClick?: string[];
  /** Simulate React full-list DOM re-render on every seat click */
  rerenderOnClick?: boolean;
  /** Fire a blocking window.alert() on page load to verify dialog resilience */
  triggerDialogOnLoad?: boolean;
  /** 1-based seat page load indices that return HTTP 503 */
  failOnLoads?: number[];
  /** Optional hosted payment gateway URL reached from checkout */
  paymentGatewayUrl?: string;
}

export function createCineplexPageFixture(
  options: CineplexPageFixtureOptions = {},
) {
  const showId = options.showId || "show-later";
  const rows = options.rows || ["D", "E", "F"];
  const seatsPerRow = options.seatsPerRow ?? 10;
  const occupied = new Set(
    (options.occupiedSeats || []).map((s) => s.trim().toUpperCase()),
  );
  const stealOnClick = new Set(
    (options.stealSeatsOnClick || []).map((s) => s.trim().toUpperCase()),
  );
  const failOnLoads = new Set(options.failOnLoads || []);
  const bookingUrl = `https://kichole.com/shows/${encodeURIComponent(showId)}/seats?tenant=star-cineplex`;
  const checkoutUrl = "https://kichole.com/checkout";

  const state = {
    loads: 0,
    open: options.initiallyOpen ?? options.dropAfterLoads === undefined,
    checkoutVisits: 0,
    lastCheckoutSeats: [] as string[],
    stolenEvents: [] as string[],
  };

  const renderNotOpenHtml = () => `<!doctype html>
<html>
  <body>
    <main>
      <h1>Upcoming Show</h1>
      <p data-testid="show-not-open">Tickets are not open yet. Please check back shortly.</p>
    </main>
    ${options.triggerDialogOnLoad ? `<script>window.alert("Tickets have not opened yet");</script>` : ""}
  </body>
</html>`;

  const renderSeatMapHtml = () => {
    const config = JSON.stringify({
      rows,
      seatsPerRow,
      occupied: [...occupied],
      stealOnClick: [...stealOnClick],
      rerenderOnClick: options.rerenderOnClick === true,
    });
    return `<!doctype html>
<html>
  <body>
    <main>
      <h1>Star Cineplex Seat Map</h1>
      <div id="alerts" aria-live="assertive"></div>
      <div id="seat-map"></div>
      <button id="proceed" disabled onclick="proceedToCheckout()">Proceed to checkout</button>
    </main>
    <script>
      const cfg = ${config};
      const occupied = new Set(cfg.occupied);
      const stealOnClick = new Set(cfg.stealOnClick);
      const selected = new Set();
      function showAlert(msg) {
        const container = document.getElementById("alerts");
        container.innerHTML = '<div role="alert">' + msg + '</div>';
      }
      function updateCheckoutButton() {
        const btn = document.getElementById("proceed");
        btn.disabled = selected.size === 0;
      }
      function proceedToCheckout() {
        const seats = Array.from(selected).join(",");
        location.href = "/checkout?seats=" + encodeURIComponent(seats);
      }
      function render() {
        const map = document.getElementById("seat-map");
        map.innerHTML = "";
        for (const row of cfg.rows) {
          const rowEl = document.createElement("div");
          rowEl.style.cssText = "display:flex;gap:6px;margin-bottom:6px";
          for (let n = 1; n <= cfg.seatsPerRow; n++) {
            const label = row + n;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.setAttribute("role", "gridcell");
            btn.setAttribute("data-seat-label", label);
            btn.setAttribute("data-seat", label);
            btn.setAttribute("data-category", "premium");
            btn.setAttribute("aria-label", "Row " + row + " seat " + label + (occupied.has(label) ? ", occupied" : selected.has(label) ? ", selected" : ", available"));
            btn.style.cssText = "width:32px;height:32px";
            btn.textContent = label;
            if (occupied.has(label)) {
              btn.disabled = true;
              btn.setAttribute("aria-disabled", "true");
              btn.setAttribute("data-status", "occupied");
              btn.setAttribute("data-seat-state", "occupied");
              btn.setAttribute("aria-selected", "false");
            } else {
              btn.setAttribute("data-status", "available");
              btn.setAttribute("data-seat-state", selected.has(label) ? "selected" : "available");
              btn.setAttribute("aria-selected", selected.has(label) ? "true" : "false");
              if (selected.has(label)) btn.classList.add("selected");
            }
            btn.onclick = () => {
              if (occupied.has(label)) return;
              if (stealOnClick.has(label)) {
                stealOnClick.delete(label);
                occupied.add(label);
                selected.delete(label);
                showAlert("Seat " + label + " is already booked and no longer available.");
                render();
                updateCheckoutButton();
                return;
              }
              if (selected.has(label)) {
                selected.delete(label);
              } else {
                selected.add(label);
              }
              if (cfg.rerenderOnClick) {
                render();
              } else {
                const isSel = selected.has(label);
                btn.setAttribute("aria-selected", isSel ? "true" : "false");
                btn.setAttribute("data-seat-state", isSel ? "selected" : "available");
                btn.setAttribute("aria-label", "Row " + row + " seat " + label + (isSel ? ", selected" : ", available"));
                btn.classList.toggle("selected", isSel);
              }
              updateCheckoutButton();
            };
            rowEl.appendChild(btn);
          }
          map.appendChild(rowEl);
        }
        updateCheckoutButton();
      }
      render();
      ${options.triggerDialogOnLoad ? 'window.alert("Seats are now open!");' : ""}
    </script>
  </body>
</html>`;
  };

  const renderCheckoutHtml = (seats: string[]) => `<!doctype html>
<html>
  <body>
    <main>
      <h1>Checkout &amp; Payment</h1>
      <p data-testid="checkout-seats">Selected seats: ${seats.join(", ")}</p>
      ${
        options.paymentGatewayUrl
          ? `<button id="gateway" onclick="location.href='${options.paymentGatewayUrl}'">Continue to payment</button>`
          : `<button id="pay-now" onclick="window.paymentSubmitted=true">Pay now</button>`
      }
    </main>
  </body>
</html>`;

  const attach = async (context: BrowserContext) => {
    await context.route("https://kichole.com/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/checkout")) {
        state.checkoutVisits++;
        const seats = (url.searchParams.get("seats") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        state.lastCheckoutSeats = seats;
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: renderCheckoutHtml(seats),
        });
        return;
      }
      state.loads++;
      if (failOnLoads.has(state.loads)) {
        await route.fulfill({
          status: 503,
          contentType: "text/html",
          body: "<h1>503 Service Temporarily Unavailable</h1>",
        });
        return;
      }
      if (
        options.dropAfterLoads !== undefined &&
        state.loads >= options.dropAfterLoads
      ) {
        state.open = true;
      }
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: state.open ? renderSeatMapHtml() : renderNotOpenHtml(),
      });
    });

    if (options.paymentGatewayUrl) {
      const gatewayOrigin = new URL(options.paymentGatewayUrl).origin;
      await context.route(`${gatewayOrigin}/**`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: '<h1>Hosted Payment Gateway</h1><input autocomplete="cc-number"><button onclick="window.paymentSubmitted=true">Pay now</button>',
        });
      });
    }
  };

  return {
    showId,
    bookingUrl,
    checkoutUrl,
    state,
    triggerDrop: () => {
      state.open = true;
    },
    stealSeat: (label: string) => {
      stealOnClick.add(label.trim().toUpperCase());
    },
    markOccupied: (label: string) => {
      occupied.add(label.trim().toUpperCase());
    },
    renderNotOpenHtml,
    renderSeatMapHtml,
    renderCheckoutHtml,
    attach,
  };
}
