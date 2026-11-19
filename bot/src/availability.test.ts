import { expect, it } from "vitest";
import { LiveInventoryService } from "./live-inventory";
import { inventoryFixture } from "./testing/live-fixture";
import {
  movieDateAvailability,
  movieCatalogState,
  explainMovieAvailability,
} from "./availability";

async function fixtureData() {
  const fixture = inventoryFixture("2099-12-01");
  const inventory = new LiveInventoryService(fixture.fetcher, {
    now: () => Date.parse("2099-11-30T06:00:00Z"),
  });
  await inventory.refresh();
  return { fixture, inventory, data: inventory.snapshot() };
}
it("reports availability for the exact movie, date, locations and seats", async () => {
  const { data } = await fixtureData();
  const summary = (date: string, locations: string[], seats: number) =>
    movieDateAvailability(
      data.shows,
      data.branches,
      "movie-running",
      date,
      locations,
      seats,
    );
  expect(summary("2099-12-01", ["bashundhara"], 2)).toMatchObject({
    state: "available",
    reportedSeats: 8,
  });
  expect(summary("2099-12-01", ["bashundhara"], 9).state).toBe("insufficient");
  expect(summary("2099-12-01", ["sony-square"], 2).state).toBe("closed");
  expect(summary("2099-12-02", [], 2)).toMatchObject({
    state: "unpublished",
    openingAt: undefined,
  });
  const sold = data.shows.filter((show) => show.id === "show-sold");
  expect(
    movieDateAvailability(
      sold,
      data.branches,
      "movie-running",
      "2099-12-01",
      [],
      2,
    ).state,
  ).toBe("sold_out");
});
it("never treats release/start/cutoff times as ticket-opening announcements", async () => {
  const { data } = await fixtureData();
  expect(
    movieDateAvailability(
      data.shows,
      data.branches,
      "movie-upcoming",
      "2099-12-01",
      [],
      2,
    ),
  ).toMatchObject({ state: "not_open", openingAt: undefined });
  const unpublished = movieDateAvailability(
    data.shows,
    data.branches,
    "movie-upcoming",
    "2099-12-03",
    [],
    2,
  );
  expect(unpublished.state).toBe("unpublished");
  expect(unpublished.openingAt).toBeUndefined();
});
it("preserves explicit published openings and prevents early Selling shows from booking", async () => {
  const { fixture, inventory } = await fixtureData();
  Object.assign(
    fixture.shows.find((show) => show.id === "show-later")!,
    { status: "Selling", onlineSalesOpenAt: "2099-12-01T09:00:00+06:00" },
  );
  await inventory.refresh();
  const data = inventory.snapshot();
  expect(data.shows.find((show) => show.id === "show-later")).toMatchObject({
    ticketStatus: "not_open",
    onlineSalesOpenAt: "2099-12-01T03:00:00.000Z",
  });
  expect(
    movieDateAvailability(
      data.shows,
      data.branches,
      "movie-upcoming",
      "2099-12-01",
      [],
      2,
    ),
  ).toMatchObject({
    state: "not_open",
    openingAt: "2099-12-01T03:00:00.000Z",
    bookableShows: [],
  });
  Object.assign(
    fixture.shows.find((show) => show.id === "show-later")!,
    { onlineSalesOpenAt: "2099-12-01 09:00" },
  );
  await inventory.refresh();
  expect(
    inventory.snapshot().shows.find((show) => show.id === "show-later")
      ?.onlineSalesOpenAt,
  ).toBeUndefined();
});

it("does not promote a catalog now-showing flag into a published screening", async () => {
  const { fixture, inventory } = await fixtureData();
  const raw = {
    ...fixture.movies[0],
    id: "unlisted-movie",
    title: { en: "Unannounced Film" },
  };
  Object.assign(raw, { localReleaseDate: "2099-12-18" });
  fixture.movies.push(raw);
  await inventory.refresh();
  const data = inventory.snapshot();
  const movie = data.movies.find((item) => item.id === "unlisted-movie")!;
  expect(movie.isNowShowing).toBe(true);
  expect(movieCatalogState(movie, data.shows, "2099-11-30")).toBe("upcoming");
  expect(data.counts.nowShowingMovies).toBe(1);
  expect(
    explainMovieAvailability(data.movies, data.shows, data.branches, {
      targetMovieId: movie.id,
      movieName: movie.title,
      targetDate: "2099-12-01",
      requiredSeats: 2,
      locationIds: ["bashundhara"],
      preferredTimes: [],
    }),
  ).toMatchObject({
    title: "Waiting for show announcements",
    message: expect.stringContaining("There is no seat page to open yet"),
  });
});
it("explains date, location and time blockers separately", async () => {
  const { data } = await fixtureData();
  const input = {
    targetMovieId: "movie-running",
    movieName: "Running Film",
    targetDate: "2099-12-01",
    requiredSeats: 2,
    locationIds: [] as string[],
    preferredTimes: [] as import("./contracts").TaskInput["preferredTimes"],
  };
  const explain = (patch: Partial<typeof input>) =>
    explainMovieAvailability(data.movies, data.shows, data.branches, {
      ...input,
      ...patch,
    });
  expect(explain({ targetDate: "2099-12-03" }).title).toBe(
    "Selected date is not published",
  );
  expect(explain({ locationIds: ["missing-branch"] }).title).toBe(
    "No shows at the selected locations",
  );
  expect(explain({ preferredTimes: ["morning"] }).title).toBe(
    "Showtime preferences exclude every show",
  );
});
it("classifies movies with open online shows as showing even if catalog isUpcoming stays true", async () => {
  const { fixture, inventory } = await fixtureData();
  const upcomingShow = fixture.shows.find((show) => show.id === "show-later")!;
  // Scheduled (not open) stays upcoming
  expect(
    movieCatalogState(
      inventory.snapshot().movies.find((m) => m.id === "movie-upcoming")!,
      inventory.snapshot().shows,
      "2099-11-30",
    ),
  ).toBe("upcoming");
  // Once online sales open, it must appear under Now showing
  upcomingShow.status = "Selling";
  await inventory.refresh();
  const data = inventory.snapshot();
  expect(
    movieCatalogState(
      data.movies.find((m) => m.id === "movie-upcoming")!,
      data.shows,
      "2099-11-30",
    ),
  ).toBe("showing");
  expect(data.counts.nowShowingMovies).toBe(2);
});
