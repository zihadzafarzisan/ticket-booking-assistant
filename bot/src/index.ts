import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TaskStore } from "./store";
import { BotRunner } from "./runner";
import { DiscoveryService } from "./discovery";
import { BrowserDriver } from "./browser";
import { createBotServer, type ServerOptions } from "./server";
import { LiveInventoryService } from "./live-inventory";
import { LiveStarCineplexAdapter } from "./live-adapter";
import { BrowserConnection } from "./browser-connection";
import { CredentialStore } from "./credentials";

export async function startBot(
  options: ServerOptions & { port?: number; dataDirectory?: string } = {},
) {
  const port = options.port ?? Number(process.env.BOT_PORT || 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid BOT_PORT.");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const data = resolve(
    options.dataDirectory ||
      process.env.BOT_DATA_DIR ||
      resolve(root, ".bot-data"),
  );
  const inventory = options.inventory || new LiveInventoryService();
  const credentials =
    options.credentials ||
    new CredentialStore(resolve(data, "credentials.json"));
  const browserConnection =
    options.browserConnection || new BrowserConnection(data);
  try {
    await credentials.init();
  } catch (error) {
    console.warn(
      `Warning: ${(error as Error).message} Starting without saved credentials.`,
    );
  }
  try {
    await browserConnection.init();
  } catch (error) {
    console.warn(
      `Warning: Could not read saved browser settings (${(error as Error).message}). Using default endpoint.`,
    );
  }
  const runner = new BotRunner(
    new TaskStore(resolve(data, "tasks.json")),
    new DiscoveryService(new LiveStarCineplexAdapter(inventory)),
    new BrowserDriver(
      resolve(data, "browser-profile"),
      process.env.BOT_HEADLESS === "1",
      { connection: browserConnection, credentials },
    ),
  );
  await runner.init();
  const { server, closeEvents } = createBotServer(runner, {
    staticDirectory: resolve(root, "dashboard/dist"),
    ...options,
    inventory,
    credentials,
    browserConnection,
  });
  try {
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => done());
    });
  } catch (error) {
    await inventory.stop();
    await runner.shutdown();
    throw error;
  }
  inventory.start();
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  console.log(
    `\n  Movie Ticket Bot\n  Dashboard: http://127.0.0.1:${actualPort}\n  Jobs continue while this process is running.\n`,
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    closeEvents();
    await inventory.stop();
    await new Promise<void>((done) => server.close(() => done()));
    await runner.shutdown();
  };
  return { server, runner, inventory, close, port: actualPort };
}

if (process.env.BOT_EMBEDDED !== "1") {
  startBot()
    .then(({ close }) => {
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
          void close().then(() => process.exit(0));
        });
    })
    .catch((error) => {
      console.error(`Could not start bot: ${error.message}`);
      process.exitCode = 1;
    });
}
