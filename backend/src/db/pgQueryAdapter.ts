import { getPool } from "./pool.js";

/**
 * STAGE 10I-B: a minimal, intentionally narrow stand-in for the Supabase-js
 * query builder, covering ONLY the exact chain vocabulary used by the
 * shared pure cohort/bucket functions in dashboard.controller.ts
 * (computeAutoBuckets, computeCombinedBuckets, computeManualBuckets,
 * combinedFirstEntries, combinedSplitClassify, autoCohortResponses).
 *
 * This lets those functions run UNCHANGED against RDS — the same business
 * logic, just handed a different "supabase-shaped" client. It is NOT a
 * general Supabase replacement: no embeds/joins, no count/head mode, no
 * .maybeSingle(), no RPC. Anything outside this vocabulary must use the
 * repository layer directly instead of this adapter.
 *
 * Column values are normalized on read: any JS Date (node-pg's default
 * mapping for timestamp/timestamptz) is converted via .toISOString() so
 * downstream ISO-string comparisons (e.g. inSpan()) behave identically to
 * the Supabase/PostgREST JSON encoding they were written against.
 */

type Row = Record<string, unknown>;

class PgQueryBuilder implements PromiseLike<{ data: Row[]; error: null }> {
  private conditions: string[] = [];
  private params: unknown[] = [];
  private orderBy: string[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;

  constructor(private table: string, private cols: string) {}

  private nextParam(val: unknown): string {
    this.params.push(val);
    return `$${this.params.length}`;
  }

  select(cols: string): this {
    this.cols = cols;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.conditions.push(`${col} = ${this.nextParam(val)}`);
    return this;
  }

  gte(col: string, val: unknown): this {
    this.conditions.push(`${col} >= ${this.nextParam(val)}`);
    return this;
  }

  lte(col: string, val: unknown): this {
    this.conditions.push(`${col} <= ${this.nextParam(val)}`);
    return this;
  }

  in(col: string, vals: unknown[]): this {
    if (!vals || vals.length === 0) {
      this.conditions.push("1=0");
      return this;
    }
    // Cast both sides to text: pg always sends a JS string array with a
    // concrete `text[]` OID (no "unknown"-type inference like scalar params
    // get), so comparing it directly against a uuid/enum column would throw
    // "operator does not exist". Casting both sides to text sidesteps that
    // regardless of the column's real type.
    this.conditions.push(`(${col})::text = ANY(${this.nextParam(vals.map(String))}::text[])`);
    return this;
  }

  is(col: string, val: null): this {
    if (val !== null) throw new Error("pgQueryAdapter.is() only supports null");
    this.conditions.push(`${col} IS NULL`);
    return this;
  }

  not(col: string, op: "is", val: null): this {
    if (op !== "is" || val !== null) throw new Error("pgQueryAdapter.not() only supports (col, 'is', null)");
    this.conditions.push(`${col} IS NOT NULL`);
    return this;
  }

  filter(col: string, op: "is" | "not.is", val: null): this {
    if (val !== null) throw new Error("pgQueryAdapter.filter() only supports null checks");
    this.conditions.push(op === "is" ? `${col} IS NULL` : `${col} IS NOT NULL`);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push(`${col} ${opts?.ascending === false ? "DESC" : "ASC"}`);
    return this;
  }

  range(from: number, to: number): this {
    this.limitN = to - from + 1;
    this.offsetN = from;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  /** Mimics Supabase's `.maybeSingle()`: terminates the chain, returns the first row or null. */
  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    this.limitN = 1;
    const { data } = await this.exec();
    return { data: data[0] ?? null, error: null };
  }

  private buildSql(): { sql: string; params: unknown[] } {
    const cols = this.cols
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .join(", ");
    let sql = `SELECT ${cols} FROM public.${this.table}`;
    if (this.conditions.length) sql += ` WHERE ${this.conditions.join(" AND ")}`;
    if (this.orderBy.length) sql += ` ORDER BY ${this.orderBy.join(", ")}`;
    if (this.limitN !== null) sql += ` LIMIT ${this.limitN}`;
    if (this.offsetN !== null) sql += ` OFFSET ${this.offsetN}`;
    return { sql, params: this.params };
  }

  private async exec(): Promise<{ data: Row[]; error: null }> {
    const { sql, params } = this.buildSql();
    const { rows } = await getPool().query(sql, params);
    const normalized = rows.map((row) => {
      const out: Row = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v instanceof Date ? v.toISOString() : v;
      }
      return out;
    });
    return { data: normalized, error: null };
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

/** Mimics the Supabase client's `.from(table)` entry point, backed by RDS. */
export function pgFrom(table: string): PgQueryBuilder {
  return new PgQueryBuilder(table, "*");
}

/** Mimics the shape of a Supabase client enough for .from(...)-chain-only pure functions. */
export const pgClient = { from: pgFrom };
