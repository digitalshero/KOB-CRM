import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type QuestionType, type MyRoleResponse } from "@/lib/types";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Search, Plus } from "lucide-react";

export function KpEvaluationPage() {
  const qc = useQueryClient();

  const { data: roleData } = useQuery({
    queryKey: ["my-role"],
    queryFn: () => apiClient.get<MyRoleResponse>("/api/kob/my-role"),
  });
  const canManageQuestions = roleData?.role === "super_admin" || roleData?.role === "kob_manager" || roleData?.role === "team_leader";
  const [newQ, setNewQ] = useState({ question_text: "", weight: 10, question_type: "SCALE_1_5" as QuestionType });
  const [showAdd, setShowAdd] = useState(false);

  const addQuestion = async () => {
    if (!newQ.question_text.trim()) return toast.error("Question text required");
    try {
      await apiClient.post("/api/evaluation/questions", { ...newQ, sort_order: (questions as any[]).length });
      toast.success("Question added");
      setNewQ({ question_text: "", weight: 10, question_type: "SCALE_1_5" });
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["eval-questions"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const [leadId, setLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [answers, setAnswers] = useState<Record<string, { value: number | null; text: string | null }>>({});

  const { data: questions = [] } = useQuery({
    queryKey: ["eval-questions"],
    queryFn: () => apiClient.get<any[]>("/api/evaluation/questions"),
  });
  const { data: leads = [] } = useQuery({
    queryKey: ["eval-leads"],
    queryFn: () => apiClient.get<any[]>("/api/evaluation/leads"),
  });
  const { data: evalData } = useQuery({
    queryKey: ["eval-lead", leadId],
    queryFn: () => apiClient.get<any>(`/api/evaluation/lead?lead_id=${encodeURIComponent(leadId!)}`),
    enabled: !!leadId,
  });

  const activeQs = useMemo(() => (questions as any[]).filter((q) => q.active), [questions]);

  const currentAnswers = useMemo(() => {
    const map: Record<string, { value: number | null; text: string | null }> = {};
    (evalData?.responses ?? []).forEach((r: any) => {
      map[r.question_id] = { value: r.answer_value, text: r.answer_text };
    });
    return { ...map, ...answers };
  }, [evalData, answers]);

  const filteredLeads = (leads as any[]).filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return l.full_name?.toLowerCase().includes(s) || l.code?.toLowerCase().includes(s) || l.phone?.includes(s);
  });

  const setAns = (qid: string, patch: Partial<{ value: number | null; text: string | null }>) => {
    setAnswers((a) => {
      const prev = a[qid] ?? currentAnswers[qid] ?? { value: null, text: null };
      return { ...a, [qid]: { ...prev, ...patch } };
    });
  };

  const submit = async () => {
    if (!leadId) return toast.error("Pick a lead first");
    const rows = activeQs.map((q: any) => {
      const cur = currentAnswers[q.id] ?? { value: null, text: null };
      return {
        question_id: q.id,
        answer_value: q.question_type === "TEXT" ? null : (cur.value ?? null),
        answer_text: cur.text ?? null,
      };
    }).filter((r) => r.answer_value !== null || (r.answer_text && r.answer_text.trim().length > 0));
    if (rows.length === 0) return toast.error("Answer at least one question");
    try {
      const res: any = await apiClient.post("/api/evaluation/responses", { lead_id: leadId, answers: rows });
      toast.success(`Saved. Score: ${res?.score?.total_score ?? "—"}`);
      setAnswers({});
      qc.invalidateQueries({ queryKey: ["eval-lead", leadId] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const selectedLead = (leads as any[]).find((l) => l.id === leadId);

  return (
    <div className="p-6 grid md:grid-cols-[320px_1fr] gap-6">
      <Card className="h-fit sticky top-4">
        <CardHeader>
          <CardTitle className="text-base">Pick a lead</CardTitle>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder="Search name / code / phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0 max-h-[70vh] overflow-y-auto">
          {filteredLeads.length === 0 && <div className="p-4 text-sm text-muted-foreground text-center">No leads</div>}
          {filteredLeads.map((l) => (
            <button key={l.id} onClick={() => { setLeadId(l.id); setAnswers({}); }}
              className={`w-full text-left p-2 border-b hover:bg-muted/40 ${leadId === l.id ? "bg-muted" : ""}`}>
              <div className="font-medium text-sm">{l.full_name}</div>
              <div className="text-xs text-muted-foreground font-mono">{l.code}</div>
              <div className="text-xs text-muted-foreground">{l.stage} · {l.language}</div>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!leadId && <div className="text-muted-foreground text-sm">Select a lead on the left to fill the evaluation form.</div>}
        {leadId && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">{selectedLead?.full_name} · <span className="font-mono text-sm">{selectedLead?.code}</span></CardTitle>
                  <p className="text-xs text-muted-foreground">Stage: {selectedLead?.stage} · Language: {selectedLead?.language}</p>
                </div>
                {evalData?.score && (
                  <Badge variant="secondary" className="text-base px-3 py-1">
                    Score: <span className="font-bold ml-1">{evalData.score.total_score ?? "—"}</span>
                    <span className="text-xs ml-2 text-muted-foreground">
                      ({evalData.score.answered_count} answered)
                    </span>
                  </Badge>
                )}
              </CardHeader>
            </Card>

            {canManageQuestions && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <CardTitle className="text-sm">Questions ({(questions as any[]).length})</CardTitle>
                  <Button size="sm" variant={showAdd ? "secondary" : "outline"} onClick={() => setShowAdd((v) => !v)}>
                    <Plus className="w-4 h-4 mr-1" /> {showAdd ? "Close" : "Add question"}
                  </Button>
                </CardHeader>
                {showAdd && (
                  <CardContent className="grid md:grid-cols-[1fr_100px_160px_100px] gap-2 items-end">
                    <div>
                      <label className="text-xs uppercase text-muted-foreground">Question</label>
                      <Input value={newQ.question_text} onChange={(e) => setNewQ({ ...newQ, question_text: e.target.value })} placeholder="e.g. Is the kitchen space compliant?" />
                    </div>
                    <div>
                      <label className="text-xs uppercase text-muted-foreground">Weight</label>
                      <Input type="number" value={newQ.weight} onChange={(e) => setNewQ({ ...newQ, weight: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="text-xs uppercase text-muted-foreground">Type</label>
                      <select className="w-full border rounded px-2 py-2 text-sm" value={newQ.question_type} onChange={(e) => setNewQ({ ...newQ, question_type: e.target.value as QuestionType })}>
                        <option value="SCALE_1_5">Scale 1–5</option>
                        <option value="YES_NO">Yes / No</option>
                        <option value="TEXT">Text (qualitative)</option>
                      </select>
                    </div>
                    <Button onClick={addQuestion}><Plus className="w-4 h-4 mr-1" /> Add</Button>
                  </CardContent>
                )}
              </Card>
            )}

            {activeQs.length === 0 && (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">No active questions{canManageQuestions ? " — add one above." : ". Ask the Manager to configure them."}</CardContent></Card>
            )}


            {activeQs.map((q: any) => {
              const cur = currentAnswers[q.id] ?? { value: null, text: null };
              return (
                <Card key={q.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium">{q.question_text}</div>
                      <div className="flex gap-1 shrink-0">
                        <Badge variant="outline" className="text-[10px]">{q.question_type}</Badge>
                        {q.question_type !== "TEXT" && <Badge variant="secondary" className="text-[10px]">weight {q.weight}</Badge>}
                      </div>
                    </div>

                    {q.question_type === "SCALE_1_5" && (
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Button key={n} size="sm" variant={cur.value === n ? "default" : "outline"} onClick={() => setAns(q.id, { value: n })}>{n}</Button>
                        ))}
                      </div>
                    )}
                    {q.question_type === "YES_NO" && (
                      <div className="flex gap-2">
                        <Button size="sm" variant={cur.value === 1 ? "default" : "outline"} onClick={() => setAns(q.id, { value: 1 })}>Yes</Button>
                        <Button size="sm" variant={cur.value === 0 ? "default" : "outline"} onClick={() => setAns(q.id, { value: 0 })}>No</Button>
                      </div>
                    )}
                    {q.question_type === "TEXT" && (
                      <Textarea rows={3} placeholder="Notes / observations" value={cur.text ?? ""} onChange={(e) => setAns(q.id, { text: e.target.value })} />
                    )}
                    {q.question_type !== "TEXT" && (
                      <Textarea rows={2} placeholder="Optional notes" value={cur.text ?? ""} onChange={(e) => setAns(q.id, { text: e.target.value })} />
                    )}
                  </CardContent>
                </Card>
              );
            })}

            {activeQs.length > 0 && (
              <div className="flex justify-end">
                <Button onClick={submit}><Save className="w-4 h-4 mr-1" /> Save evaluation</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
