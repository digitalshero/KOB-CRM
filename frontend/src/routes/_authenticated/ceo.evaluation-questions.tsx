import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { QuestionType } from "@/lib/types";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, Save, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ceo/evaluation-questions")({
  head: () => ({ meta: [{ title: "Evaluation Questions — Shero KOB" }] }),
  beforeLoad: async () => {
    const r = await apiClient.get<any>("/api/kob/my-role");
    if (r.role !== "super_admin" && r.role !== "kob_manager") {
      throw redirect({ to: "/exe/overview" });
    }
  },
  component: EvaluationQuestionsPage,
});

const TYPES: { value: QuestionType; label: string }[] = [
  { value: "SCALE_1_5", label: "Scale 1–5" },
  { value: "YES_NO", label: "Yes / No" },
  { value: "TEXT", label: "Text (qualitative)" },
];

function EvaluationQuestionsPage() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["eval-questions"],
    queryFn: () => apiClient.get<any[]>("/api/evaluation/questions"),
  });


  const [draft, setDraft] = useState({ question_text: "", weight: 10, question_type: "SCALE_1_5" as QuestionType, sort_order: 0 });
  const [editing, setEditing] = useState<Record<string, any>>({});

  const totalWeight = (data as any[])
    .filter((q) => q.active && q.question_type !== "TEXT")
    .reduce((s, q) => s + Number(q.weight ?? 0), 0);

  const add = async () => {
    if (!draft.question_text.trim()) return toast.error("Question text required");
    try {
      await apiClient.post("/api/evaluation/questions", draft);
      toast.success("Question added");
      setDraft({ question_text: "", weight: 10, question_type: "SCALE_1_5", sort_order: (data as any[]).length });
      qc.invalidateQueries();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const save = async (q: any) => {
    const patch = editing[q.id] ?? {};
    try {
      await apiClient.post("/api/evaluation/questions", { id: q.id, question_text: patch.question_text ?? q.question_text, weight: Number(patch.weight ?? q.weight), question_type: (patch.question_type ?? q.question_type) as QuestionType, active: patch.active ?? q.active, sort_order: Number(patch.sort_order ?? q.sort_order) });
      toast.success("Saved");
      setEditing((e) => { const { [q.id]: _, ...rest } = e; return rest; });
      qc.invalidateQueries();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this question?")) return;
    try { await apiClient.delete(`/api/evaluation/questions/${id}`); toast.success("Deleted"); qc.invalidateQueries(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kitchen Partner Evaluation Questions</h1>
          <p className="text-sm text-muted-foreground">Manager configures questions and their weights. Only SCALE and YES/NO questions contribute to the score.</p>
        </div>
        <Badge variant="secondary" className="text-base px-3 py-1">
          Total scored weight: <span className="font-bold ml-1">{totalWeight}</span>
        </Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Add question</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-[1fr_100px_160px_100px_120px] gap-2 items-end">
          <div>
            <label className="text-xs uppercase text-muted-foreground">Question</label>
            <Input value={draft.question_text} onChange={(e) => setDraft({ ...draft, question_text: e.target.value })} placeholder="e.g. Is the kitchen space compliant?" />
          </div>
          <div>
            <label className="text-xs uppercase text-muted-foreground">Weight</label>
            <Input type="number" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs uppercase text-muted-foreground">Type</label>
            <select className="w-full border rounded px-2 py-2 text-sm" value={draft.question_type} onChange={(e) => setDraft({ ...draft, question_type: e.target.value as QuestionType })}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-muted-foreground">Sort</label>
            <Input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} />
          </div>
          <Button onClick={add}><Plus className="w-4 h-4 mr-1" /> Add</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Questions ({(data as any[]).length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2 text-left">Sort</th>
                <th className="p-2 text-left">Question</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Weight</th>
                <th className="p-2 text-left">Active</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(data as any[]).length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No questions yet</td></tr>
              )}
              {(data as any[]).map((q) => {
                const e = editing[q.id] ?? {};
                const dirty = Object.keys(e).length > 0;
                return (
                  <tr key={q.id} className="border-t align-top">
                    <td className="p-2 w-16"><Input type="number" className="h-8" defaultValue={q.sort_order} onChange={(ev) => setEditing((s) => ({ ...s, [q.id]: { ...s[q.id], sort_order: Number(ev.target.value) } }))} /></td>
                    <td className="p-2"><Input className="h-8" defaultValue={q.question_text} onChange={(ev) => setEditing((s) => ({ ...s, [q.id]: { ...s[q.id], question_text: ev.target.value } }))} /></td>
                    <td className="p-2 w-40">
                      <select className="w-full border rounded px-2 py-1 text-sm h-8" defaultValue={q.question_type} onChange={(ev) => setEditing((s) => ({ ...s, [q.id]: { ...s[q.id], question_type: ev.target.value } }))}>
                        {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="p-2 w-24"><Input type="number" className="h-8" defaultValue={q.weight} onChange={(ev) => setEditing((s) => ({ ...s, [q.id]: { ...s[q.id], weight: Number(ev.target.value) } }))} /></td>
                    <td className="p-2 w-20">
                      <input type="checkbox" defaultChecked={q.active} onChange={(ev) => setEditing((s) => ({ ...s, [q.id]: { ...s[q.id], active: ev.target.checked } }))} />
                    </td>
                    <td className="p-2 w-32 text-right space-x-1">
                      <Button size="sm" variant={dirty ? "default" : "outline"} onClick={() => save(q)}><Save className="w-3 h-3 mr-1" />Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(q.id)}><Trash2 className="w-3 h-3" /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
