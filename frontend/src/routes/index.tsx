import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getRdsToken } from "@/lib/api-client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" as any });
    // Parallel RDS/JWT auth: no Supabase session, but a backend-issued JWT
    // from /api/auth/login may still be present — same hybrid check as
    // _authenticated/route.tsx. Without this, an RDS-only session was being
    // bounced straight back to /auth on every visit to "/".
    if (getRdsToken()) throw redirect({ to: "/dashboard" as any });
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});

