import { createClient } from "@supabase/supabase-js";
import { loadTestEnv } from "../test-env.mjs";

const env = loadTestEnv();
const c = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: cols } = await c.from("information_schema.columns")
    .select("column_name, data_type")
    .eq("table_name", "kob_leads");
  
  // Let's test what triggers exist by doing a select or reading migrations/triggers
  const { data, error } = await c.from("lead_stage_history").select("*").limit(3);
  console.log("lead_stage_history sample:", data, error);

  const { data: act, error: aErr } = await c.from("lead_activities").select("*").limit(3);
  console.log("lead_activities sample:", act, aErr);
}
main();
