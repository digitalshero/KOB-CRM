import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import sheroLogo from "@/assets/shero-logo-mark.png";

export const Route = createFileRoute("/setup")({
  ssr: false,
  head: () => ({ meta: [{ title: "Setup — Shero KOB" }] }),
  component: SetupPage,
});

function SetupPage() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 h-16 w-16 rounded-full bg-primary flex items-center justify-center overflow-hidden shadow-lg ring-4 ring-primary/20">
          <img src={sheroLogo} alt="Shero" className="h-full w-full object-cover" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Shero KOB Control Tower</h1>
        <p className="text-sm text-muted-foreground mt-1">India · Test Environment Setup</p>
      </div>
      <Card className="w-full max-w-lg shadow-xl">
        <CardHeader><CardTitle>Provision Demo Users</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Creates 1 KOB Manager, 5 Team Leaders, and 25 Executives — all with password
            <code className="ml-1 bg-muted px-1.5 py-0.5 rounded">Test@12345</code>. Also assigns
            500 seed leads round-robin. Safe to run multiple times.
          </p>
          <Button
            className="w-full"
            disabled={running}
            onClick={async () => {
              setRunning(true);
              try {
                const r = await apiClient.post<any>("/api/admin/demo-users/seed");
                setResult(r);
                toast.success(`Provisioned ${r.count} users`);
              } catch (e: any) {
                toast.error(e.message ?? "Failed");
              } finally {
                setRunning(false);
              }
            }}
          >
            {running ? "Provisioning..." : "Provision demo users"}
          </Button>
          {result && (
            <div className="text-xs bg-muted p-3 rounded max-h-64 overflow-auto">
              <div className="font-medium mb-2">Done — {result.count} users</div>
              <pre>{JSON.stringify(result.results, null, 2)}</pre>
            </div>
          )}
          <Link to="/auth" className="block text-center text-sm text-primary underline">Go to Sign in →</Link>
        </CardContent>
      </Card>
    </div>
  );
}
