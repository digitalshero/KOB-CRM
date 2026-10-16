import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Mail, Lock, ArrowRight, Check, ShieldCheck } from "lucide-react";
import sheroLogo from "@/assets/shero-logo-mark.png";
import sheroChef from "@/assets/shero-chef-cutout.png";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — Shero KOB" }] }),
  component: AuthPage,
});

const HIGHLIGHTS = [
  "End-to-end lead pipeline, from inbox to KTN Live",
  "Executive, team and brand performance in one view",
  "Leads synced straight to Zoho CRM",
];

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Signed in");
    navigate({ to: "/" });
  };

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Left panel — brand */}
      <div
        className="hidden md:flex md:w-1/2 lg:w-[55%] flex-col justify-between p-10 lg:p-14 text-white relative overflow-hidden bg-gradient-to-br from-[#008E89] via-[#006B67] to-[#005B57]"
      >
        {/* Decorative dotted grid + a single accent dot, reference-style */}
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
          aria-hidden
        />
        <svg className="pointer-events-none absolute top-6 right-10 h-40 w-40 text-white/15" viewBox="0 0 160 160" fill="none" aria-hidden>
          <path d="M8 120C8 60 60 8 120 8" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="120" cy="8" r="5" className="text-white/40" fill="currentColor" />
        </svg>

        <img
          src={sheroChef}
          alt=""
          aria-hidden
          className="pointer-events-none select-none absolute right-0 bottom-0 h-[82%] max-h-[500px] w-auto max-w-[46%] object-contain object-bottom drop-shadow-2xl"
        />

        <div className="relative flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-full overflow-hidden ring-1 ring-white/30 bg-white">
            <img src={sheroLogo} alt="Shero" className="h-full w-full object-cover" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold">Shero Home Food</div>
            <div className="text-xs text-white/65">KOB Admin Dashboard</div>
          </div>
        </div>

        <div className="relative max-w-[280px] lg:max-w-xs space-y-4">
          <span className="inline-flex items-center rounded-full bg-white/10 ring-1 ring-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/85">
            KOB Control Tower
          </span>
          <h1 className="text-3xl lg:text-4xl font-bold leading-tight tracking-tight">
            Kitchen onboarding,<br /><span className="text-white/70">under control.</span>
          </h1>
          <p className="text-white/75 text-sm leading-relaxed">
            Track every lead from first contact to a live kitchen — stages, assignment, retargeting and performance in one control tower.
          </p>
          <ul className="space-y-2.5 pt-2">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-center gap-2.5 text-sm text-white/90">
                <span className="h-5 w-5 shrink-0 rounded-full bg-white flex items-center justify-center">
                  <Check className="h-3 w-3 text-[#006B67]" strokeWidth={3} />
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-xs text-white/60">&copy; Shero Home Food</div>
      </div>

      {/* Right panel — sign in */}
      <div className="flex-1 flex items-center justify-center bg-background p-6 overflow-y-auto">
        <div className="w-full max-w-sm">
          {/* Logo shown only on small screens, where the brand panel is hidden */}
          <div className="md:hidden flex items-center gap-2.5 mb-6">
            <div className="h-9 w-9 shrink-0 rounded-lg overflow-hidden ring-1 ring-border bg-white">
              <img src={sheroLogo} alt="Shero" className="h-full w-full object-cover" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-sm">Shero Home Food</div>
              <div className="text-xs text-muted-foreground">KOB CRM</div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-[0_8px_30px_rgba(0,70,65,0.08)] p-8">
            <div className="h-11 w-11 rounded-xl bg-shero-mint flex items-center justify-center mb-4">
              <Lock className="h-5 w-5 text-shero-teal-deep" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-6">Sign in to continue to the dashboard.</p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="you@sherohomefood.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 pl-9"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 pl-9 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full h-12 gap-1.5 rounded-xl text-base shadow-[0_6px_18px_rgba(0,107,103,0.25)]" disabled={loading}>
                {loading ? "Signing in..." : <>Sign in <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </form>
          </div>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Authorised staff only. All actions are logged.
          </p>
        </div>
      </div>
    </div>
  );
}
