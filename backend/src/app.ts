import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { config } from "./config/index.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { kobRouter } from "./routes/kob.routes.js";
import { evaluationRouter } from "./routes/evaluation.routes.js";
import { qaRouter } from "./routes/qa.routes.js";
import { webinarRouter } from "./routes/webinar.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { metaRouter } from "./routes/meta.routes.js";
import { publicRouter } from "./routes/public.routes.js";
import { authRouter } from "./routes/auth.routes.js";

export const app = express();

// 1. CORS Middleware
app.use(cors(config.cors));

// 2. Body Parser Middleware
app.use(express.json({ limit: "10mb" }));

// 2b. JSON parser syntax error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && "body" in err && (err as any).status === 400) {
    if (req.path.endsWith("/lead-stage") || req.path.endsWith("/template-stage")) {
      res.status(400).json({ success: false, message: "Invalid JSON body" });
      return;
    }
    if (req.path.endsWith("/failed-fire")) {
      res.status(400).json({ success: false, error: "Invalid JSON body" });
      return;
    }
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  next(err);
});

// 3. Public Health Check Endpoint (strictly minimal, no DB, no auth)
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// 4. Temporary Protected Auth Test Endpoint (Step D verification only)
app.get("/auth-test", requireAuth, (req: Request, res: Response) => {
  res.status(200).json({
    authenticated: true,
    userId: req.userId,
  });
});

// 5. Business Routes
app.use("/api/kob", kobRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/evaluation", evaluationRouter);
// STAGE 10I-F: QA mutation routes (lifecycle/cleanup/move-stage/etc.) must be
// unavailable in production/staging — they're guarded by requireAuth only,
// with no role check, and qaCleanup deletes rows. Development-only.
if (config.nodeEnv === "development") {
  app.use("/api/qa", qaRouter);
}
app.use("/api/webinar", webinarRouter);
app.use("/api/admin", adminRouter);
app.use("/api/meta", metaRouter);
app.use("/api/public", publicRouter);
app.use("/api/auth", authRouter);

// 6. 404 Route Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not Found" });
});

// 7. Global Error Handling Middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Backend Error]:", err.message);
  res.status(500).json({
    error: "Internal Server Error",
    message: config.nodeEnv === "development" ? err.message : undefined,
  });
});
