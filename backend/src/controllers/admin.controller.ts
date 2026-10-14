import { type Request, type Response, type NextFunction } from "express";
import { supabaseAdmin } from "../integrations/supabase/client.js";
import { logAudit } from "../utils/audit.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controller for seedDemoUsers
 * Migrated 1:1 from src/lib/seed-users.functions.ts (line 8).
 * Public endpoint to idempotently provision demo users.
 */
export async function seedDemoUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users: Array<{ email: string; full_name: string; role: string; tlIndex?: number }> = [
      { email: "ceo@shero.test", full_name: "CEO Office", role: "super_admin" },
      { email: "manager@shero.test", full_name: "KOB Manager", role: "kob_manager" },
      ...Array.from({ length: 5 }, (_, i) => ({
        email: `tl${i + 1}@shero.test`,
        full_name: `Team Leader ${i + 1}`,
        role: "team_leader",
      })),
      // Executives are real accounts managed in /mgr/executives — never seeded here.
    ];

    const results: Array<{ email: string; created: boolean }> = [];
    const tlIds: Record<number, string> = {};

    // Pass 1: create/find users, upsert profile + role
    for (const u of users) {
      const { data: existing, error: lErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (lErr) {
        res.status(500).json({ error: lErr.message });
        return;
      }
      let existingUser = existing?.users.find((x) => x.email === u.email);
      let created = false;
      if (!existingUser) {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: u.email,
          password: "Test@12345",
          email_confirm: true,
          user_metadata: { full_name: u.full_name },
        });
        if (error && !error.message.includes("already registered")) {
          res.status(500).json({ error: `create ${u.email}: ${error.message}` });
          return;
        }
        existingUser = data?.user ?? existing?.users.find((x) => x.email === u.email);
        created = true;
      }
      if (!existingUser) continue;

      await supabaseAdmin.from("profiles").upsert({ id: existingUser.id, full_name: u.full_name, email: u.email });
      await supabaseAdmin.from("user_roles").upsert({ user_id: existingUser.id, role: u.role as any }, { onConflict: "user_id,role" });

      if (u.role === "team_leader") {
        const idx = parseInt(u.email.match(/tl(\d+)/)?.[1] ?? "0", 10);
        tlIds[idx] = existingUser.id;
      }
      results.push({ email: u.email, created });
    }

    // Pass 2: link executives to TLs
    const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of users) {
      if (u.role !== "executive") continue;
      const uid = allUsers?.users.find((x) => x.email === u.email)?.id;
      if (!uid || !u.tlIndex) continue;
      const tlId = tlIds[u.tlIndex];
      if (tlId) await supabaseAdmin.from("profiles").update({ team_leader_id: tlId }).eq("id", uid);
    }

    // Pass 3: assign leads round-robin to executives + set team_leader_id
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, team_leader_id").not("team_leader_id", "is", null);
    const execs = profs ?? [];
    if (execs.length > 0) {
      const { data: leads } = await supabaseAdmin.from("kob_leads").select("id").is("assigned_to", null).limit(500);
      for (let i = 0; i < (leads?.length ?? 0); i++) {
        const e = execs[i % execs.length] as any;
        await supabaseAdmin.from("kob_leads").update({ assigned_to: e.id, team_leader_id: e.team_leader_id }).eq("id", (leads![i] as any).id);
      }
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "seed_demo_users",
      entity: "user_roles",
      entity_id: null,
      meta: { count: results.length } as any,
    });

    res.status(200).json({ ok: true, count: results.length, results });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateCityPincodeAliases
 * Migrated 1:1 from src/lib/kob.functions.ts (line 869).
 * Updates district and state aliases for a city, then calls recompute_city_pincode_counts.
 */
export async function updateCityPincodeAliases(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const cityId = (req.params.id ?? req.body?.cityId) as string | undefined;
    const districtAliases = req.body?.districtAliases ?? [];
    const stateAliases = req.body?.stateAliases ?? [];

    if (!cityId || typeof cityId !== "string" || !UUID_REGEX.test(cityId.trim())) {
      res.status(400).json({ error: "cityId must be a valid UUID" });
      return;
    }

    const trimmedCityId = cityId.trim();

    const clean = (arr: any[]) =>
      (Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter((s) => s.length > 0) : []);

    const { error } = await req.supabase
      .from("india_cities")
      .update({
        district_aliases: clean(districtAliases),
        state_aliases: clean(stateAliases),
      })
      .eq("id", trimmedCityId);

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    // Recompute just this city
    const { data: rows, error: rpcErr } = await req.supabase.rpc(
      "recompute_city_pincode_counts",
      { _city_id: trimmedCityId },
    );

    if (rpcErr) {
      res.status(500).json({ error: rpcErr.message });
      return;
    }

    res.status(200).json({ ok: true, updated: rows?.[0] ?? null });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for syncCityPincodesFromIndiaPost
 * Migrated 1:1 from src/lib/kob.functions.ts (line 843).
 * Recomputes india_cities.pincode_count via the recompute_city_pincode_counts RPC.
 */
export async function syncCityPincodesFromIndiaPost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const cityId = (req.body?.data?.cityId ?? req.body?.cityId ?? req.query?.cityId) as string | undefined;
    let targetCityId: string | null = null;
    if (cityId !== undefined && cityId !== null && cityId !== "") {
      if (typeof cityId !== "string" || !UUID_REGEX.test(cityId.trim())) {
        res.status(400).json({ error: "cityId must be a valid UUID" });
        return;
      }
      targetCityId = cityId.trim();
    }

    const { data: rows, error } = await req.supabase.rpc(
      "recompute_city_pincode_counts",
      { _city_id: targetCityId },
    );

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const results = ((rows ?? []) as any[]).map((r) => ({
      id: r.city_id as string,
      name: r.city_name as string,
      count: Number(r.pincode_count ?? 0),
      matched: Number(r.pincode_count ?? 0) > 0,
    }));
    const total = results.length;
    const updated = results.filter((r) => r.matched).length;
    const failed = total - updated;

    await logAudit(
      req.supabase,
      req.userId,
      "pincode_recompute",
      "india_cities",
      targetCityId ?? "bulk",
      { updated, failed, total },
    );

    res.status(200).json({ updated, failed, total, results });
  } catch (err) {
    next(err);
  }
}

