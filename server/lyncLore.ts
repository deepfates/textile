import fs from "node:fs/promises";
import path from "node:path";
import type { Application } from "express";

interface LoreFilePayload {
  file: string;
  text: string;
}

export function resolveLyncLoreDir(value = process.env.LYNC_LORE_DIR): string {
  return value ?? path.resolve(process.cwd(), ".data/lync-lore");
}

export function attachLyncLoreRoutes(app: Application) {
  app.get("/api/lync/lore", async (_req, res) => {
    const dir = resolveLyncLoreDir();
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return res.json({ dir, files: [] satisfies LoreFilePayload[] });
      }
      throw error;
    }

    const loreFiles = names.filter((name) => name.endsWith(".lore")).sort();
    const files = await Promise.all(
      loreFiles.map(async (file) => ({
        file,
        text: await fs.readFile(path.join(dir, file), "utf8"),
      })),
    );
    return res.json({ dir, files });
  });
}
