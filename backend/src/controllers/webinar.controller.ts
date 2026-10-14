import { type Request, type Response, type NextFunction } from "express";
import { supabaseAdmin } from "../integrations/supabase/client.js";
import { logAudit } from "../utils/audit.js";

/**
 * Controller for listWebinarBatches.
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 8).
 * Queries:
 * - webinar_batches.select("id, name, scheduled_at, language, notes, created_at")
 *   with optional created_at range filtering and scheduled_at descending order.
 * - webinar_attendance.select("batch_id, attended") for returned batch IDs.
 * Computes attendee counts { total, attended } per batch.
 * Uses request-scoped client: req.supabase
 */
export async function listWebinarBatches(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : undefined;

    let q = (req.supabase as any)
      .from("webinar_batches")
      .select("id, name, scheduled_at, language, notes, created_at")
      .order("scheduled_at", { ascending: false });

    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);

    const { data: batches, error } = await q;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const ids = (batches ?? []).map((b: any) => b.id);
    let counts: Record<string, { total: number; attended: number }> = {};
    if (ids.length) {
      const { data: att, error: aErr } = await (req.supabase as any)
        .from("webinar_attendance")
        .select("batch_id, attended")
        .in("batch_id", ids);

      if (aErr) {
        res.status(500).json({ error: aErr.message });
        return;
      }

      for (const r of (att ?? []) as any[]) {
        const c = (counts[r.batch_id] ||= { total: 0, attended: 0 });
        c.total++;
        if (r.attended) c.attended++;
      }
    }

    const result = (batches ?? []).map((b: any) => ({
      ...b,
      ...(counts[b.id] ?? { total: 0, attended: 0 }),
    }));

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listBatchAttendance.
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 71).
 */
export async function listBatchAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const batchId = (typeof req.query.batchId === "string" ? req.query.batchId : undefined)
      ?? (typeof req.query.batch_id === "string" ? req.query.batch_id : undefined);
    if (!batchId) {
      res.status(400).json({ error: "batchId is required" });
      return;
    }

    const { data: rows, error } = await (req.supabase as any)
      .from("webinar_attendance")
      .select("id, lead_id, attended, marked_at, defaulter_marked_at")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const list = rows ?? [];
    const ids = [...new Set(list.map((r: any) => r.lead_id).filter(Boolean))];
    const leadMap: Record<string, any> = {};
    if (ids.length) {
      const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        const { data: leads, error: lErr } = await (db as any)
          .from("kob_leads")
          .select("id, code, full_name, phone, stage, language")
          .in("id", chunk);
        if (lErr) {
          res.status(500).json({ error: lErr.message });
          return;
        }
        for (const l of leads ?? []) leadMap[l.id] = l;
      }
    }

    const result = list.map((r: any) => ({ ...r, kob_leads: leadMap[r.lead_id] ?? null }));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listWebinarEligibleLeads.
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 101).
 * Filter stage = "WEBINAR", order("created_at", { ascending: false }).limit(500).
 * Optional filters: language and search.
 * Uses request-scoped client: req.supabase.
 */
export async function listWebinarEligibleLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const language = typeof req.query.language === "string" ? req.query.language : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;

    let q = (req.supabase as any)
      .from("kob_leads")
      .select("id, code, full_name, phone, stage, language, assigned_to, created_at")
      .eq("stage", "WEBINAR")
      .order("created_at", { ascending: false })
      .limit(500);

    if (language && language !== "ALL") {
      q = q.eq("language", language.toUpperCase());
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      q = q.or(`full_name.ilike.${term},code.ilike.${term},phone.ilike.${term}`);
    }

    const { data: rows, error } = await q;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(rows ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getWebinarHistory.
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 253).
 * Org-wide webinar batches history, attendance and lead/profile joins.
 * Uses supabaseAdmin (fallback to req.supabase).
 */
export async function getWebinarHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    if (!db) {
      res.status(500).json({ error: "Database client not initialized on request" });
      return;
    }

    const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : undefined;

    let bq = (db as any)
      .from("webinar_batches")
      .select("id, name, scheduled_at, language")
      .order("scheduled_at", { ascending: false });
    if (from) bq = bq.gte("scheduled_at", from);
    if (to) bq = bq.lte("scheduled_at", to);
    const { data: batches, error: bErr } = await bq;
    if (bErr) {
      res.status(500).json({ error: bErr.message });
      return;
    }

    const batchList = (batches ?? []) as any[];
    if (!batchList.length) {
      res.status(200).json({ rows: [], totals: { total: 0, attended: 0, defaulters: 0 } });
      return;
    }

    const batchMap: Record<string, any> = {};
    for (const b of batchList) batchMap[b.id] = b;

    const { data: att, error: aErr } = await (db as any)
      .from("webinar_attendance")
      .select("id, batch_id, lead_id, attended, marked_at, defaulter_marked_at, created_at")
      .in("batch_id", batchList.map((b) => b.id));
    if (aErr) {
      res.status(500).json({ error: aErr.message });
      return;
    }

    const list = (att ?? []) as any[];
    const leadIds = [...new Set(list.map((r) => r.lead_id).filter(Boolean))];
    const leadMap: Record<string, any> = {};
    for (let i = 0; i < leadIds.length; i += 150) {
      const chunk = leadIds.slice(i, i + 150);
      const { data: leads, error: lErr } = await (db as any)
        .from("kob_leads")
        .select("id, code, full_name, phone, stage, language, assigned_to")
        .in("id", chunk);
      if (lErr) {
        res.status(500).json({ error: lErr.message });
        return;
      }
      for (const l of leads ?? []) leadMap[l.id] = l;
    }

    const execIds = [...new Set(Object.values(leadMap).map((l: any) => l.assigned_to).filter(Boolean))];
    const execMap: Record<string, string> = {};
    if (execIds.length) {
      for (let i = 0; i < execIds.length; i += 150) {
        const chunk = execIds.slice(i, i + 150);
        const { data: profs } = await (db as any)
          .from("profiles")
          .select("id, full_name")
          .in("id", chunk);
        for (const p of profs ?? []) execMap[p.id] = p.full_name;
      }
    }

    const rows = list.map((r) => {
      const b = batchMap[r.batch_id] ?? {};
      const l = leadMap[r.lead_id] ?? {};
      return {
        id: r.id,
        batch_name: b.name ?? "—",
        scheduled_at: b.scheduled_at ?? null,
        batch_language: b.language ?? null,
        lead_id: r.lead_id,
        code: l.code ?? "",
        full_name: l.full_name ?? "—",
        phone: l.phone ?? "",
        language: l.language ?? "",
        stage: l.stage ?? "",
        executive: l.assigned_to ? execMap[l.assigned_to] ?? "—" : "—",
        attended: !!r.attended,
        status: r.attended ? "Attended" : "Defaulter",
        marked_at: r.marked_at ?? null,
        defaulter_marked_at: r.defaulter_marked_at ?? null,
      };
    }).sort((a, b) => String(b.scheduled_at ?? "").localeCompare(String(a.scheduled_at ?? "")));

    res.status(200).json({
      rows,
      totals: {
        total: rows.length,
        attended: rows.filter((r) => r.attended).length,
        defaulters: rows.filter((r) => !r.attended).length,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for createWebinarBatch
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 36).
 * Creates a webinar batch row and logs audit.
 */
export async function createWebinarBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { name, scheduled_at, language, notes } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
      res.status(400).json({ error: "name is required and must be between 1 and 200 characters" });
      return;
    }

    if (!scheduled_at || typeof scheduled_at !== "string" || scheduled_at.trim().length === 0) {
      res.status(400).json({ error: "scheduled_at is required" });
      return;
    }

    if (notes !== undefined && notes !== null && (typeof notes !== "string" || notes.length > 1000)) {
      res.status(400).json({ error: "notes must be at most 1000 characters" });
      return;
    }

    const { data: row, error } = await (req.supabase as any)
      .from("webinar_batches")
      .insert({
        name: name.trim(),
        scheduled_at: scheduled_at.trim(),
        language: language ?? null,
        notes: notes ?? null,
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      "webinar_batch_create",
      "webinar_batches",
      row.id,
      { name: name.trim(), scheduled_at: scheduled_at.trim(), language: language ?? null }
    );

    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for deleteWebinarBatch
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 61).
 */
export async function deleteWebinarBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const batchId = (req.params.id ?? req.body?.batchId) as string | undefined;
    if (!batchId || typeof batchId !== "string" || batchId.trim().length === 0) {
      res.status(400).json({ error: "batchId is required" });
      return;
    }

    const { error } = await (req.supabase as any)
      .from("webinar_batches")
      .delete()
      .eq("id", batchId.trim());

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId ?? null, "webinar_batch_delete", "webinar_batches", batchId.trim(), null);

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for addLeadsToBatch
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 118).
 */
export async function addLeadsToBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const batchId = (req.params.id ?? req.body?.batchId) as string | undefined;
    const { leadIds } = req.body ?? {};

    if (!batchId || typeof batchId !== "string" || batchId.trim().length === 0) {
      res.status(400).json({ error: "batchId is required" });
      return;
    }

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: "leadIds must be a non-empty array of lead IDs" });
      return;
    }

    const rows = leadIds.map((lid: string) => ({
      batch_id: batchId.trim(),
      lead_id: lid,
      attended: false,
    }));

    const { error } = await (req.supabase as any)
      .from("webinar_attendance")
      .upsert(rows, { onConflict: "batch_id,lead_id", ignoreDuplicates: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      "webinar_attendance_add",
      "webinar_batches",
      batchId.trim(),
      { leadIds }
    );

    res.status(200).json({ ok: true, added: rows.length });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for removeLeadFromBatch
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 131).
 */
export async function removeLeadFromBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const batchId = req.params.batchId as string | undefined;
    const leadId = req.params.leadId as string | undefined;
    let attendanceId = (req.params.id ?? req.body?.attendanceId) as string | undefined;

    if (batchId && leadId) {
      const { data: row } = await (req.supabase as any)
        .from("webinar_attendance")
        .select("id")
        .eq("batch_id", batchId)
        .eq("lead_id", leadId)
        .maybeSingle();
      if (row) {
        attendanceId = row.id;
      }
    }

    if (!attendanceId) {
      if (!batchId && !leadId) {
        res.status(400).json({ error: "attendanceId or batchId and leadId required" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await (req.supabase as any)
      .from("webinar_attendance")
      .delete()
      .eq("id", attendanceId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId ?? null, "webinar_attendance_remove", "webinar_attendance", attendanceId, null);

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for markAttendance
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 141).
 */
export async function markAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const attendanceId = (req.params.id ?? req.body?.attendanceId) as string | undefined;
    const { attended } = req.body ?? {};

    if (!attendanceId || typeof attendanceId !== "string" || attendanceId.trim().length === 0) {
      res.status(400).json({ error: "attendanceId is required" });
      return;
    }

    if (typeof attended !== "boolean") {
      res.status(400).json({ error: "attended must be a boolean" });
      return;
    }

    const { error } = await (req.supabase as any)
      .from("webinar_attendance")
      .update({
        attended,
        marked_at: new Date().toISOString(),
        marked_by: req.userId ?? null,
      })
      .eq("id", attendanceId.trim());

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      "webinar_attendance_mark",
      "webinar_attendance",
      attendanceId.trim(),
      { attended }
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for rescheduleAttendance
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 167).
 */
export async function rescheduleAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const attendanceId = (req.params.id ?? req.body?.attendanceId) as string | undefined;
    const { newBatchId } = req.body ?? {};

    if (!attendanceId || typeof attendanceId !== "string" || attendanceId.trim().length === 0) {
      res.status(400).json({ error: "attendanceId is required" });
      return;
    }

    if (!newBatchId || typeof newBatchId !== "string" || newBatchId.trim().length === 0) {
      res.status(400).json({ error: "newBatchId is required" });
      return;
    }

    const { data: existing, error: exErr } = await (req.supabase as any)
      .from("webinar_attendance")
      .select("id, batch_id, lead_id")
      .eq("id", attendanceId.trim())
      .maybeSingle();

    if (exErr) {
      res.status(500).json({ error: exErr.message });
      return;
    }

    if (!existing) {
      res.status(400).json({ error: "Attendance row not found" });
      return;
    }

    if (existing.batch_id === newBatchId.trim()) {
      res.status(400).json({ error: "Lead is already in that batch" });
      return;
    }

    const { data: dup, error: dupErr } = await (req.supabase as any)
      .from("webinar_attendance")
      .select("id")
      .eq("batch_id", newBatchId.trim())
      .eq("lead_id", existing.lead_id)
      .maybeSingle();

    if (dupErr) {
      res.status(500).json({ error: dupErr.message });
      return;
    }

    if (dup) {
      const { error: delErr } = await (req.supabase as any)
        .from("webinar_attendance")
        .delete()
        .eq("id", attendanceId.trim());
      if (delErr) {
        res.status(500).json({ error: delErr.message });
        return;
      }
    } else {
      const { error: updErr } = await (req.supabase as any)
        .from("webinar_attendance")
        .update({
          batch_id: newBatchId.trim(),
          attended: false,
          defaulter_marked_at: null,
          marked_at: null,
          marked_by: null,
        })
        .eq("id", attendanceId.trim());

      if (updErr) {
        res.status(500).json({ error: updErr.message });
        return;
      }
    }

    // Cancel any still-PENDING "missed webinar" nudges for this lead.
    const db = supabaseAdmin;
    const { data: defTemplates, error: tplErr } = await (req.supabase as any)
      .from("gallabox_templates")
      .select("id")
      .eq("category", "WEBINAR_DEFAULTER");

    if (tplErr) {
      res.status(500).json({ error: tplErr.message });
      return;
    }

    const templateIds = (defTemplates ?? []).map((t: any) => t.id);
    let cancelled = 0;

    if (templateIds.length > 0) {
      const { data: cancelledRows, error: qErr } = await (db as any)
        .from("gallabox_fire_queue")
        .update({ status: "FAILED", error: "CANCELLED: rescheduled to another webinar batch" })
        .eq("lead_id", existing.lead_id)
        .eq("status", "PENDING")
        .in("template_id", templateIds)
        .select("id");

      if (qErr) {
        res.status(500).json({ error: qErr.message });
        return;
      }

      cancelled = (cancelledRows ?? []).length;

      const { error: emailErr } = await (db as any)
        .from("email_fire_queue")
        .update({ status: "FAILED", error: "CANCELLED: rescheduled to another webinar batch" })
        .eq("lead_id", existing.lead_id)
        .eq("status", "PENDING")
        .in("template_id", templateIds);

      if (emailErr) {
        res.status(500).json({ error: emailErr.message });
        return;
      }
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      "webinar_attendance_reschedule",
      "webinar_attendance",
      attendanceId.trim(),
      {
        lead_id: existing.lead_id,
        old_batch_id: existing.batch_id,
        new_batch_id: newBatchId.trim(),
        cancelled_nudges: cancelled,
      }
    );

    res.status(200).json({ ok: true, cancelled_nudges: cancelled });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for markLeadEoi2
 * Migrated 1:1 from src/lib/webinar.functions.ts (line 154).
 * Updates lead stage to EOI_2 and logs audit with { stage: "EOI_2", via: "webinar" }.
 */
export async function markLeadEoi2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const leadId = (req.params.id ?? req.body?.leadId) as string | undefined;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!leadId || !uuidRegex.test(leadId)) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    const { error } = await req.supabase
      .from("kob_leads")
      .update({ stage: "EOI_2" as any })
      .eq("id", leadId.trim());

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "lead_stage_update", "kob_leads", leadId.trim(), { stage: "EOI_2", via: "webinar" });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}



