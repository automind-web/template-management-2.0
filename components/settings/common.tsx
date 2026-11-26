"use client";

import * as React from "react";
import { LoadError } from "@/components/forms";
import { PageSkeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { errorText } from "@/lib/i18n";

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
  return <PageSkeleton rows={3} />;
}
