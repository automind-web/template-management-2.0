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

/** Создание филиала. */
export function BranchDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (branch: { id: string; name: string }) => void;
}) {
  const [name, setName] = React.useState("");
  React.useEffect(() => {
    if (open) setName("");
  }, [open]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    const created = await api<{ id: string; name: string }>("POST", "/api/branches", { name });
    onOpenChange(false);
    onSaved(created);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("branch.create")}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" form="branch-form" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("app.create")}
            </Button>
          </>
        }
      >
        <form
          id="branch-form"
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
