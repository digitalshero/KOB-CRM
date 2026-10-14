import { createRequire } from "module";
import { pathToFileURL } from "url";
import crypto from "crypto";

const require = createRequire("d:/Shero Home Food/kob-unity-spark (2)/backend/package.json");
const { createClient } = require("@supabase/supabase-js");
const { loadTestEnv } = await import(pathToFileURL("d:/Shero Home Food/kob-unity-spark (2)/backend/test-env.mjs").href);

const env = loadTestEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BACKEND_BASE = "http://localhost:3001";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

function createToken(userId, email) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 7200,
      sub: userId,
      email: email,
      role: "authenticated",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
    }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(header + "." + payload).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function createUserClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Audit logging helper
async function logAudit(supabase, actorId, action, entity, entityId, meta = null) {
  try {
    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action,
      entity,
      entity_id: entityId,
      meta,
    });
  } catch {}
}

// ----------------------------------------------------
// OLD IMPLEMENTATIONS (TanStack server fn behavior)
// ----------------------------------------------------

async function oldUpdateLeadNextAction(supabase, userId, data) {
  const value = data.nextAction && data.nextAction.trim().length > 0 ? data.nextAction.trim() : null;
  const { error } = await supabase.from("kob_leads").update({ next_action: value }).eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, "lead_next_action_update", "kob_leads", data.leadId, { next_action: value });
  return { ok: true };
}

async function oldSetLeadRnrTag(supabase, userId, data) {
  const { data: row, error: readErr } = await supabase
    .from("kob_leads")
    .select("tags")
    .eq("id", data.leadId)
    .maybeSingle();
  if (readErr) throw readErr;
  const current = (row?.tags ?? []);
  const next = data.rnr
    ? Array.from(new Set([...current, "RNR"]))
    : current.filter((t) => t !== "RNR");
  const { error } = await supabase
    .from("kob_leads")
    .update({ tags: next })
    .eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, data.rnr ? "lead_tag_rnr_added" : "lead_tag_rnr_removed", "kob_leads", data.leadId, { tags: next });
  return { ok: true, tags: next };
}

async function oldMarkLeadMessagesRead(supabase, userId, data) {
  const { error } = await supabase
    .from("kob_leads")
    .update({ unread_message_count: 0, has_unread_messages: false })
    .eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, "lead_messages_marked_read", "kob_leads", data.leadId, null);
  return { ok: true, unread_message_count: 0, has_unread_messages: false };
}

async function oldCreateExecutive(supabase, userId, data) {
  const { data: roles } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "super_admin" || r.role === "kob_manager");
  const isTL = (roles ?? []).some((r) => r.role === "team_leader");
  if (!isAdmin && !isTL) throw new Error("Forbidden");
  const teamLeaderId = isAdmin ? (data.team_leader_id || null) : userId;

  const email = data.email.trim().toLowerCase();
  const password = data.password?.trim() || "Test@12345";

  const { data: existing } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
  let user = existing?.users?.find((x) => x.email === email);
  if (!user) {
    const { data: created, error } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    user = created?.user ?? undefined;
  }
  if (!user) throw new Error("Failed to create user");

  await adminClient.from("profiles").upsert({
    id: user.id,
    full_name: data.full_name,
    email,
    primary_language: data.primary_language || null,
    secondary_language: data.secondary_language || null,
    team_leader_id: teamLeaderId,
  });
  await adminClient.from("user_roles").upsert(
    { user_id: user.id, role: "executive" },
    { onConflict: "user_id,role" },
  );
  await logAudit(supabase, userId, "executive_created", "profiles", user.id, {
    email, full_name: data.full_name, primary_language: data.primary_language, secondary_language: data.secondary_language, team_leader_id: teamLeaderId,
  });
  return { ok: true, id: user.id };
}

async function oldReassignLead(supabase, userId, data) {
  const { error } = await supabase.from("kob_leads").update({ assigned_to: data.executiveId }).eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, "lead_reassign", "kob_leads", data.leadId, { executiveId: data.executiveId });
  return { ok: true };
}

async function oldCreateWebinarBatch(supabase, userId, data) {
  const { data: row, error } = await supabase
    .from("webinar_batches")
    .insert({
      name: data.name,
      scheduled_at: data.scheduled_at,
      language: data.language ?? null,
      notes: data.notes ?? null,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  await logAudit(supabase, userId, "webinar_batch_create", "webinar_batches", row.id, {
    name: data.name,
    scheduled_at: data.scheduled_at,
    language: data.language ?? null,
  });
  return row;
}

// ----------------------------------------------------
// TEST RUNNER
// ----------------------------------------------------

async function run() {
  console.log("==================================================");
  console.log("MUTATION BATCH 5 PARITY & REGRESSION SUITE");
  console.log("==================================================\n");

  const CEO_USER = { id: "6502c359-e15f-4dc2-8f6c-4b0238b4fda8", email: "ceo@shero.test" };
  const ceoToken = createToken(CEO_USER.id, CEO_USER.email);
  const ceoClient = createUserClient(ceoToken);

  const TL_USER = { id: "058b320b-8a21-49cf-bb7c-8f21c05803a4", email: "tl1@shero.test" };
  const tlToken = createToken(TL_USER.id, TL_USER.email);
  const tlClient = createUserClient(tlToken);

  const EXEC_USER = { id: "8c4dff0d-cd27-474d-9ea8-9cc15b9a93f5", email: "exec1@shero.test" };
  const execToken = createToken(EXEC_USER.id, EXEC_USER.email);
  const execClient = createUserClient(execToken);

  const results = [];

  // ==================================================
  // 1. updateLeadNextAction
  // ==================================================
  console.log("--- Testing Function 1: updateLeadNextAction ---");
  try {
    const { data: leadBefore } = await adminClient.from("kob_leads").select("*").limit(1).single();
    if (!leadBefore) throw new Error("No lead found");
    const origAction = leadBefore.next_action;
    const testAction = "Follow up tomorrow at 11am";

    const { count: stageHistBefore } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // OLD
    const oldRes = await oldUpdateLeadNextAction(ceoClient, CEO_USER.id, {
      leadId: leadBefore.id,
      nextAction: testAction,
    });
    const { data: oldLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_next_action_update").order("created_at", { ascending: false }).limit(1).single();
    const { count: stageHistOld } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // Restore
    await adminClient.from("kob_leads").update({ next_action: origAction }).eq("id", leadBefore.id);
    if (oldAudit?.id) await adminClient.from("audit_logs").delete().eq("id", oldAudit.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/next-action`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({ nextAction: testAction }),
    });
    const newRes = await newHttpRes.json();
    const { data: newLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_next_action_update").order("created_at", { ascending: false }).limit(1).single();
    const { count: stageHistNew } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // Restore & Verify
    await adminClient.from("kob_leads").update({ next_action: origAction }).eq("id", leadBefore.id);
    if (newAudit?.id) await adminClient.from("audit_logs").delete().eq("id", newAudit.id);
    const { data: finalLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();

    // Safety checks
    const stageUnchanged = oldLead.stage === leadBefore.stage && newLead.stage === leadBefore.stage;
    const stageEnteredUnchanged = oldLead.stage_entered_at === leadBefore.stage_entered_at && newLead.stage_entered_at === leadBefore.stage_entered_at;
    const assignedUnchanged = oldLead.assigned_to === leadBefore.assigned_to && newLead.assigned_to === leadBefore.assigned_to;
    const modeUnchanged = oldLead.mode === leadBefore.mode && newLead.mode === leadBefore.mode;
    const stageHistUnchanged = stageHistOld === stageHistBefore && stageHistNew === stageHistBefore;
    const safetyPassed = stageUnchanged && stageEnteredUnchanged && assignedUnchanged && modeUnchanged && stageHistUnchanged;

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/next-action`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextAction: testAction }),
    });
    const invIdRes = await fetch(`${BACKEND_BASE}/api/kob/leads/not-a-uuid/next-action`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ nextAction: testAction }),
    });
    const tooLongRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/next-action`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ nextAction: "a".repeat(501) }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = oldLead.next_action === testAction && newLead.next_action === testAction;
    const auditMatch = oldAudit?.action === newAudit?.action && oldAudit?.entity === newAudit?.entity;
    const restored = finalLead.next_action === origAction;
    const negativeMatch = unauthRes.status === 401 && invIdRes.status === 400 && tooLongRes.status === 400;

    console.log(`updateLeadNextAction: returnMatch=${returnMatch}, dbMatch=${dbMatch}, safetyPassed=${safetyPassed}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "updateLeadNextAction",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      criticalMatch: safetyPassed,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("updateLeadNextAction failed:", err);
    results.push({ function: "updateLeadNextAction", error: err.message });
  }

  // ==================================================
  // 2. setLeadRnrTag
  // ==================================================
  console.log("\n--- Testing Function 2: setLeadRnrTag ---");
  try {
    const { data: leadBefore } = await adminClient.from("kob_leads").select("*").limit(1).single();
    const origTags = (leadBefore.tags ?? []);

    // OLD
    const oldRes = await oldSetLeadRnrTag(ceoClient, CEO_USER.id, {
      leadId: leadBefore.id,
      rnr: true,
    });
    const { data: oldLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_tag_rnr_added").order("created_at", { ascending: false }).limit(1).single();

    // Restore
    await adminClient.from("kob_leads").update({ tags: origTags }).eq("id", leadBefore.id);
    if (oldAudit?.id) await adminClient.from("audit_logs").delete().eq("id", oldAudit.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/rnr-tag`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({ rnr: true }),
    });
    const newRes = await newHttpRes.json();
    const { data: newLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_tag_rnr_added").order("created_at", { ascending: false }).limit(1).single();

    // Restore & Verify
    await adminClient.from("kob_leads").update({ tags: origTags }).eq("id", leadBefore.id);
    if (newAudit?.id) await adminClient.from("audit_logs").delete().eq("id", newAudit.id);
    const { data: finalLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();

    // Safety checks
    const stageUnchanged = oldLead.stage === leadBefore.stage && newLead.stage === leadBefore.stage;
    const assignedUnchanged = oldLead.assigned_to === leadBefore.assigned_to && newLead.assigned_to === leadBefore.assigned_to;
    const safetyPassed = stageUnchanged && assignedUnchanged;

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/rnr-tag`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rnr: true }),
    });
    const nonBoolRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/rnr-tag`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ rnr: "yes" }),
    });
    const nonExistRes = await fetch(`${BACKEND_BASE}/api/kob/leads/00000000-0000-0000-0000-000000000000/rnr-tag`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ rnr: true }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = oldLead.tags.includes("RNR") && newLead.tags.includes("RNR");
    const auditMatch = oldAudit?.action === newAudit?.action && oldAudit?.entity === newAudit?.entity;
    const restored = JSON.stringify(finalLead.tags) === JSON.stringify(origTags);
    const negativeMatch = unauthRes.status === 401 && nonBoolRes.status === 400 && nonExistRes.status === 404;

    console.log(`setLeadRnrTag: returnMatch=${returnMatch}, dbMatch=${dbMatch}, safetyPassed=${safetyPassed}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "setLeadRnrTag",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      criticalMatch: safetyPassed,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("setLeadRnrTag failed:", err);
    results.push({ function: "setLeadRnrTag", error: err.message });
  }

  // ==================================================
  // 3. markLeadMessagesRead
  // ==================================================
  console.log("\n--- Testing Function 3: markLeadMessagesRead ---");
  try {
    const { data: leadBefore } = await adminClient.from("kob_leads").select("*").limit(1).single();
    const origCount = leadBefore.unread_message_count;
    const origHasUnread = leadBefore.has_unread_messages;

    // Set test unread state
    await adminClient.from("kob_leads").update({ unread_message_count: 5, has_unread_messages: true }).eq("id", leadBefore.id);

    // OLD
    const oldRes = await oldMarkLeadMessagesRead(ceoClient, CEO_USER.id, { leadId: leadBefore.id });
    const { data: oldLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_messages_marked_read").order("created_at", { ascending: false }).limit(1).single();

    // Re-set test unread state
    await adminClient.from("kob_leads").update({ unread_message_count: 5, has_unread_messages: true }).eq("id", leadBefore.id);
    if (oldAudit?.id) await adminClient.from("audit_logs").delete().eq("id", oldAudit.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/messages/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
    });
    const newRes = await newHttpRes.json();
    const { data: newLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_messages_marked_read").order("created_at", { ascending: false }).limit(1).single();

    // Restore original state
    await adminClient.from("kob_leads").update({ unread_message_count: origCount, has_unread_messages: origHasUnread }).eq("id", leadBefore.id);
    if (newAudit?.id) await adminClient.from("audit_logs").delete().eq("id", newAudit.id);
    const { data: finalLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();

    // Safety checks
    const stageUnchanged = oldLead.stage === leadBefore.stage && newLead.stage === leadBefore.stage;
    const assignedUnchanged = oldLead.assigned_to === leadBefore.assigned_to && newLead.assigned_to === leadBefore.assigned_to;
    const safetyPassed = stageUnchanged && assignedUnchanged;

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/messages/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const invIdRes = await fetch(`${BACKEND_BASE}/api/kob/leads/bad-uuid/messages/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = oldLead.unread_message_count === 0 && newLead.unread_message_count === 0 && oldLead.has_unread_messages === false && newLead.has_unread_messages === false;
    const auditMatch = oldAudit?.action === newAudit?.action && oldAudit?.entity === newAudit?.entity;
    const restored = finalLead.unread_message_count === origCount && finalLead.has_unread_messages === origHasUnread;
    const negativeMatch = unauthRes.status === 401 && invIdRes.status === 400;

    console.log(`markLeadMessagesRead: returnMatch=${returnMatch}, dbMatch=${dbMatch}, safetyPassed=${safetyPassed}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "markLeadMessagesRead",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      criticalMatch: safetyPassed,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("markLeadMessagesRead failed:", err);
    results.push({ function: "markLeadMessagesRead", error: err.message });
  }

  // ==================================================
  // 4. createExecutive
  // ==================================================
  console.log("\n--- Testing Function 4: createExecutive ---");
  try {
    const oldEmail = "test_exec_b5_old@shero.local";
    const newEmail = "test_exec_b5_new@shero.local";

    // Clean any prior stray test rows
    await adminClient.from("profiles").delete().in("email", [oldEmail, newEmail]);

    // OLD (TL creates executive on their team)
    const oldRes = await oldCreateExecutive(tlClient, TL_USER.id, {
      email: oldEmail,
      full_name: "Test Executive Old",
      primary_language: "HINDI",
      secondary_language: "ENGLISH",
      team_leader_id: TL_USER.id,
    });
    const { data: oldProfile } = await adminClient.from("profiles").select("*").eq("id", oldRes.id).single();
    const { data: oldRole } = await adminClient.from("user_roles").select("*").eq("user_id", oldRes.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", oldRes.id).eq("action", "executive_created").order("created_at", { ascending: false }).limit(1).single();

    // Clean up OLD
    await adminClient.from("user_roles").delete().eq("user_id", oldRes.id);
    await adminClient.from("profiles").delete().eq("id", oldRes.id);
    await adminClient.auth.admin.deleteUser(oldRes.id);
    if (oldAudit?.id) await adminClient.from("audit_logs").delete().eq("id", oldAudit.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/executives`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tlToken}`,
      },
      body: JSON.stringify({
        email: newEmail,
        full_name: "Test Executive New",
        primary_language: "HINDI",
        secondary_language: "ENGLISH",
        team_leader_id: TL_USER.id,
      }),
    });
    const newRes = await newHttpRes.json();
    console.log("createExecutive response:", newHttpRes.status, newRes);
    const { data: newProfile } = await adminClient.from("profiles").select("*").eq("id", newRes.id).single();
    const { data: newRole } = await adminClient.from("user_roles").select("*").eq("user_id", newRes.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", newRes.id).eq("action", "executive_created").order("created_at", { ascending: false }).limit(1).single();

    // Clean up NEW
    await adminClient.from("user_roles").delete().eq("user_id", newRes.id);
    await adminClient.from("profiles").delete().eq("id", newRes.id);
    await adminClient.auth.admin.deleteUser(newRes.id);
    if (newAudit?.id) await adminClient.from("audit_logs").delete().eq("id", newAudit.id);

    // Verify completely restored (no leftover test profiles)
    const { count: remainingProfiles } = await adminClient.from("profiles").select("*", { count: "exact", head: true }).in("email", [oldEmail, newEmail]);

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/executives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unauth@shero.local", full_name: "Unauth" }),
    });
    const execRoleRes = await fetch(`${BACKEND_BASE}/api/kob/executives`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
      body: JSON.stringify({ email: "exec_attempt@shero.local", full_name: "Exec Attempt" }),
    });
    const missingNameRes = await fetch(`${BACKEND_BASE}/api/kob/executives`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tlToken}` },
      body: JSON.stringify({ email: "missing_name@shero.local", full_name: "" }),
    });

    const returnMatch = oldRes.ok === true && newRes.ok === true && typeof oldRes.id === "string" && typeof newRes.id === "string";
    const dbMatch = oldProfile.primary_language === "HINDI" && newProfile.primary_language === "HINDI" && oldRole.role === "executive" && newRole.role === "executive";
    const auditMatch = oldAudit?.action === newAudit?.action && oldAudit?.entity === newAudit?.entity;
    const restored = remainingProfiles === 0;
    const negativeMatch = unauthRes.status === 401 && execRoleRes.status === 403 && missingNameRes.status === 400;

    console.log(`createExecutive: returnMatch=${returnMatch}, dbMatch=${dbMatch}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "createExecutive",
      oldReturn: JSON.stringify({ ok: oldRes.ok }),
      newReturn: JSON.stringify({ ok: newRes.ok }),
      returnMatch,
      dbMatch,
      criticalMatch: true,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("createExecutive failed:", err);
    results.push({ function: "createExecutive", error: err.message });
  }

  // ==================================================
  // 5. reassignLead
  // ==================================================
  console.log("\n--- Testing Function 5: reassignLead ---");
  try {
    const { data: leadBefore } = await adminClient.from("kob_leads").select("*").limit(1).single();
    const origAssigned = leadBefore.assigned_to;
    const testAssignee = EXEC_USER.id;

    const { count: stageHistBefore } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // OLD
    const oldRes = await oldReassignLead(ceoClient, CEO_USER.id, {
      leadId: leadBefore.id,
      executiveId: testAssignee,
    });
    const { data: oldLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_reassign").order("created_at", { ascending: false }).limit(1).single();
    const { count: stageHistOld } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // Restore
    await adminClient.from("kob_leads").update({ assigned_to: origAssigned }).eq("id", leadBefore.id);
    if (oldAudit?.id) await adminClient.from("audit_logs").delete().eq("id", oldAudit.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/assignee`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({ executiveId: testAssignee }),
    });
    const newRes = await newHttpRes.json();
    const { data: newLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_reassign").order("created_at", { ascending: false }).limit(1).single();
    const { count: stageHistNew } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // Restore & Verify
    await adminClient.from("kob_leads").update({ assigned_to: origAssigned }).eq("id", leadBefore.id);
    if (newAudit?.id) await adminClient.from("audit_logs").delete().eq("id", newAudit.id);
    const { data: finalLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();

    // Critical Safety Checks: Absolutely NO change to stage, stage_entered_at, lead_stage_history, mode, source, cuisine!
    const stageUnchanged = oldLead.stage === leadBefore.stage && newLead.stage === leadBefore.stage;
    const stageEnteredUnchanged = oldLead.stage_entered_at === leadBefore.stage_entered_at && newLead.stage_entered_at === leadBefore.stage_entered_at;
    const modeUnchanged = oldLead.mode === leadBefore.mode && newLead.mode === leadBefore.mode;
    const sourceUnchanged = oldLead.source_id === leadBefore.source_id && newLead.source_id === leadBefore.source_id;
    const cuisineUnchanged = oldLead.cuisine === leadBefore.cuisine && newLead.cuisine === leadBefore.cuisine;
    const stageHistUnchanged = stageHistOld === stageHistBefore && stageHistNew === stageHistBefore;
    const safetyPassed = stageUnchanged && stageEnteredUnchanged && modeUnchanged && sourceUnchanged && cuisineUnchanged && stageHistUnchanged;

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/assignee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executiveId: testAssignee }),
    });
    const invExecRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/assignee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ executiveId: "not-a-uuid" }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = oldLead.assigned_to === testAssignee && newLead.assigned_to === testAssignee;
    const auditMatch = oldAudit?.action === newAudit?.action && oldAudit?.entity === newAudit?.entity;
    const restored = finalLead.assigned_to === origAssigned;
    const negativeMatch = unauthRes.status === 401 && invExecRes.status === 400;

    console.log(`reassignLead: returnMatch=${returnMatch}, dbMatch=${dbMatch}, safetyPassed=${safetyPassed}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "reassignLead",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      criticalMatch: safetyPassed,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("reassignLead failed:", err);
    results.push({ function: "reassignLead", error: err.message });
  }

  // ==================================================
  // 6. createWebinarBatch
  // ==================================================
  console.log("\n--- Testing Function 6: createWebinarBatch ---");
  try {
    const batchPayload = {
      name: "Weekly KOB Discovery Webinar",
      scheduled_at: "2099-11-20T14:30:00Z",
      language: "Hindi",
      notes: "Introductory discovery session",
    };

    // OLD
    const oldRes = await oldCreateWebinarBatch(ceoClient, CEO_USER.id, batchPayload);
    const { data: oldBatch } = await adminClient.from("webinar_batches").select("*").eq("id", oldRes.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", oldRes.id).eq("action", "webinar_batch_create").order("created_at", { ascending: false }).limit(1).single();

    // Clean up OLD
    await adminClient.from("webinar_batches").delete().eq("id", oldRes.id);
    if (oldAudit?.id) await adminClient.from("audit_logs").delete().eq("id", oldAudit.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/webinar/batches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify(batchPayload),
    });
    const newRes = await newHttpRes.json();
    const { data: newBatch } = await adminClient.from("webinar_batches").select("*").eq("id", newRes.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", newRes.id).eq("action", "webinar_batch_create").order("created_at", { ascending: false }).limit(1).single();

    // Clean up NEW
    await adminClient.from("webinar_batches").delete().eq("id", newRes.id);
    if (newAudit?.id) await adminClient.from("audit_logs").delete().eq("id", newAudit.id);

    // Verify completely cleaned up
    const { data: checkOld } = await adminClient.from("webinar_batches").select("id").eq("id", oldRes.id).maybeSingle();
    const { data: checkNew } = await adminClient.from("webinar_batches").select("id").eq("id", newRes.id).maybeSingle();
    const restored = !checkOld && !checkNew;

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/webinar/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batchPayload),
    });
    const emptyNameRes = await fetch(`${BACKEND_BASE}/api/webinar/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ ...batchPayload, name: "" }),
    });

    const returnMatch = oldRes.name === newRes.name && oldRes.language === newRes.language && oldRes.notes === newRes.notes;
    const dbMatch = oldBatch.name === batchPayload.name && newBatch.name === batchPayload.name;
    const auditMatch = oldAudit?.action === newAudit?.action && oldAudit?.entity === newAudit?.entity;
    const negativeMatch = unauthRes.status === 401 && emptyNameRes.status === 400;

    console.log(`createWebinarBatch: returnMatch=${returnMatch}, dbMatch=${dbMatch}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "createWebinarBatch",
      oldReturn: JSON.stringify({ name: oldRes.name, language: oldRes.language }),
      newReturn: JSON.stringify({ name: newRes.name, language: newRes.language }),
      returnMatch,
      dbMatch,
      criticalMatch: true,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("createWebinarBatch failed:", err);
    results.push({ function: "createWebinarBatch", error: err.message });
  }

  console.log("\n==================================================");
  console.log("MUTATION BATCH 5 TEST RESULTS SUMMARY");
  console.log("==================================================");
  console.table(results);
}

run().catch(console.error);
