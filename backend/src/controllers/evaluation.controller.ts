import { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { logAudit } from "../utils/audit.js";

/**
 * Controller for listEvaluationQuestions.
 * Migrated 1:1 from src/lib/evaluation.functions.ts (line 9).
 * Query: supabase.from("evaluation_questions").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true })
 * Uses request-scoped RLS client: req.supabase
 */
export async function listEvaluationQuestions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("evaluation_questions")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getLeadEvaluation.
 * Migrated 1:1 from src/lib/evaluation.functions.ts (line 94).
 * Query: evaluation_responses, v_lead_evaluation_score for lead_id
 */
export async function getLeadEvaluation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const leadId = (typeof req.query.lead_id === "string" ? req.query.lead_id : undefined)
      ?? (typeof req.query.leadId === "string" ? req.query.leadId : undefined);

    if (!leadId) {
      res.status(400).json({ error: "lead_id is required" });
      return;
    }

    const [{ data: responses, error: rErr }, { data: score, error: sErr }] = await Promise.all([
      req.supabase.from("evaluation_responses").select("*").eq("lead_id", leadId),
      req.supabase.from("v_lead_evaluation_score").select("*").eq("lead_id", leadId).maybeSingle(),
    ]);

    if (rErr) {
      res.status(500).json({ error: rErr.message });
      return;
    }
    if (sErr) {
      res.status(500).json({ error: sErr.message });
      return;
    }

    res.status(200).json({ responses: responses ?? [], score: score ?? null });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listLeadEvaluationHistory.
 * Migrated 1:1 from src/lib/evaluation.functions.ts (line 146).
 */
export async function listLeadEvaluationHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const leadId = (typeof req.query.lead_id === "string" ? req.query.lead_id : undefined)
      ?? (typeof req.query.leadId === "string" ? req.query.leadId : undefined);
    if (!leadId) {
      res.status(400).json({ error: "lead_id is required" });
      return;
    }
    const { data: rows, error } = await req.supabase
      .from("v_lead_evaluation_history")
      .select("*")
      .eq("lead_id", leadId)
      .order("filled_at", { ascending: false });
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
 * Controller for listLeadsForEvaluation.
 * Migrated 1:1 from src/lib/evaluation.functions.ts (line 68).
 */
export async function listLeadsForEvaluation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const userId = req.userId;
    const { data: roles, error: rErr } = await req.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rErr) {
      res.status(500).json({ error: rErr.message });
      return;
    }
    const rs = (roles ?? []).map((r: any) => r.role);
    const isMgr = rs.includes("super_admin") || rs.includes("kob_manager");
    const isTL = rs.includes("team_leader");

    let q = req.supabase
      .from("kob_leads")
      .select("id, code, full_name, phone, stage, language, assigned_to, team_leader_id, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (!isMgr) {
      if (isTL) q = q.or(`team_leader_id.eq.${userId},assigned_to.eq.${userId}`);
      else q = q.eq("assigned_to", userId);
    }

    const { data, error } = await q;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for upsertEvaluationQuestion.
 * Migrated 1:1 from src/lib/evaluation.functions.ts (line 21).
 */
export async function upsertEvaluationQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const { id, question_text, weight, question_type, active, sort_order } = req.body ?? {};

    if (!question_text || typeof question_text !== "string" || !question_text.trim()) {
      res.status(400).json({ error: "question_text is required" });
      return;
    }

    if (weight === undefined || weight === null || isNaN(Number(weight))) {
      res.status(400).json({ error: "weight is required" });
      return;
    }

    if (!question_type || !["SCALE_1_5", "YES_NO", "TEXT"].includes(question_type)) {
      res.status(400).json({ error: "question_type must be SCALE_1_5, YES_NO, or TEXT" });
      return;
    }

    const payload: any = {
      question_text: question_text.trim(),
      weight: Number(weight),
      question_type,
      active: active ?? true,
      sort_order: sort_order ?? 0,
    };

    let targetId = id;
    if (targetId) {
      const { error } = await req.supabase
        .from("evaluation_questions")
        .update(payload)
        .eq("id", targetId);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      await logAudit(req.supabase, req.userId, "eval_question_updated", "evaluation_questions", targetId, payload);
    } else {
      const { data: ins, error } = await req.supabase
        .from("evaluation_questions")
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      targetId = (ins as any).id;
      await logAudit(req.supabase, req.userId, "eval_question_created", "evaluation_questions", targetId!, payload);
    }

    res.status(200).json({ ok: true, id: targetId });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for deleteEvaluationQuestion.
 * Migrated 1:1 from src/lib/evaluation.functions.ts (line 55).
 */
export async function deleteEvaluationQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const id = req.params.id || req.body?.id;
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }

    const { error } = await req.supabase
      .from("evaluation_questions")
      .delete()
      .eq("id", id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "eval_question_deleted", "evaluation_questions", id, null);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for saveEvaluationResponses
 * Migrated 1:1 from src/lib/evaluation.functions.ts (line 105).
 */
export async function saveEvaluationResponses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const leadId = (req.body?.lead_id ?? req.body?.leadId) as string | undefined;
    const answers = req.body?.answers as Array<{ question_id: string; answer_value: number | null; answer_text: string | null }> | undefined;

    if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
      res.status(400).json({ error: "lead_id is required" });
      return;
    }

    if (!Array.isArray(answers)) {
      res.status(400).json({ error: "answers must be an array" });
      return;
    }

    if (answers.length === 0) {
      res.status(200).json({ ok: true, score: null });
      return;
    }

    // Fetch current weights so we can lock weight_at_time per response
    const qids = answers.map((a) => a.question_id);
    const { data: qs, error: qErr } = await req.supabase
      .from("evaluation_questions")
      .select("id, weight")
      .in("id", qids);

    if (qErr) {
      res.status(500).json({ error: qErr.message });
      return;
    }

    const wMap = new Map<string, number>((qs ?? []).map((q: any) => [q.id, Number(q.weight)]));

    // One evaluation_id per submission batch
    const evalId = randomUUID();
    const filledAt = new Date().toISOString();

    const rows = answers.map((a) => ({
      evaluation_id: evalId,
      lead_id: leadId.trim(),
      question_id: a.question_id,
      answer_value: a.answer_value ?? null,
      answer_text: a.answer_text ?? null,
      weight_at_time: wMap.get(a.question_id) ?? null,
      filled_by: req.userId,
      filled_at: filledAt,
    }));

    const { error: insErr } = await req.supabase
      .from("evaluation_responses")
      .insert(rows);

    if (insErr) {
      res.status(500).json({ error: insErr.message });
      return;
    }

    const { data: score, error: sErr } = await req.supabase
      .from("v_lead_evaluation_history")
      .select("*")
      .eq("evaluation_id", evalId)
      .maybeSingle();

    if (sErr) {
      res.status(500).json({ error: sErr.message });
      return;
    }

    res.status(200).json({ ok: true, evaluation_id: evalId, score: score ?? null });
  } catch (err) {
    next(err);
  }
}
