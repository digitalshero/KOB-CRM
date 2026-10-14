import { readFileSync } from "node:fs";
import { Pool, type PoolConfig } from "pg";

/**
 * Direct PostgreSQL/RDS connection pool.
 *
 * STAGE 10B — ADDITIVE ONLY. Nothing in the application calls getPool() yet.
 * No existing endpoint uses this module.
 *
 * Connection values come ONLY from environment variables (never DATABASE_URL,
 * never hardcoded). The pool is created lazily on first use, not on import,
 * so simply importing this module never opens a connection or requires the
 * env vars to be set.
 */

let _pool: Pool | undefined;

function readSslCa(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err: any) {
    // Intentionally reports only the path and the error code, never any
    // other filesystem detail, and never logs env var values.
    throw new Error(`DATABASE_SSL_CA_PATH is set to "${path}" but the file could not be read: ${err?.code ?? err?.message ?? "unknown error"}`);
  }
}

function buildPoolConfig(): PoolConfig {
  const required = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    // Names only — never values — so this is safe to log/throw.
    throw new Error(`Missing required DB environment variable(s): ${missing.join(", ")}`);
  }

  const caPath = process.env.DATABASE_SSL_CA_PATH;
  // SSL is always verified; there is no insecure fallback. If the CA file
  // cannot be read, pool creation fails loudly instead of silently
  // connecting without certificate verification.
  const ssl = {
    ca: caPath ? readSslCa(caPath) : undefined,
    rejectUnauthorized: true,
  };

  return {
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT!, 10),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl,
    // Small pool sized for the current single EC2 instance workload.
    // Revisit once real concurrency on the RDS path is measured.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Applied per-connection by pg on session start (SET statement_timeout).
    statement_timeout: 15_000,
    application_name: "kob-api",
  };
}

/**
 * Returns the singleton pg.Pool, creating it on first call. Do not call this
 * at module load time — only from code paths that are actually executing a
 * direct-RDS query (none exist yet in Stage 10B).
 */
export function getPool(): Pool {
  if (!_pool) {
    const cfg = buildPoolConfig();
    _pool = new Pool(cfg);
    _pool.on("error", (err) => {
      // pg emits this for idle clients that hit a backend-side error (e.g.
      // connection dropped). pg error messages never contain credentials,
      // but keep this the single place in the module that logs one.
      console.error("[db/pool] idle client error:", err.message);
    });
  }
  return _pool;
}

/** True once the pool has been created (does not create it). */
export function isPoolInitialized(): boolean {
  return _pool !== undefined;
}

/** Closes the pool. Intended for graceful shutdown and test teardown. */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}
