import type http from "http";
import path from "path";
import {
  attachLyncServer as attachVendoredLyncServer,
  type AttachLyncServerOptions,
} from "../vendor/lync/packages/sync-server/src/index";
import { hasSiteAccess } from "./siteAuth";

let attached = false;
let relay: ReturnType<typeof attachVendoredLyncServer> | null = null;
const DEFAULT_LYNC_KEEPALIVE_INTERVAL_MS = 30_000;
type LyncAuthMode = "site-access" | "public";

function parsePositiveInt(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveLyncAuthMode(value = process.env.LYNC_AUTH_MODE): LyncAuthMode {
  return value?.trim().toLowerCase() === "public" ? "public" : "site-access";
}

export function attachLyncServer(server: http.Server) {
  if (attached) return relay;
  attached = true;
  const authMode = resolveLyncAuthMode();
  const options: AttachLyncServerOptions = {
    path: "/lync",
    storageDir:
      process.env.LYNC_STORAGE_DIR ??
      path.resolve(process.cwd(), ".data/lync"),
    keepAliveInterval:
      parsePositiveInt(process.env.LYNC_KEEPALIVE_INTERVAL_MS) ??
      DEFAULT_LYNC_KEEPALIVE_INTERVAL_MS,
    maxConnections: parsePositiveInt(process.env.LYNC_MAX_CONNECTIONS),
    authenticate: authMode === "public" ? undefined : hasSiteAccess,
  };
  relay = attachVendoredLyncServer(server, options);
  console.log(`[Lync] relay auth mode: ${authMode}`);

  server.on("upgrade", (request) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/lync") {
        console.log("[Lync] websocket upgrade requested");
      }
    } catch {
      // Ignore malformed upgrade URLs; the relay handles rejection.
    }
  });

  relay.server.on("connection", (socket) => {
    const openConnections = relay?.server.clients.size ?? 0;
    console.log(`[Lync] websocket connected; open=${openConnections}`);
    socket.on("close", (code, reason) => {
      const remainingConnections = relay?.server.clients.size ?? 0;
      const reasonText = reason?.toString();
      console.log(
        `[Lync] websocket closed code=${code} reason=${reasonText} open=${remainingConnections}`,
      );
    });
    socket.on("error", (error) => {
      console.warn("[Lync] websocket error", error);
    });
  });

  return relay;
}

export async function closeLyncServer() {
  if (!relay) return;
  await relay.close();
  relay = null;
  attached = false;
}
