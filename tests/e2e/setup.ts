import { resolve } from "node:path";
import { LiveInventoryService } from "../../bot/src/live-inventory";
import { inventoryFixture } from "../../bot/src/testing/live-fixture";
export default async function setup() {
  process.env.BOT_EMBEDDED = "1";
  process.env.BOT_HEADLESS = "1";
  const { startBot } = await import("../../bot/dist/index.js");
  const tomorrow = new Date(Date.now() + 30 * 3600_000)
    .toISOString()
    .slice(0, 10);
  const fixture = inventoryFixture(tomorrow);
  const unannounced = {
    ...fixture.movies[0],
    id: "movie-unannounced",
    title: { en: "Unannounced Film" },
    isNowShowing: true,
    isUpcoming: false,
  };
  Object.assign(unannounced, { localReleaseDate: "2099-12-18" });
  fixture.movies.push(unannounced);
  const inventory = new LiveInventoryService(fixture.fetcher);
  await inventory.refresh();
  const bot = await startBot({
    port: 4318,
    dataDirectory: resolve(`.bot-test-data/e2e-${Date.now()}`),
    inventory,
  });
  return async () => {
    await bot.close();
  };
}
