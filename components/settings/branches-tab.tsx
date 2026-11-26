"use client";

import * as React from "react";
import { BranchDialog } from "@/components/cabinet/branch-dialog";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState } from "@/components/cabinet/page-header";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { errorText, t } from "@/lib/i18n";
import { Loading, useLoad } from "./common";

type Branch = { id: string; name: string };

export function BranchesTab() {
  const { refreshMe, setBranchId, me } = useCabinet();
  const { data, error, load } = useLoad<{ branches: Branch[] }>("/api/branches");
  const [creating, setCreating] = React.useState(false);

  const after = async (created?: Branch) => {
    load();
    const hadNone = me.branches.length === 0;
    await refreshMe();
    if (created && hadNone) setBranchId(created.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setCreating(true)}>{t("branch.create")}</Button>
      </div>
      {!data ? (
        <Loading error={error} onRetry={load} />
      ) : data.branches.length === 0 ? (
        <Card>
          <EmptyState title={t("branch.none")} text={t("branch.createHint")} />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {data.branches.map((b) => (
            <BranchRow key={b.id} branch={b} onChanged={() => void after()} />
          ))}
        </Card>
      )}
      <BranchDialog open={creating} onOpenChange={setCreating} onSaved={(b) => void after(b)} />
    </div>
  );
}

/** Строка филиала: название правится на месте, «Сохранить» активна после изменения. */
function BranchRow({ branch, onChanged }: { branch: Branch; onChanged: () => void }) {
  const [name, setName] = React.useState(branch.name);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setName(branch.name), [branch.name]);

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : "network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2.5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && name.trim() !== branch.name) void call(() => api("PATCH", `/api/branches/${branch.id}`, { name: name.trim() }));
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t("branch.name")} required maxLength={120} />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={busy || !name.trim() || name.trim() === branch.name}>
          {t("app.save")}
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={() => void call(() => api("DELETE", `/api/branches/${branch.id}`))}>
          {t("branch.archive")}
        </Button>
      </div>
    </form>
  );
}
