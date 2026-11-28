"use client";

import * as React from "react";
import { api, ApiError } from "@/lib/api";
import { newOpId } from "@/lib/op";
import { cachedCard, queueTaskAction, setTaskSaving } from "./store";
import type { TaskCard } from "./types";

type Optimistic = (card: TaskCard) => TaskCard;

/** Serialize writes to the same task; other tasks remain fully interactive. */
export function useTaskAction(setCard: (c: TaskCard) => void) {
  return React.useCallback(
    (method: string, path: string, body: Record<string, unknown>, version?: number, optimistic?: Optimistic): Promise<TaskCard> => {
      const id = /^\/api\/tasks\/([^/]+)/.exec(path)?.[1] ?? path;
      const opId = newOpId();
      return queueTaskAction(id, async () => {
        const before = cachedCard(id);
        const currentVersion = before?.task.version ?? version;
        setTaskSaving(id, true);
        if (before) {
          const fields = Object.fromEntries(Object.entries(body).filter(([key]) => ["title", "description", "resultCriteria", "checklist", "requiresResult", "requiresAttachment", "dueDate", "dueTime"].includes(key)));
          const next = { ...before, task: { ...before.task, ...fields } } as TaskCard;
          setCard(optimistic ? optimistic(next) : next);
        }
        try {
          const card = await api<TaskCard>(method, path, { ...body, opId, ...(currentVersion ? { version: currentVersion } : {}) });
          setCard(card);
          return card;
        } catch (e) {
          const current = e instanceof ApiError ? (e.details as { current?: TaskCard } | null)?.current : null;
          if (current) setCard(current);
          else if (before) setCard(before);
          throw e;
        } finally {
          setTaskSaving(id, false);
        }
      });
    },
    [setCard],
  );
}
