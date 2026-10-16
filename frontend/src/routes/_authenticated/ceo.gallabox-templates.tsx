import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";

const LANGUAGES = ["TAMIL","TELUGU","MALAYALAM","HINDI","BENGALI","ENGLISH","KANNADA","MARATHI","GUJARATI","OTHERS"];
const BUCKETS = ["NO", "LATER", "NO_RESPONSE"] as const;
type Category = "ONBOARDING" | "RETARGETING" | "WEBINAR_DEFAULTER";
type Bucket = typeof BUCKETS[number];

export const Route = createFileRoute("/_authenticated/ceo/gallabox-templates")({
  head: () => ({ meta: [{ title: "Gallabox Templates — Shero KOB" }] }),
  component: CeoGallaboxTemplates,
});

function CeoGallaboxTemplates() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["gbx"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-gallabox-templates"),
  });
  const [draft, setDraft] = useState<{
    name: string; body: string; language: string; active: boolean;
    category: Category; bucket: Bucket | "";
    email_subject: string; email_body: string;
  }>({ name: "", body: "", language: "ENGLISH", active: true, category: "ONBOARDING", bucket: "", email_subject: "", email_body: "" });

  const rows = (data as any[]).slice().sort((a, b) => {
    const order: Record<string, number> = { ONBOARDING: 0, RETARGETING: 1, WEBINAR_DEFAULTER: 2 };
    if (a.category !== b.category) return (order[a.category] ?? 99) - (order[b.category] ?? 99);
    const ab = (a.bucket ?? ""), bb = (b.bucket ?? "");
    if (ab !== bb) return ab.localeCompare(bb);
    return (a.language ?? "").localeCompare(b.language ?? "");
  });
  const onboarding = rows.filter((r) => r.category === "ONBOARDING");
  const retargeting = rows.filter((r) => r.category === "RETARGETING");
  const defaulters = rows.filter((r) => r.category === "WEBINAR_DEFAULTER");

  const coverage = useMemo(() => {
    return BUCKETS.map((b) => {
      const langs = new Set(retargeting.filter((r) => r.bucket === b && r.active).map((r) => r.language));
      const missing = LANGUAGES.filter((l) => !langs.has(l));
      return { bucket: b, covered: langs.size, missing };
    });
  }, [retargeting]);

  const save = async () => {
    if (!draft.name || !draft.body) return toast.error("Name and body required");
    if (draft.category === "RETARGETING" && !draft.bucket) return toast.error("Bucket required for retargeting templates");
    const hasSubj = draft.email_subject.trim().length > 0;
    const hasBody = draft.email_body.trim().length > 0;
    if (hasSubj !== hasBody) return toast.error("Email fallback needs both subject and body (or leave both empty)");
    try {
      await apiClient.post("/api/kob/gallabox-templates", {
        name: draft.name, body: draft.body, language: draft.language, active: draft.active,
        category: draft.category, bucket: draft.category === "RETARGETING" ? (draft.bucket as Bucket) : null,
        email_subject: hasSubj ? draft.email_subject : null,
        email_body: hasBody ? draft.email_body : null,
      });
      toast.success("Template saved");
      setDraft({ name: "", body: "", language: "ENGLISH", active: true, category: "ONBOARDING", bucket: "", email_subject: "", email_body: "" });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  };

  const renderTable = (list: any[], showBucket: boolean) => (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
        <tr>
          <th className="p-2">Name</th>
          {showBucket && <th className="p-2">Bucket</th>}
          <th className="p-2">Language</th>
          <th className="p-2">Channels</th>
          <th className="p-2">Active</th>
        </tr>
      </thead>
      <tbody>
        {list.length === 0 && (
          <tr><td colSpan={showBucket ? 5 : 4} className="p-4 text-center text-muted-foreground">No templates yet</td></tr>
        )}
        {list.map((t: any) => {
          const emailReady = !!(t.email_subject && t.email_body);
          return (
            <tr key={t.id} className="border-b align-top">
              <td className="p-2 font-medium">{t.name}<div className="text-xs text-muted-foreground truncate max-w-xs">{t.body}</div></td>
              {showBucket && <td className="p-2"><Badge variant="outline">{t.bucket ?? "—"}</Badge></td>}
              <td className="p-2">{t.language}</td>
              <td className="p-2">
                <div className="flex gap-1 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">WhatsApp</Badge>
                  {emailReady && <Badge className="bg-shero-mint text-shero-navy hover:bg-shero-mint text-[10px]">Email Ready</Badge>}
                </div>
              </td>
              <td className="p-2">{t.active ? "Yes" : "No"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Gallabox Templates</h1>
        <p className="text-sm text-muted-foreground">WhatsApp templates for AUTO-mode lead fires and retargeting. Matched by category × bucket × language.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Onboarding templates ({onboarding.length})</CardTitle></CardHeader>
            <CardContent className="p-0">{renderTable(onboarding, false)}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Retargeting templates ({retargeting.length})</CardTitle>
              <div className="flex flex-col gap-1 pt-2">
                {coverage.map((c) => (
                  <div key={c.bucket} className="text-xs flex items-center gap-2 flex-wrap">
                    <Badge variant={c.covered === LANGUAGES.length ? "default" : "destructive"}>{c.bucket}</Badge>
                    <span className="text-muted-foreground">{c.covered} of {LANGUAGES.length} languages covered</span>
                    {c.missing.length > 0 && (
                      <span className="text-muted-foreground">· missing: {c.missing.join(", ")}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">{renderTable(retargeting, true)}</CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Webinar defaulter templates ({defaulters.length})</CardTitle></CardHeader>
            <CardContent className="p-0">{renderTable(defaulters, false)}</CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">New Template</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs uppercase text-muted-foreground">Category</label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {(["ONBOARDING", "RETARGETING", "WEBINAR_DEFAULTER"] as Category[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setDraft({ ...draft, category: c, bucket: c === "RETARGETING" ? draft.bucket : "" })}
                    className={`px-3 py-1.5 rounded text-sm border ${draft.category === c ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                  >{c}</button>
                ))}
              </div>
            </div>

            {draft.category === "RETARGETING" && (
              <div>
                <label className="text-xs uppercase text-muted-foreground">Bucket *</label>
                <select className="w-full border rounded px-2 py-1 text-sm mt-1" value={draft.bucket} onChange={(e) => setDraft({ ...draft, bucket: e.target.value as Bucket })}>
                  <option value="">Select bucket…</option>
                  {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs uppercase text-muted-foreground">Name</label>
              <Input placeholder="template_name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>

            <div>
              <label className="text-xs uppercase text-muted-foreground">Body</label>
              <Textarea placeholder="Message content" rows={4} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </div>

            <div>
              <label className="text-xs uppercase text-muted-foreground">Language</label>
              <select className="w-full border rounded px-2 py-1 text-sm mt-1" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="text-xs uppercase text-muted-foreground font-medium">Email Fallback (optional)</div>
              <p className="text-[11px] text-muted-foreground -mt-1">Fill both fields to enable email as a fallback channel alongside WhatsApp. Leave both blank for WhatsApp-only.</p>
              <div>
                <label className="text-xs text-muted-foreground">Email Subject</label>
                <Input placeholder="Welcome to Shero Home Food" value={draft.email_subject} onChange={(e) => setDraft({ ...draft, email_subject: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Email Body</label>
                <Textarea placeholder="Email message content" rows={4} value={draft.email_body} onChange={(e) => setDraft({ ...draft, email_body: e.target.value })} />
              </div>
            </div>

            <Button onClick={save} className="w-full">Save template</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
