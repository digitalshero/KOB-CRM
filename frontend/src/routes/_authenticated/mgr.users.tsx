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
import { ShieldCheck, Pencil, KeyRound, Eye, EyeOff } from "lucide-react";

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

  const [editUser, setEditUser] = useState<ProfileRow | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<ProfileRow | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mgr-users"] });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Users & Roles</h1>
          <p className="text-sm text-muted-foreground">Manage users, roles and access.</p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5 shrink-0">
          <Link to="/mgr/page-access">
            <ShieldCheck className="h-4 w-4" /> Page Access
          </Link>
        </Button>
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
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setResetPasswordUser(u)}>
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

      {editUser && (
        <EditUserDialog user={editUser} onOpenChange={(v) => !v && setEditUser(null)} onDone={refresh} />
      )}
      {resetPasswordUser && (
        <ResetPasswordDialog user={resetPasswordUser} onOpenChange={(v) => !v && setResetPasswordUser(null)} />
      )}
    </div>
  );
}

// Mirrors backend/src/repositories/userManagement.repository.ts USERNAME_RE
// exactly: 3-50 printable, non-whitespace characters after trimming. Lets
// usernames like "maniraj@123", "team_leader#1", "user+ops" through; only
// rejects empty/whitespace-only input and control characters (tab/newline).
const USERNAME_RE = /^[^\s\x00-\x1F\x7F]{3,50}$/;
function isValidUsername(raw: string): boolean {
  return USERNAME_RE.test(raw.trim());
}

function EditUserDialog({ user, onOpenChange, onDone }: { user: ProfileRow; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [username, setUsername] = useState(user.username ?? "");
  const [fullName, setFullName] = useState(user.full_name);
  const [role, setRole] = useState(user.roles?.[0] ?? "executive");
  const usernameValid = isValidUsername(username);

  const mutation = useMutation({
    mutationFn: () => apiClient.patch(`/api/kob/users/${user.id}`, { username: username.trim(), full_name: fullName, role }),
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
            {username && !usernameValid && (
              <p className="text-xs text-destructive">Username must be 3-50 characters, with no spaces or control characters.</p>
            )}
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
          <Button disabled={mutation.isPending || !usernameValid || !fullName} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onOpenChange }: { user: ProfileRow; onOpenChange: (v: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiClient.post(`/api/kob/rds-users/${user.id}/reset-password`, { password }),
    onSuccess: () => {
      toast.success(`Password updated successfully for ${user.username ?? user.full_name}.`);
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to reset password"),
  });

  const canSubmit = password.length >= 8 && password === confirmPassword;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reset Password — {user.full_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="pr-10"
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
          <div className="space-y-1.5">
            <Label>Confirm Password</Label>
            <div className="relative">
              <Input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((s) => !s)}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {password && confirmPassword && password !== confirmPassword && (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mutation.isPending || !canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Resetting…" : "Reset Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
