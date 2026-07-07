import compression from "compression";
import cookieParser from "cookie-parser";
import nocache from "nocache";
import express, { Application } from "express";
import { getMainProps } from "server/main_props";
import { generateText } from "./generation";
import { judgeContinuation } from "./judge";
import {
  getModels,
  createModel,
  updateModel,
  deleteModel,
} from "../modelsStore";
import { attachLyncLoreRoutes } from "../lyncLore";
import { createRateLimitMiddleware, requireApiAuth, apiCors } from "./security";
import { validateModelPayload } from "./validators";

const generateRateLimit = createRateLimitMiddleware("generate");
const judgeRateLimit = createRateLimitMiddleware("judge");
const modelMutationRateLimit = createRateLimitMiddleware("models");

export function setup_routes(app: Application) {
  // Scope API middleware to /api to avoid affecting static/SSR caching
  app.use("/api", apiCors);
  app.use("/api", express.json());
  app.use("/api", cookieParser());
  app.use("/api", nocache());
  app.use("/api", compression());
  attachLyncLoreRoutes(app);

  app.get("/api/props", async (req, res) => {
    const top_level_state = await getMainProps(req);
    res.json(top_level_state);
  });

  // Text generation endpoints
  app.post("/api/generate", requireApiAuth, generateRateLimit, generateText);
  app.post("/api/judge", requireApiAuth, judgeRateLimit, judgeContinuation);

  // Get available models
  app.get("/api/models", (req, res) => {
    res.json(getModels());
  });

  app.post(
    "/api/models",
    requireApiAuth,
    modelMutationRateLimit,
    (req, res) => {
      const parsed = validateModelPayload(req.body, { requireId: true });
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const { id, config } = parsed.value;

      try {
        const updated = createModel(id!, config);
        return res.status(201).json(updated);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create model";
        return res.status(400).json({ error: message });
      }
    },
  );

  app.put(
    "/api/models/:id",
    requireApiAuth,
    modelMutationRateLimit,
    (req, res) => {
      const targetId = req.params.id;
      if (!targetId) {
        return res.status(400).json({ error: "Model ID is required" });
      }
      const parsed = validateModelPayload(req.body, { requireId: false });
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const { config } = parsed.value;

      try {
        const updated = updateModel(targetId, config);
        return res.json(updated);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update model";
        return res.status(400).json({ error: message });
      }
    },
  );

  app.delete(
    "/api/models/:id",
    requireApiAuth,
    modelMutationRateLimit,
    (req, res) => {
      const targetId = req.params.id;
      if (!targetId) {
        return res.status(400).json({ error: "Model ID is required" });
      }
      try {
        const updated = deleteModel(targetId);
        return res.json(updated);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to delete model";
        return res.status(400).json({ error: message });
      }
    },
  );
}
