/**
 * Quecumber — Health Route
 */
import type { Hono } from "npm:hono";

export function register(app: Hono) {
  app.get("/health", (c: any) => {
    return c.json({ status: "ok" });
  });
}
