/**
 * Shared audit-log helper used by all endpoints that write business data.
 * Keeps the insert shape consistent with src/lib/audit.ts.
 */
export async function logAudit(
  supabase: any,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta: any = null,
) {
  try {
    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action,
      entity,
      entity_id: entityId,
      meta,
    });
  } catch {
    // audit failure must never break the primary write
  }
}
