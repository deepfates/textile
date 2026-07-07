import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express, { type Response } from "express";
import http from "http";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import wasm from "vite-plugin-wasm";

// app specific imports
import args from "server/args";
import { setup_routes } from "server/apis/http";
import { getMainProps } from "server/main_props";
import { attachLyncServer, closeLyncServer } from "server/lync";
import { configureTrustedProxies } from "server/trustedProxy";
import { requireSiteAccess, setupSiteAuthRoutes } from "server/siteAuth";

const port: number = args.port;
const mode: "development" | "production" = args.mode;
const ssr_enabled: boolean = args.ssr;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const index_html_path_dev = path.resolve(__dirname, "../client/index.html");
const index_html_path_prod = path.resolve(
  __dirname,
  "../dist/client/client/index.html",
);
const ssr_path_dev = path.resolve(__dirname, "../server/ssr.tsx");
const ssr_path_prod = path.resolve(__dirname, "../dist/server/ssr.js");
const client_dir_prod = path.resolve(__dirname, "../dist/client");
const client_assets_dir = path.resolve(__dirname, "../client/assets");
let shutdownHandlersInstalled = false;

function firstExistingPath(paths: string[]) {
  return paths.find((candidate) => fs.existsSync(candidate));
}

function sendManifest(res: Response) {
  const manifestPath = firstExistingPath([
    path.resolve(client_dir_prod, "assets/manifest.webmanifest"),
    path.resolve(client_dir_prod, "manifest.webmanifest"),
    path.resolve(client_dir_prod, "client/manifest.webmanifest"),
    path.resolve(__dirname, "../client/manifest.webmanifest"),
  ]);

  res.setHeader("Content-Type", "application/manifest+json");
  if (manifestPath) {
    res.sendFile(manifestPath);
  } else {
    res.status(404).send("Manifest not found");
  }
}

export async function createServer() {
  if (mode === "production") {
    if (!fs.existsSync(index_html_path_prod) || !fs.existsSync(ssr_path_prod)) {
      console.error(
        "Production build not found. Please run `bun run build` first.",
      );
      process.exit(1);
    }
  }
  const app = express();
  configureTrustedProxies(app);
  setupSiteAuthRoutes(app);
  app.use((req, res, next) => {
    // Lync sync uses raw WebSocket upgrades on the http_server.
    // Only skip auth for actual upgrade requests on the exact path.
    if (req.path === "/lync" && req.headers.upgrade === "websocket") return next();
    return requireSiteAccess(req, res, next);
  });

  const http_server = http.createServer(app);
  attachLyncServer(http_server);
  setup_routes(app);

  let vite;
  if (mode === "development") {
    vite = await createViteServer({
      configFile: false, // Don't load config file - use inline config only
      root: path.resolve(__dirname, "../"),
      appType: "custom",
      plugins: [wasm(), react()],
      css: {
        postcss: {
          plugins: [tailwindcss()],
        },
      },
      optimizeDeps: {
        include: ["eventemitter3"],
        exclude: ["@automerge/automerge"],
      },
      server: {
        middlewareMode: true,
        hmr: {
          server: http_server,
          clientPort: 443,
          protocol: "wss",
        },
        allowedHosts: [".replit.dev"], // Allow Replit's dynamic domains
      },
      clearScreen: false,
    });
  } else if (mode === "production") {
    const staticHeaders = (
      res: Response,
      filePath: string,
      _stat?: fs.Stats,
    ) => {
      if (filePath.endsWith("sw.js") || filePath.endsWith("registerSW.js")) {
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Service-Worker-Allowed", "/");
        res.setHeader("Cache-Control", "no-cache");
        return;
      }

      if (filePath.endsWith(".webmanifest")) {
        res.setHeader("Content-Type", "application/manifest+json");
        res.setHeader("Cache-Control", "no-cache");
        return;
      }

      // Allow hashed build assets to be cached aggressively by browsers/CDNs
      const fileName = path.basename(filePath);
      if (/\.[a-f0-9]{8}\./.test(fileName)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    };

    app.use(express.static(client_dir_prod, { setHeaders: staticHeaders }));

    // Preserve the previous /client mount for any legacy asset references
    app.use(
      "/client",
      express.static(client_dir_prod, { setHeaders: staticHeaders }),
    );
    app.use(
      "/client/assets",
      express.static(client_assets_dir, { setHeaders: staticHeaders }),
    );
  }

  // Add Vite middleware BEFORE catch-all routes in development
  if (mode === "development") {
    app.use(vite.middlewares);
  }

  // vite exposes all files at root by default, this is to prevent accessing server files
  app.use(async (req, res, next) => {
    const url = req.originalUrl;
    let cleaned_url = url.split("?")[0];
    // remove leading slashes
    cleaned_url = cleaned_url.replace(/^\/+/, "");

    const allowed_prefixes = [
      "client",
      "shared",
      "node_modules",
      "@vite",
      "@react-refresh",
      "@fs",
    ];
    if (
      cleaned_url == "" ||
      allowed_prefixes.some((prefix) => cleaned_url.startsWith(prefix))
    ) {
      return next();
    } else {
      // check if file with exact path exists
      const file_path = path.join(__dirname, cleaned_url);
      const exists = fs.existsSync(file_path);
      if (exists) {
        res.status(404).send("Not found");
      } else {
        next();
      }
    }
  });

  // Serve PWA files at root level before the app shell catch-all.
  app.get("/sw.js", (req, res) => {
    if (mode === "production") {
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Service-Worker-Allowed", "/");
      res.setHeader("Cache-Control", "no-cache");
      const swPath = path.resolve(client_dir_prod, "sw.js");
      if (fs.existsSync(swPath)) {
        res.sendFile(swPath);
      } else {
        const viteSwPath = path.resolve(client_dir_prod, "registerSW.js");
        if (fs.existsSync(viteSwPath)) {
          res.sendFile(viteSwPath);
        } else {
          res.status(404).send("Service worker not found");
        }
      }
    } else {
      res
        .status(404)
        .send("Service worker is served by Vite in development mode");
    }
  });

  app.get("/manifest.webmanifest", (req, res) => {
    sendManifest(res);
  });

  app.get("/client/manifest.webmanifest", (req, res) => {
    sendManifest(res);
  });

  app.get("*", async (req, res, next) => {
    const url = req.originalUrl;

    const skip_prefixes = [
      "/client",
      "/shared",
      "/node_modules",
      "/@vite",
      "/@react-refresh",
      "/@",
    ];

    if (skip_prefixes.some((prefix) => url.startsWith(prefix))) {
      return next();
    }

    const initial_state = await getMainProps(req);

    try {
      let template = fs.readFileSync(
        path.resolve(
          __dirname,
          mode === "production" ? index_html_path_prod : index_html_path_dev,
        ),
        "utf-8",
      );

      if (mode === "development") {
        template = await vite.transformIndexHtml(url, template);
      }

      let html = "";

      if (ssr_enabled && mode === "development") {
        const { render } = await vite.ssrLoadModule("/server/ssr.tsx");

        const ssr_parts = await render(url, initial_state);
        const { body, head } = ssr_parts;

        html = template
          .replace(`<!--ssr-outlet-->`, body)
          .replace(`<!--ssr-head-->`, head)
          .replace(`<!--ssr-state-->`, JSON.stringify(initial_state));
      } else if (ssr_enabled && mode === "production") {
        const mod = await import(ssr_path_prod);
        const { render } = mod as {
          render: (
            url: string,
            initial: unknown,
          ) => Promise<{ body: string; head: string }>;
        };
        const ssr_parts = await render(url, initial_state);
        const { body, head } = ssr_parts;

        html = template
          .replace(`<!--ssr-outlet-->`, body)
          .replace(`<!--ssr-head-->`, head)
          .replace(`<!--ssr-state-->`, JSON.stringify(initial_state));
      } else {
        html = template
          .replace(`<!--ssr-outlet-->`, "")
          .replace(`<!--ssr-head-->`, "")
          .replace(`<!--ssr-state-->`, "{}");
      }

      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      if (mode === "development") {
        vite.ssrFixStacktrace(e);
      }
      next(e);
    }
  });

  http_server.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });

  installShutdownHandlers(http_server);

  return app;
}

function installShutdownHandlers(httpServer: http.Server) {
  if (shutdownHandlersInstalled) return;
  shutdownHandlersInstalled = true;

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] received ${signal}; closing HTTP and Lync sockets`);

    const forceExit = setTimeout(() => {
      console.error("[Server] graceful shutdown timed out");
      process.exit(1);
    }, 25_000);
    forceExit.unref();

    try {
      await closeLyncServer();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      console.error("[Server] graceful shutdown failed", error);
      clearTimeout(forceExit);
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
