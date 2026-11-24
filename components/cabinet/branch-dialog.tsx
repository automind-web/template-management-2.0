"use client";

import * as React from "react";
import { useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

/** Создание или переименование филиала. */
export function BranchDialog({
  open,
  onOpenChange,
  branch,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch?: { id: string; name: string } | null;
  onSaved: (branch: { id: string; name: string }) => void;
}) {
  const [name, setName] = React.useState(branch?.name ?? "");
  React.useEffect(() => {
    if (open) setName(branch?.name ?? "");
  }, [open, branch]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    if (branch) {
      await api("PATCH", `/api/branches/${branch.id}`, { name });
      onSaved({ id: branch.id, name });
    } else {
      const created = await api<{ id: string; name: string }>("POST", "/api/branches", { name });
      onSaved(created);
    }
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={branch ? t("branch.rename") : t("branch.create")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t("branch.name")} error={fieldErrors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("app.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
