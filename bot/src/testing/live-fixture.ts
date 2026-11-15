import { STAR_ORG_ID, type InventoryFetcher } from "../live-inventory";

export function inventoryFixture(date = "2026-11-17") {
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
  const requests: string[] = [];
  const fetcher: InventoryFetcher = async (url, signal) => {
    signal.throwIfAborted();
    requests.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith("/movies")) return structuredClone(movies);
    if (path.endsWith("/venues")) return structuredClone(venues);
    if (path.endsWith("/shows")) return structuredClone(shows);
    if (path.endsWith("/seat-maps/map-one"))
      return { hallId: "hall-one", name: "Hall 1 Seat Map", sections: [] };
    if (path.endsWith("/seat-maps/map-two"))
      return { hallId: "hall-two", name: "VIP Hall Seat Map", sections: [] };
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
  return { movies, venues, shows, requests, fetcher };
}
