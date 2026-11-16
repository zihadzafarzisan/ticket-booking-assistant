import { access, mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { LiveInventoryService } from "../../bot/src/live-inventory";
import { inventoryFixture } from "../../bot/src/testing/live-fixture";

export default async function setup() {
  try {
    await access(resolve("bot/dist/index.js"));
    await access(resolve("dashboard/dist/index.html"));
  } catch {
    throw new Error(
      "Production build missing. Run npm.cmd run test:smoke without --skip-build.",
    );
  }
  process.env.BOT_EMBEDDED = "1";
  process.env.BOT_HEADLESS = "1";
  const { startBot } = await import("../../bot/dist/index.js");
  const root = resolve(".bot-test-data");
  await mkdir(root, { recursive: true });
  const dataDirectory = await mkdtemp(resolve(root, "smoke-"));
  const live = process.env.CINEBOT_SMOKE_LIVE === "1";
  const tomorrow = new Date(Date.now() + 30 * 3600_000)
    .toISOString()
    .slice(0, 10);
  const inventory = live
    ? undefined
    : new LiveInventoryService(inventoryFixture(tomorrow).fetcher);
  const bot = await startBot({
    port: 0,
    dataDirectory,
    ...(inventory ? { inventory } : {}),
  });
  try {
    const data = await bot.inventory.fresh(0);
    if (data.status !== "live")
      throw new Error(data.error || `Inventory status is ${data.status}.`);
    process.env.CINEBOT_SMOKE_URL = `http://127.0.0.1:${bot.port}`;
  } catch (error) {
    await bot.close();
    throw new Error(
      `Smoke startup failed (${live ? "real provider" : "fixture"}): ${(error as Error).message}`,
    );
  }
  return async () => {
    await bot.close();
  };
}
