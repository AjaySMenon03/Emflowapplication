/**
 * Quecumber — Main Server Assembler
 *
 * This file imports all route modules and assembles the Hono application.
 * All business logic is now in modular files under routes/, queue/, whatsapp/, and lib/.
 */
import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";

// ── Route Modules ──
import * as healthRoutes from "./routes/health.ts";
import * as authRoutes from "./routes/auth.ts";
import * as onboardingRoutes from "./routes/onboarding.ts";
import * as businessRoutes from "./routes/business.ts";
import * as publicRoutes from "./routes/public.ts";
import * as queueRoutes from "./routes/queue.ts";
import * as realtimeRoutes from "./routes/realtime.ts";
import * as analyticsRoutes from "./routes/analytics.ts";
import * as settingsRoutes from "./routes/settings.ts";
import * as kioskRoutes from "./routes/kiosk.ts";
import * as customersRoutes from "./routes/customers.ts";
import * as customerPortalRoutes from "./routes/customer-portal.ts";
import * as emergencyRoutes from "./routes/emergency.ts";
import * as cronAuditRoutes from "./routes/cron-audit.ts";

// ── Sub-App for Routes ──
const app = new Hono();
const baseApp = new Hono();

// ── Register All Route Modules ──
healthRoutes.register(baseApp);
authRoutes.register(baseApp);
onboardingRoutes.register(baseApp);
businessRoutes.register(baseApp);
publicRoutes.register(baseApp);
queueRoutes.register(baseApp);
realtimeRoutes.register(baseApp);
analyticsRoutes.register(baseApp);
settingsRoutes.register(baseApp);
kioskRoutes.register(baseApp);
customersRoutes.register(baseApp);
customerPortalRoutes.register(baseApp);
emergencyRoutes.register(baseApp);
cronAuditRoutes.register(baseApp);

// ── Middleware ──
app.use("*", logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "apikey"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Mount routes on both root and slug paths for robustness
app.route("/make-server-5252bcc1", baseApp);
app.route("/", baseApp);

// Catch-all for debugging
app.all("*", (c: any) => {
  console.log(
    `[404] No route matched: ${c.req.method} ${c.req.url} (path: ${c.req.path})`,
  );
  return c.json(
    { error: "Not Found", path: c.req.path, method: c.req.method },
    404,
  );
});

// ══════════════════════════════════════════════
Deno.serve(app.fetch);
