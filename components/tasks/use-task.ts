"use client";

import * as React from "react";
import { api, ApiError } from "@/lib/api";
import { newOpId } from "@/lib/op";
import type { TaskCard } from "./types";

export type Notice = { tone: "success" | "neutral" | "danger"; text: string } | null;

/**
 * Состояние карточки и отправка изменений.
 * Каждое действие несёт version и opId: повтор нажатия/доставки не создаёт второй записи,
 * при конфликте показывается актуальное состояние, а введённый текст остаётся в форме.
 */
export function useTaskCard(taskId: string) {
  const [card, setCard] = React.useState<TaskCard | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoadError(null);
    api<TaskCard>("GET", `/api/tasks/${taskId}`)
      .then(setCard)
      .catch((e) => setLoadError(e instanceof ApiError ? e.code : "network"));
  }, [taskId]);

  React.useEffect(load, [load]);

  return { card, setCard, load, loadError };
}

/** Действие с карточкой: один opId на попытку, сбрасывается после успеха или конфликта. */
export function useTaskAction(setCard: (c: TaskCard) => void) {
  const opId = React.useRef(newOpId());
  return React.useCallback(
    async (method: string, path: string, body: Record<string, unknown>, version?: number): Promise<TaskCard> => {
      try {
        const card = await api<TaskCard>(method, path, { ...body, opId: opId.current, ...(version ? { version } : {}) });
        opId.current = newOpId();
        setCard(card);
        return card;
      } catch (e) {
        if (e instanceof ApiError && e.code === "version_conflict") {
          opId.current = newOpId();
          const current = (e.details as { current?: TaskCard } | null)?.current;
          if (current) setCard(current);
        }
        throw e;
      }
    },
    [setCard],
  );
}
