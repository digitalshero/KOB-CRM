import "dotenv/config";

const envOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = [
  ...envOrigins,
  "https://kob.shero.website",
  "http://kob.shero.website",
  "http://localhost:8088",
  "http://127.0.0.1:8088",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// STAGE 10B — ADDITIVE ONLY. Not read by any route or controller yet.
// Governs which data backend an endpoint uses once endpoints start
// migrating (Stage 10C+). Must default to "supabase" so this stage changes
// no existing behavior; nothing currently checks this value.
export type DataBackend = "supabase" | "rds";
function resolveDataBackend(): DataBackend {
  return process.env.DATA_BACKEND === "rds" ? "rds" : "supabase";
}

// ADDITIVE ONLY — parallel RDS/JWT auth migration. Must default to
// "supabase" so production behavior is byte-for-byte unchanged unless this
// is explicitly set. "hybrid" lets a username that has an app_users row
// authenticate via RDS/JWT while every other username keeps using the
// existing Supabase Auth path (requireAuth tries Supabase first always;
// only falls back to verifying our own JWT when this is not "supabase").
// "rds" is for later, once hybrid has been fully validated.
export type AuthBackend = "supabase" | "hybrid" | "rds";
function resolveAuthBackend(): AuthBackend {
  const v = process.env.AUTH_BACKEND;
  return v === "hybrid" ? "hybrid" : v === "rds" ? "rds" : "supabase";
}

// STAGE 10I-F — ADDITIVE ONLY, same as dataBackend above. No Gallabox/email
// worker exists yet in this codebase (confirmed in the 10I-A dependency
// audit), so nothing reads this today. It exists so the staging env file can
// declare the flag now, explicitly defaulting to disabled, ahead of any
// future outbound-worker implementation.
function resolveOutboundEnabled(): boolean {
  return process.env.OUTBOUND_ENABLED === "true";
}

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  dataBackend: resolveDataBackend(),
  authBackend: resolveAuthBackend(),
  jwtSecret: process.env.JWT_SECRET,
  outboundEnabled: resolveOutboundEnabled(),
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/+$/, "");
      if (allowedOrigins.some((allowed) => allowed.replace(/\/+$/, "") === normalized)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy violation: Origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "X-Requested-With"],
  },
};
