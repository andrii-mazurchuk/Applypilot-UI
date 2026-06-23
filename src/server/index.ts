import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import api from "./routes.js";
import { loadManifest } from "./manifest.js";
import { restoreFromDisk, shutdownAll } from "./processes.js";

// Prevent unhandled rejections (e.g. broken SSE streams) from crashing the server
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});

// Graceful shutdown — give pipeline processes 10s to finish cleanly before forcing exit.
// This handles `systemctl stop`, `kill <pid>`, and Ctrl+C equally.
async function onShutdown(signal: string) {
  console.log(`[server] Received ${signal}, shutting down gracefully...`);
  await shutdownAll(10_000);
  process.exit(0);
}

process.on("SIGTERM", () => { onShutdown("SIGTERM"); });
process.on("SIGINT",  () => { onShutdown("SIGINT"); });

// Restore any processes that survived a previous server crash
try {
  restoreFromDisk(loadManifest());
} catch (err) {
  console.error("[server] Failed to restore process state:", err);
}

const app = new Hono();

app.use("*", cors());
app.route("/api", api);

// Serve built frontend in production
app.use("*", serveStatic({ root: "./dist/public" }));
app.get("*", serveStatic({ path: "./dist/public/index.html" }));

const PORT = parseInt(process.env.PORT ?? "3847");
console.log(`ApplyPilot UI running at http://localhost:${PORT}`);

serve({ fetch: app.fetch, port: PORT });
