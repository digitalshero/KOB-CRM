// Shared inbound-lead synchronisation used by the Gallabox webhooks.
// Guarantees that any valid inbound KOB contact (template trigger or KOB Sales
// WhatsApp message) has a corresponding row in public.kob_leads, without ever
// creating a duplicate. Phone (last 10 digits) is the matching key, matching
// the CRM's existing normalisation rules.

export function phoneTail(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D+/g, "").slice(-10);
}

const LANGUAGE_MAP: Record<string, string> = {
  tamil: "TAMIL",
  telugu: "TELUGU",
  malayalam: "MALAYALAM",
  hindi: "HINDI",
  bengali: "BENGALI",
  english: "ENGLISH",
  kannada: "KANNADA",
  marathi: "MARATHI",
  gujarati: "GUJARATI",
  others: "OTHERS",
  other: "OTHERS",
};

export type EnsureLeadInput = {
  phone: string;
  name?: string | null;
  language?: string | null;
  sourceName?: string | null;
  origin: string;
};

export type EnsureLeadResult = {
  leadId: string | null;
  stage: string | null;
  created: boolean;
  error?: string;
};

async function findLeadByPhone(supabaseAdmin: any, tail: string) {
  const { data } = await supabaseAdmin
    .from("kob_leads")
    .select("id, phone, stage, created_at")
    .ilike("phone", `%${tail}`)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []).find((l: any) => phoneTail(l.phone) === tail) ?? null;
}

/**
 * Find-or-create a lead for an inbound phone number. Idempotent: repeated
 * webhook deliveries (in any order) resolve to the same single lead.
 */
export async function ensureLeadByPhone(
  supabaseAdmin: any,
  input: EnsureLeadInput,
): Promise<EnsureLeadResult> {
  const tail = phoneTail(input.phone);
  if (tail.length < 10) {
    return { leadId: null, stage: null, created: false, error: "phone_too_short" };
  }

  const existing = await findLeadByPhone(supabaseAdmin, tail);
  if (existing) return { leadId: existing.id, stage: existing.stage, created: false };

  // Resolve source (falls back to null; the lead is still created).
  let source_id: string | null = null;
  const sourceName = (input.sourceName ?? "").trim();
  if (sourceName) {
    const { data: src } = await supabaseAdmin
      .from("lead_sources")
      .select("id")
      .ilike("name", sourceName)
      .maybeSingle();
    source_id = src?.id ?? null;
  }

  const language = input.language
    ? (LANGUAGE_MAP[input.language.trim().toLowerCase()] ?? null)
    : null;

  const fullName = (input.name ?? "").trim() || `WhatsApp Lead ${tail}`;
  const phone = input.phone.trim();

  // Generate the next IND-##### code; retry on collision (concurrent webhooks).
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: last } = await supabaseAdmin
      .from("kob_leads")
      .select("code")
      .like("code", "IND-%")
      .order("code", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    const m = /^IND-(\d+)$/.exec(last?.code ?? "");
    if (m) nextNum = parseInt(m[1], 10) + 1;
    const code = `IND-${String(nextNum + attempt).padStart(5, "0")}`;

    const { data: inserted, error } = await supabaseAdmin
      .from("kob_leads")
      .insert({
        code,
        full_name: fullName,
        phone,
        source_id,
        stage: "LEAD_INBOX",
        notes: `Auto-created from ${input.origin}`,
        ...(language ? { language } : {}),
      })
      .select("id, stage")
      .single();

    if (!error && inserted) {
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: null,
        action: "INBOUND_LEAD_AUTO_CREATED",
        entity: "kob_leads",
        entity_id: inserted.id,
        meta: { origin: input.origin, phone, code, source: sourceName || null, language },
      });
      return { leadId: inserted.id, stage: inserted.stage, created: true };
    }

    if (error && /duplicate key/i.test(error.message)) {
      // Either the code raced, or another delivery created the lead already.
      const raced = await findLeadByPhone(supabaseAdmin, tail);
      if (raced) return { leadId: raced.id, stage: raced.stage, created: false };
      continue;
    }

    return { leadId: null, stage: null, created: false, error: error?.message ?? "insert_failed" };
  }

  const raced = await findLeadByPhone(supabaseAdmin, tail);
  if (raced) return { leadId: raced.id, stage: raced.stage, created: false };
  return { leadId: null, stage: null, created: false, error: "code_generation_failed" };
}
