import { createServer } from "vite";
import { resolve } from "node:path";
process.env.BOT_EMBEDDED = "1";
const vite = await createServer({
  configFile: resolve("dashboard/vite.config.ts"),
  server: { middlewareMode: true },
  appType: "spa",
});
try {
  const { startBot } = await vite.ssrLoadModule("/../bot/src/index.ts");
  const bot = await startBot({
    devHandler: (req, res) =>
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end("Not found");
      }),
  });
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      if (closing) return;
      closing = true;
      await bot.close();
      await vite.close();
      process.exit(0);
    });
} catch (error) {
  console.error(error);
  await vite.close();
  process.exitCode = 1;
}
