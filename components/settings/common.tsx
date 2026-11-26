"use client";

import * as React from "react";
import { LoadError } from "@/components/forms";
import { Spinner } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { errorText, t } from "@/lib/i18n";

export type SystemSettings = {
  company: { name: string; timezone: string };
  settings: {
    accent: string;
    logoUrl: string;
    fontFamily: string;
    dueTime: string;
    workDays: number[];
    acceptanceEnabled: boolean;
    employeeSeesColleagues: boolean;
    speedFrom: "started" | "assigned";
    cancelledName: string;
    assistantName: string;
    assistantModel: string;
  };
  statuses: { key: string; name: string; category: string }[];
  timezones: string[];
  models: string[];
};

/** Загрузка данных вкладки с состояниями «загрузка / ошибка с повтором». */
export function useLoad<T>(path: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const id = ++seq.current;
    setError(null);
    api<T>("GET", path)
      .then((r) => id === seq.current && setData(r))
      .catch((e) => id === seq.current && setError(errorText(e instanceof ApiError ? e.code : "network")));
  }, [path]);
  React.useEffect(load, [load]);
  return { data, error, load, setData };
}

export function Loading({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) return <LoadError message={error} onRetry={onRetry} />;
  return (
    <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Spinner /> {t("app.loading")}
    </p>
  );
}
