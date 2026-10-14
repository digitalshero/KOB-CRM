import { type Request, type Response, type NextFunction } from "express";
import { supabaseAdmin } from "../integrations/supabase/client.js";
import { logAudit } from "../utils/audit.js";

async function assertManager(supabase: any, userId: string): Promise<boolean> {
  const { data: isMgr } = await supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" });
  const { data: isSA } = await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" });
  return !!(isMgr || isSA);
}

/**
 * Controller for qaListStaff.
 * Migrated 1:1 from src/lib/qa.functions.ts (line 13).
 * Requires manager / CEO office role.
 */
export async function qaListStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    const { data: profiles, error: pErr } = await db.from("profiles").select("id, full_name, email");
    if (pErr) {
      res.status(500).json({ error: pErr.message });
      return;
    }

    const { data: roles, error: rErr } = await db.from("user_roles").select("user_id, role");
    if (rErr) {
      res.status(500).json({ error: rErr.message });
      return;
    }

    const roleByUser: Record<string, string[]> = {};
    for (const r of roles ?? []) {
      (roleByUser[(r as any).user_id] ??= []).push((r as any).role);
    }
    const all = (profiles ?? []).map((p: any) => ({ ...p, roles: roleByUser[p.id] ?? [] }));

    res.status(200).json({
      tls: all.filter((p) => p.roles.includes("team_leader")),
      execs: all.filter((p) => p.roles.includes("executive")),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaCreateSampleLead
 * Migrated 1:1 from src/lib/qa.functions.ts (line 37).
 */
export async function qaCreateSampleLead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const [{ data: brand }, { data: state }, { data: city }, { data: source }, { data: cfg }] = await Promise.all([
      req.supabase.from("brands").select("id").eq("active", true).limit(1).maybeSingle(),
      req.supabase.from("india_states").select("id").eq("active", true).limit(1).maybeSingle(),
      req.supabase.from("india_cities").select("id, district_id, state_id").eq("active", true).limit(1).maybeSingle(),
      req.supabase.from("lead_sources").select("id").eq("active", true).limit(1).maybeSingle(),
      req.supabase.from("kob_configuration").select("default_mode").eq("id", 1).maybeSingle(),
    ]);

    const stamp = Date.now().toString().slice(-8);
    const code = `QA-${stamp}`;
    const payload: any = {
      code,
      full_name: `QA Test Lead ${stamp}`,
      phone: `+9199${stamp}`,
      email: `qa+${stamp}@shero.test`,
      stage: "LEAD_INBOX",
      mode: (cfg as any)?.default_mode ?? "AUTO",
      language: "HINDI",
      brand_id: brand?.id ?? null,
      state_id: (city as any)?.state_id ?? state?.id ?? null,
      district_id: (city as any)?.district_id ?? null,
      city_id: city?.id ?? null,
      source_id: source?.id ?? null,
      investment_capacity: 500000,
    };

    const { data, error } = await req.supabase.from("kob_leads").insert(payload).select("id, code, full_name").single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "qa_create_lead", "kob_leads", data.id, { code });

    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaAssignTL
 * Migrated 1:1 from src/lib/qa.functions.ts (line 73).
 */
export async function qaAssignTL(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const leadId = (req.params.id ?? req.body?.leadId) as string | undefined;
    const tlId = (req.body?.tlId ?? req.body?.teamLeaderId) as string | undefined;

    if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
      res.status(400).json({ error: "leadId is required" });
      return;
    }

    if (!tlId || typeof tlId !== "string" || tlId.trim().length === 0) {
      res.status(400).json({ error: "tlId is required" });
      return;
    }

    const { error } = await req.supabase
      .from("kob_leads")
      .update({ team_leader_id: tlId.trim() })
      .eq("id", leadId.trim());

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "qa_assign_tl", "kob_leads", leadId.trim(), { tlId: tlId.trim() });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaAssignExec
 * Migrated 1:1 from src/lib/qa.functions.ts (line 86).
 */
export async function qaAssignExec(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const leadId = (req.params.id ?? req.body?.leadId) as string | undefined;
    const execId = (req.body?.execId ?? req.body?.executiveId) as string | undefined;

    if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
      res.status(400).json({ error: "leadId is required" });
      return;
    }

    if (!execId || typeof execId !== "string" || execId.trim().length === 0) {
      res.status(400).json({ error: "execId is required" });
      return;
    }

    const { error } = await req.supabase
      .from("kob_leads")
      .update({ assigned_to: execId.trim() })
      .eq("id", leadId.trim());

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "qa_assign_exec", "kob_leads", leadId.trim(), { execId: execId.trim() });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

const STAGE_WEIGHT: Record<string, number> = {
  LEAD_INBOX: 5, AUTO_FIRED: 10, EOI_1: 20, WEBINAR: 30, EOI_2: 40,
  FORM_FILLED: 55, FEE_PAID: 70, AGREEMENT_SIGNED: 82, KTN_CS: 92, KTN_LIVE: 100,
  NO: 0, LATER: 15, NO_RESPONSE: 10, RETARGETING: 12, DEAD_LEAD: 0, FAILED_FIRE: 5,
};

/**
 * Controller for qaRecalcScv
 * Migrated 1:1 from src/lib/qa.functions.ts (line 146).
 */
export async function qaRecalcScv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const leadId = (req.params.id ?? req.body?.leadId) as string | undefined;
    if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
      res.status(400).json({ error: "leadId is required" });
      return;
    }

    const { data: lead, error: lErr } = await req.supabase
      .from("kob_leads")
      .select("stage, gallabox_template_sent, av_link_sent, form_link_sent, investment_capacity")
      .eq("id", leadId.trim())
      .maybeSingle();

    if (lErr) {
      res.status(500).json({ error: lErr.message });
      return;
    }

    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const base = STAGE_WEIGHT[(lead as any).stage] ?? 0;
    const bonus = ((lead as any).gallabox_template_sent ? 2 : 0) + ((lead as any).av_link_sent ? 2 : 0) + ((lead as any).form_link_sent ? 2 : 0);
    const capBoost = Math.min(10, Math.floor(((lead as any).investment_capacity ?? 0) / 100000));
    const score = Math.min(100, base + bonus + capBoost);

    const { error: uErr } = await req.supabase
      .from("kob_leads")
      .update({ scv_score: score })
      .eq("id", leadId.trim());

    if (uErr) {
      res.status(500).json({ error: uErr.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "qa_scv_recalc", "kob_leads", leadId.trim(), { score });

    res.status(200).json({ score });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaComputeScvScores
 * Migrated 1:1 from src/lib/qa.functions.ts (line 241).
 */
export async function qaComputeScvScores(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    const { data, error } = await db.from("v_scv_leaderboard").select("*");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const rows = (data ?? []) as any[];
    await logAudit(req.supabase, req.userId, "compute_scv_scores", "user_roles", null, { executives: rows.length } as any);

    res.status(200).json({
      executives: rows.length,
      rows: rows.slice(0, 10),
      note: "SCV is computed live from scv_rules; showing top 10.",
    });
  } catch (err) {
    next(err);
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controller for qaMoveStage
 * Migrated 1:1 from src/lib/qa.functions.ts (line 99).
 * Allows manager / CEO office to move a lead to any stage.
 */
export async function qaMoveStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const leadId = (req.params.id ?? req.body?.leadId) as string | undefined;
    const stage = req.body?.stage as string | undefined;

    if (!leadId || typeof leadId !== "string" || !UUID_REGEX.test(leadId.trim())) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    if (!stage || typeof stage !== "string" || stage.trim().length === 0) {
      res.status(400).json({ error: "stage is required" });
      return;
    }

    const trimmedLeadId = leadId.trim();
    const trimmedStage = stage.trim();

    const { error } = await req.supabase
      .from("kob_leads")
      .update({ stage: trimmedStage as any })
      .eq("id", trimmedLeadId);

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "qa_stage_move", "kob_leads", trimmedLeadId, { stage: trimmedStage });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaVerify
 * Migrated 1:1 from src/lib/qa.functions.ts (line 165).
 * Fetches lead details, stage history count/items, audit count/items, and system counts.
 */
export async function qaVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const leadId = (req.params.id ?? req.body?.leadId) as string | undefined;

    if (!leadId || typeof leadId !== "string" || !UUID_REGEX.test(leadId.trim())) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    const trimmedLeadId = leadId.trim();

    const [
      { data: lead, error: e1 },
      { count: stageHistoryCount, error: e2 },
      { data: history, error: e3 },
      { count: auditCount, error: e4 },
      { data: audits, error: e5 },
      { count: totalLeads, error: e6 },
      { count: feePaid, error: e7 },
      { count: agreement, error: e8 },
      { count: ktnCs, error: e9 },
      { count: ktnLive, error: e10 },
      { count: retargeting, error: e11 },
    ] = await Promise.all([
      req.supabase
        .from("kob_leads")
        .select("id, code, full_name, stage, scv_score, assigned_to, team_leader_id, updated_at")
        .eq("id", trimmedLeadId)
        .maybeSingle(),
      req.supabase.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", trimmedLeadId),
      req.supabase
        .from("lead_stage_history")
        .select("from_stage, to_stage, created_at")
        .eq("lead_id", trimmedLeadId)
        .order("created_at", { ascending: false })
        .limit(20),
      req.supabase.from("audit_logs").select("*", { count: "exact", head: true }).eq("entity_id", trimmedLeadId),
      req.supabase
        .from("audit_logs")
        .select("action, created_at, meta")
        .eq("entity_id", trimmedLeadId)
        .order("created_at", { ascending: false })
        .limit(20),
      req.supabase.from("kob_leads").select("*", { count: "exact", head: true }),
      req.supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "FEE_PAID"),
      req.supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "AGREEMENT_SIGNED"),
      req.supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "KTN_CS"),
      req.supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "KTN_LIVE"),
      req.supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "RETARGETING"),
    ]);

    const firstErr = e1 || e2 || e3 || e4 || e5 || e6 || e7 || e8 || e9 || e10 || e11;
    if (firstErr) {
      res.status(500).json({ error: firstErr.message });
      return;
    }

    res.status(200).json({
      lead: lead ?? null,
      stageHistoryCount: stageHistoryCount ?? 0,
      history: history ?? [],
      auditCount: auditCount ?? 0,
      audits: audits ?? [],
      counts: {
        totalLeads: totalLeads ?? 0,
        feePaid: feePaid ?? 0,
        agreement: agreement ?? 0,
        ktnCs: ktnCs ?? 0,
        ktnLive: ktnLive ?? 0,
        retargeting: retargeting ?? 0,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaAdvanceRetargeting
 * Migrated 1:1 from src/lib/qa.functions.ts (line 261).
 * Runs retargeting advancement RPC and logs audit.
 */
export async function qaAdvanceRetargeting(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    const { data, error } = await db.rpc("advance_retargeting");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    await logAudit(req.supabase, req.userId, "advance_retargeting_manual", "retargeting_schedule", null, row as any);

    res.status(200).json(row ?? { advanced: 0, killed: 0, processed: 0 });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaTriggerRetargeting
 * Migrated 1:1 from src/lib/qa.functions.ts (line 112).
 * Moves lead to NO stage, inserts retargeting schedule, and triggers retargeting advancer.
 */
export async function qaTriggerRetargeting(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const leadId = (req.params.id ?? req.body?.leadId) as string | undefined;

    if (!leadId || typeof leadId !== "string" || !UUID_REGEX.test(leadId.trim())) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    const trimmedLeadId = leadId.trim();
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;

    // Move lead to NO (RLS-user path), then seed a due schedule row and run
    // the real advancer. retargeting_schedule inserts require admin — RLS
    // scopes writes to system triggers/cron, not user sessions.
    const { error: e1 } = await req.supabase.from("kob_leads").update({ stage: "NO" as any }).eq("id", trimmedLeadId);
    if (e1) {
      res.status(400).json({ error: e1.message });
      return;
    }

    const nowIso = new Date().toISOString();
    await db.from("retargeting_schedule").delete().eq("lead_id", trimmedLeadId);
    const { error: e2 } = await db.from("retargeting_schedule").insert({
      lead_id: trimmedLeadId,
      bucket: "NO",
      next_touch_at: nowIso,
      first_touch_at: nowIso,
      attempts_done: 0,
      phase: 1,
      is_dead: false,
    });
    if (e2) {
      res.status(500).json({ error: e2.message });
      return;
    }

    const { data: adv, error: e3 } = await db.rpc("advance_retargeting");
    if (e3) {
      res.status(500).json({ error: e3.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "qa_trigger_retargeting", "kob_leads", trimmedLeadId, { advancer: adv });

    res.status(200).json({ ok: true, advancer: adv });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaCleanup
 * Migrated 1:1 from src/lib/qa.functions.ts (line 215).
 * Removes all QA test leads and their related records across history, activities, queues, and audits.
 */
export async function qaCleanup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isAuthorized = await assertManager(req.supabase, req.userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    const { data: rows, error: rErr } = await db.from("kob_leads").select("id").like("code", "QA%");
    if (rErr) {
      res.status(500).json({ error: rErr.message });
      return;
    }

    const ids = (rows ?? []).map((r: any) => r.id);
    if (!ids.length) {
      res.status(200).json({ deleted: 0 });
      return;
    }

    await db.from("retargeting_schedule").delete().in("lead_id", ids);
    await db.from("lead_stage_history").delete().in("lead_id", ids);
    await db.from("lead_activities").delete().in("lead_id", ids);
    await db.from("gallabox_fire_queue").delete().in("lead_id", ids);
    await db.from("webinar_attendance").delete().in("lead_id", ids);
    await db.from("audit_logs").delete().in("entity_id", ids);
    const { error: dErr } = await db.from("kob_leads").delete().in("id", ids);
    if (dErr) {
      res.status(500).json({ error: dErr.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "qa_cleanup", "kob_leads", null, { deleted: ids.length });

    res.status(200).json({ deleted: ids.length });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for qaRunLifecycle
 * Migrated 1:1 from src/lib/qa.functions.ts (line 280).
 * Runs scripted end-to-end full lifecycle verification test.
 */
export async function qaRunLifecycle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const supabase = req.supabase;
    const userId = req.userId;

    const isAuthorized = await assertManager(supabase, userId);
    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Manager / CEO Office only" });
      return;
    }

    const results: Array<{ ok: boolean; label: string; detail?: string }> = [];
    const push = (ok: boolean, label: string, detail?: string) => results.push({ ok, label, detail });
    const createdLeadIds: string[] = [];

    const fetchLead = async (id: string) =>
      (await supabase.from("kob_leads").select("*").eq("id", id).maybeSingle()).data as any;

    try {
      const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
      const { data: rolesRows } = await db.from("user_roles").select("user_id, role");
      const tlIds = (rolesRows ?? []).filter((r: any) => r.role === "team_leader").map((r: any) => r.user_id);
      const execIds = (rolesRows ?? []).filter((r: any) => r.role === "executive").map((r: any) => r.user_id);
      const tlId = tlIds[0];
      const execId = execIds[0] ?? tlIds[0];
      push(!!tlId, "SETUP: Team Leader available", tlId ? `id=${tlId}` : "no team_leader role found");
      push(!!execId, "SETUP: Executive available", execId ? `id=${execId}` : "no executive found");
      if (!tlId || !execId) {
        res.status(200).json({
          results,
          passed: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        });
        return;
      }

      // 1. Create sample lead + mode resolves from default_mode
      const { data: cfg } = await req.supabase.from("kob_configuration").select("default_mode").eq("id", 1).maybeSingle();
      const defaultMode = (cfg as any)?.default_mode ?? "AUTO";

      const stamp = Date.now().toString().slice(-8);
      const code1 = `QA-LC1-${stamp}`;
      const { data: brand } = await req.supabase.from("brands").select("id").eq("active", true).limit(1).maybeSingle();
      const { data: city } = await req.supabase.from("india_cities").select("id, district_id, state_id").eq("active", true).limit(1).maybeSingle();
      const { data: source } = await req.supabase.from("lead_sources").select("id").eq("active", true).limit(1).maybeSingle();

      const basePayload = {
        stage: "LEAD_INBOX" as const,
        mode: defaultMode as any,
        language: "HINDI" as const,
        brand_id: brand?.id ?? null,
        state_id: (city as any)?.state_id ?? null,
        district_id: (city as any)?.district_id ?? null,
        city_id: city?.id ?? null,
        source_id: source?.id ?? null,
        investment_capacity: 500000,
      };

      const { data: lead1, error: e1 } = await req.supabase
        .from("kob_leads")
        .insert({ ...basePayload, code: code1, full_name: `QA LC1 ${stamp}`, phone: `+9199${stamp}`, email: `qa.lc1+${stamp}@shero.test` })
        .select("id, mode, stage_entered_at, assigned_to, team_leader_id")
        .single();
      if (e1 || !lead1) {
        push(false, "1. Create lead L1", e1?.message);
        res.status(200).json({
          results,
          passed: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        });
        return;
      }
      createdLeadIds.push(lead1.id);
      push(true, "1. Create lead L1", `id=${lead1.id}`);
      push((lead1 as any).mode === defaultMode, `1. Mode resolves from default_mode (${defaultMode})`, `got mode=${(lead1 as any).mode}`);

      // Assert auto-fire queue row iff mode=AUTO
      const { data: fireRows } = await req.supabase.from("gallabox_fire_queue").select("id, status").eq("lead_id", lead1.id);
      if (defaultMode === "AUTO") {
        push((fireRows ?? []).length > 0, "1a. gallabox_fire_queue row created (mode=AUTO)", `rows=${(fireRows ?? []).length}`);
      } else {
        push(true, "1a. gallabox_fire_queue skipped (mode!=AUTO)", `rows=${(fireRows ?? []).length}`);
      }

      // 2 & 3. Assign TL & Exec
      const { error: eTL } = await req.supabase.from("kob_leads").update({ team_leader_id: tlId }).eq("id", lead1.id);
      push(!eTL, "2. Assign Team Leader", eTL?.message);
      const { error: eEX } = await req.supabase.from("kob_leads").update({ assigned_to: execId }).eq("id", lead1.id);
      push(!eEX, "3. Assign Executive", eEX?.message);

      // 4. Walk stages (assert history + stage_entered_at)
      const walk = ["AUTO_FIRED", "EOI_1", "WEBINAR", "EOI_2", "FORM_FILLED", "FEE_PAID", "KTN_CS", "KTN_LIVE"];
      let prevStage = "LEAD_INBOX";
      let prevEnteredAt = (await fetchLead(lead1.id))?.stage_entered_at;
      for (const next of walk) {
        const { error: eMove } = await req.supabase.from("kob_leads").update({ stage: next as any }).eq("id", lead1.id);
        if (eMove) {
          push(false, `4. Move ${prevStage} → ${next}`, eMove.message);
          break;
        }
        const cur = await fetchLead(lead1.id);
        push(cur?.stage === next, `4. Stage now ${next}`, `db stage=${cur?.stage}`);

        // Assert history row
        const { data: hist } = await req.supabase
          .from("lead_stage_history")
          .select("from_stage, to_stage, created_at")
          .eq("lead_id", lead1.id)
          .order("created_at", { ascending: false })
          .limit(1);
        const last = (hist ?? [])[0] as any;
        push(!!last && last.from_stage === prevStage && last.to_stage === next,
          `4a. lead_stage_history ${prevStage}→${next}`,
          last ? `got ${last.from_stage}→${last.to_stage}` : "no history row");

        // Assert stage_entered_at advanced
        push(cur?.stage_entered_at && cur.stage_entered_at !== prevEnteredAt,
          `4b. stage_entered_at updated on move to ${next}`,
          `prev=${prevEnteredAt} new=${cur?.stage_entered_at}`);

        prevStage = next;
        prevEnteredAt = cur?.stage_entered_at;
      }

      // 5. Second lead → NO_RESPONSE → retargeting auto-enroll
      const code2 = `QA-LC2-${stamp}`;
      const { data: lead2, error: e2 } = await req.supabase
        .from("kob_leads")
        .insert({ ...basePayload, code: code2, full_name: `QA LC2 ${stamp}`, phone: `+9198${stamp}`, email: `qa.lc2+${stamp}@shero.test` })
        .select("id")
        .single();
      if (e2 || !lead2) {
        push(false, "5. Create lead L2", e2?.message);
      } else {
        createdLeadIds.push(lead2.id);
        push(true, "5. Create lead L2", `id=${lead2.id}`);

        const { error: eNR } = await req.supabase.from("kob_leads").update({ stage: "NO_RESPONSE" as any }).eq("id", lead2.id);
        push(!eNR, "5a. Move L2 → NO_RESPONSE", eNR?.message);

        const { data: sched } = await req.supabase.from("retargeting_schedule").select("*").eq("lead_id", lead2.id).maybeSingle();
        const s = sched as any;
        push(!!s, "5b. retargeting_schedule auto-enrolled", s ? `phase=${s.phase} bucket=${s.bucket}` : "no row");
        if (s) {
          push(s.bucket === "NO_RESPONSE" && s.phase === 1 && s.attempts_done === 0,
            "5c. schedule fields correct (bucket=NO_RESPONSE, phase=1, attempts=0)",
            `bucket=${s.bucket} phase=${s.phase} attempts=${s.attempts_done}`);
          const days = (new Date(s.next_touch_at).getTime() - new Date(s.first_touch_at).getTime()) / 86400000;
          push(days >= 2.5 && days <= 3.5, "5d. next_touch_at ≈ +3d per NO_RESPONSE phase-1 rule", `days=${days.toFixed(2)}`);

          // Force due-now, then advance
          await req.supabase.from("retargeting_schedule").update({ next_touch_at: new Date().toISOString() }).eq("id", s.id);
          const { data: adv, error: eAdv } = await (req.supabase as any).rpc("advance_retargeting");
          const advRow = Array.isArray(adv) ? adv[0] : adv;
          push(!eAdv, "5e. advance_retargeting() called", eAdv?.message ?? JSON.stringify(advRow));
          const { data: sched2 } = await req.supabase.from("retargeting_schedule").select("attempts_done").eq("id", s.id).maybeSingle();
          push((sched2 as any)?.attempts_done > s.attempts_done,
            "5f. attempts_done incremented after advance",
            `before=${s.attempts_done} after=${(sched2 as any)?.attempts_done}`);
        }
      }

      // 6. v_scv_leaderboard returns row for executive
      const { data: lb } = await (req.supabase as any).from("v_scv_leaderboard").select("*").eq("user_id", execId).maybeSingle();
      push(!!lb, "6. v_scv_leaderboard has row for executive", lb ? `lead_count=${(lb as any).lead_count} avg_scv=${(lb as any).avg_scv}` : "no row");
      if (lb) {
        push((lb as any).avg_scv !== null && (lb as any).avg_scv !== undefined,
          "6a. avg_scv is non-null", `avg_scv=${(lb as any).avg_scv}`);
      }
    } finally {
      // 7. Cleanup
      if (createdLeadIds.length) {
        await req.supabase.from("retargeting_schedule").delete().in("lead_id", createdLeadIds);
        await req.supabase.from("lead_stage_history").delete().in("lead_id", createdLeadIds);
        await req.supabase.from("lead_activities").delete().in("lead_id", createdLeadIds);
        await req.supabase.from("gallabox_fire_queue").delete().in("lead_id", createdLeadIds);
        const { error: eDel } = await req.supabase.from("kob_leads").delete().in("id", createdLeadIds);
        push(!eDel, `7. Cleanup ${createdLeadIds.length} test lead(s)`, eDel?.message);
      }
      await logAudit(req.supabase, req.userId, "qa_run_lifecycle", "kob_leads", null, { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } as any);
    }

    res.status(200).json({
      results,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });
  } catch (err) {
    next(err);
  }
}

