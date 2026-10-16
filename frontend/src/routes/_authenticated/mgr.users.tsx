import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { ShieldCheck, UserPlus, Pencil, KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mgr/users")({
  head: () => ({ meta: [{ title: "Users & Roles — Shero KOB" }] }),
  component: MgrUsers,
});

const ROLES = [
  { value: "super_admin", label: "Super Admin (CEO)" },
  { value: "kob_manager", label: "KOB Manager" },
  { value: "team_leader", label: "Team Leader" },
  { value: "executive", label: "Executive" },
];

interface ProfileRow {
  id: string;
  full_name: string;
  username: string | null;
  phone: string | null;
  team_leader_id: string | null;
  roles: string[];
}

function MgrUsers() {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["mgr-users"],
    queryFn: () => apiClient.get<ProfileRow[]>("/api/kob/list-all-profiles"),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<ProfileRow | null>(null);
  const [resetUser, setResetUser] = useState<ProfileRow | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mgr-users"] });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Users & Roles</h1>
          <p className="text-sm text-muted-foreground">Manage users, roles and access.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add User
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/mgr/page-access">
              <ShieldCheck className="h-4 w-4" /> Page Access
            </Link>
          </Button>
        </div>
      </div>
      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Name</th>
                <th className="p-2">Username</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Role</th>
                <th className="p-2">Team Leader</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data as ProfileRow[]).map((u) => (
                <tr key={u.id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{u.full_name}</td>
                  <td className="p-2 text-xs font-mono">{u.username ?? "—"}</td>
                  <td className="p-2 text-xs">{u.phone ?? "—"}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {(u.roles ?? []).map((r: string) => (
                        <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{r}</span>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 text-xs font-mono">{u.team_leader_id?.slice(0, 8) ?? "—"}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEditUser(u)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setResetUser(u)}>
                        <KeyRound className="h-3.5 w-3.5" /> Reset Password
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} onDone={refresh} />
      {editUser && (
        <EditUserDialog user={editUser} onOpenChange={(v) => !v && setEditUser(null)} onDone={refresh} />
      )}
      {resetUser && (
        <ResetPasswordDialog user={resetUser} onOpenChange={(v) => !v && setResetUser(null)} />
      )}
    </div>
  );
}

function AddUserDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("executive");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => apiClient.post("/api/kob/users", { username, full_name: fullName, role, password }),
    onSuccess: () => {
      toast.success("User created");
      setUsername(""); setFullName(""); setRole("executive"); setPassword("");
      onOpenChange(false);
      onDone();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create user"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. jsmith" />
          </div>
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mutation.isPending || !username || !fullName || password.length < 8} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Creating…" : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onOpenChange, onDone }: { user: ProfileRow; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [username, setUsername] = useState(user.username ?? "");
  const [fullName, setFullName] = useState(user.full_name);
  const [role, setRole] = useState(user.roles?.[0] ?? "executive");

  const mutation = useMutation({
    mutationFn: () => apiClient.patch(`/api/kob/users/${user.id}`, { username, full_name: fullName, role }),
    onSuccess: () => {
      toast.success("User updated");
      onOpenChange(false);
      onDone();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update user"),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mutation.isPending || !username || !fullName} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onOpenChange }: { user: ProfileRow; onOpenChange: (v: boolean) => void }) {
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => apiClient.post(`/api/kob/users/${user.id}/reset-password`, { password }),
    onSuccess: () => {
      toast.success("Password updated");
      setPassword("");
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to reset password"),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reset Password — {user.full_name}</DialogTitle></DialogHeader>
        <div className="space-y-1.5">
          <Label>New Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mutation.isPending || password.length < 8} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Reset Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
