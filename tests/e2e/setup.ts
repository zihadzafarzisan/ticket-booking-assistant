import { resolve } from "node:path";
export default async function setup() {
  process.env.BOT_EMBEDDED = "1";
  process.env.BOT_HEADLESS = "1";
  const { startBot } = await import("../../bot/dist/index.js");
  const bot = await startBot({
    port: 4318,
    dataDirectory: resolve(`.bot-test-data/e2e-${Date.now()}`),
  });
  return async () => {
    await bot.close();
  };
}
