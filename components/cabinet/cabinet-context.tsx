"use client";

import * as React from "react";
import { api } from "@/lib/api";

export type Me = {
  user: { id: string; login: string; displayName: string; phoneLinked: boolean; phoneMasked: string | null };
  role: "employee" | "manager" | "director";
  position: string | null;
  branch: { id: string; name: string } | null;
  company: { id: string; name: string; timezone: string };
  branches: { id: string; name: string }[];
  capabilities: {
    manageBranches: boolean;
    manageCompany: boolean;
    manageIntegrations: boolean;
    manageMembers: boolean;
    inviteManagers: boolean;
    inviteEmployees: boolean;
    viewStats: boolean;
    viewSystemSettings: boolean;
    switchBranch: boolean;
    assignOthers: boolean;
    acceptResults: boolean;
  };
  statuses: { key: string; name: string; category: string }[];
  assistantName: string;
};

type CabinetState = {
  me: Me;
  refreshMe: () => Promise<Me | null>;
  /** Текущий филиал: id или null, если филиалов нет. */
  branchId: string | null;
  setBranchId: (id: string) => void;
  /** Растёт при каждой смене филиала: запросы сверяют его, чтобы запоздалый ответ не попал на экран. */
  branchEpoch: number;
};

const Ctx = React.createContext<CabinetState | null>(null);
const STORAGE_KEY = "am.branch";

function pickBranch(me: Me, preferred: string | null): string | null {
  if (me.branches.length === 0) return null;
  if (preferred && me.branches.some((b) => b.id === preferred)) return preferred;
  if (me.branch && me.branches.some((b) => b.id === me.branch!.id)) return me.branch.id;
  return me.branches[0]!.id;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function CabinetProvider({ initialMe, children }: { initialMe: Me; children: React.ReactNode }) {
  const [me, setMe] = React.useState(initialMe);
  const [branchId, setBranch] = React.useState<string | null>(() => pickBranch(initialMe, null));
  const [branchEpoch, setEpoch] = React.useState(0);

  // Выбор филиала восстанавливается после загрузки (localStorage доступен только в браузере).
  React.useEffect(() => {
    const stored = readStored();
    const next = pickBranch(initialMe, stored);
    setBranch((prev) => (prev === next ? prev : next));
  }, [initialMe]);

  const setBranchId = React.useCallback((id: string) => {
    setBranch(id);
    setEpoch((e) => e + 1);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* хранилище недоступно — выбор действует до перезагрузки */
    }
  }, []);

  const refreshMe = React.useCallback(async () => {
    try {
      const fresh = await api<Me>("GET", "/api/me");
      setMe(fresh);
      setBranch((prev) => pickBranch(fresh, prev));
      return fresh;
    } catch {
      return null;
    }
  }, []);

  const value = React.useMemo(
    () => ({ me, refreshMe, branchId, setBranchId, branchEpoch }),
    [me, refreshMe, branchId, setBranchId, branchEpoch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCabinet(): CabinetState {
  const value = React.useContext(Ctx);
  if (!value) throw new Error("useCabinet outside CabinetProvider");
  return value;
}
