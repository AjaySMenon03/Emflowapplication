/**
 * EM Flow — Express Server Entry Point
 *
 * MVC backend for the EM Flow queue management application.
 * Loads environment variables, sets up CORS, JSON parsing,
 * and mounts all route modules under /api prefix.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";

// Route imports
import authRoutes from "./routes/auth.routes.js";
import onboardingRoutes from "./routes/onboarding.routes.js";
import businessRoutes from "./routes/business.routes.js";
import queueRoutes from "./routes/queue.routes.js";
import publicRoutes from "./routes/public.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import realtimeRoutes from "./routes/realtime.routes.js";

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──
app.use(cors({
    origin: "*",
    allowedHeaders: ["Content-Type", "Authorization", "apikey"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposedHeaders: ["Content-Length"],
    maxAge: 600,
}));
app.use(express.json());

// ── Request Logger ──
app.use((req, res, next) => {
    // console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ── Health Check ──
app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
});

// ── Routes ──
app.use("/api/auth", authRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/business", businessRoutes);
app.use("/api/queue", queueRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/realtime", realtimeRoutes);

// ── 404 fallback ──
app.use("/api", (req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── Start server ──
app.listen(PORT, () => {
    console.log(`EM Flow server running on http://localhost:${PORT}`);
    // console.log(`   Health check: http://localhost:${PORT}/api/health\n`);
});
