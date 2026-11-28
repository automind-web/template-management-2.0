"use client";

import * as React from "react";
import { api, ApiError } from "@/lib/api";
import { newOpId } from "@/lib/op";
import type { TaskCard } from "./types";

/**
 * Действие с карточкой: каждое несёт version и opId — повтор нажатия или доставки не создаёт второй записи;
 * при конфликте показывается актуальное состояние, а введённый текст остаётся в форме.
 */
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
