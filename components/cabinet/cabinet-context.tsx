"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { registerServiceWorker, syncPushSubscription } from "@/lib/pwa";
import { TaskPanelProvider } from "@/components/tasks/task-panel";
import { ToastProvider } from "@/components/ui/toast";

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
    resetPasswords: boolean;
    inviteManagers: boolean;
    inviteEmployees: boolean;
    viewStats: boolean;
    viewSystemSettings: boolean;
    manageTeam: boolean;
    switchBranch: boolean;
    assignOthers: boolean;
    acceptResults: boolean;
  };
  statuses: { key: string; name: string; category: string }[];
  cancelledName: string;
  dueTime: string;
  branding: { accent: string; logoUrl: string; fontFamily: string };
  assistantName: string;
  system: { smartAssistant: boolean; whatsapp: boolean };
};

/** Выбор в шапке: конкретный филиал или «all» (только у директора). */
export const ALL = "all";

type CabinetState = {
  me: Me;
  refreshMe: () => Promise<Me | null>;
  /** Текущий выбор: id филиала, «all» или null, если филиалов нет. */
  branchId: string | null;
  /** Конкретный филиал для создания задач: выбранный или единственный. */
  concreteBranchId: string | null;
  setBranchId: (id: string) => void;
  /** Растёт при каждой смене филиала: запоздалый ответ по прежнему филиалу на экран не попадает. */
  branchEpoch: number;
};

const Ctx = React.createContext<CabinetState | null>(null);
const STORAGE_KEY = "am.branch";

function pickBranch(me: Me, preferred: string | null): string | null {
  if (me.branches.length === 0) return null;
  if (me.branches.length === 1) return me.branches[0]!.id;
  if (preferred && (preferred === ALL ? me.capabilities.switchBranch : me.branches.some((b) => b.id === preferred))) return preferred;
  if (me.capabilities.switchBranch) return ALL;
  return me.branch?.id ?? me.branches[0]!.id;
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

  React.useEffect(() => {
    void registerServiceWorker().then(() => syncPushSubscription()).catch(() => {});
  }, []);

  // Выбор филиала восстанавливается после загрузки (localStorage доступен только в браузере).
  React.useEffect(() => {
    const next = pickBranch(initialMe, readStored());
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

  const concreteBranchId = branchId && branchId !== ALL ? branchId : me.branches.length === 1 ? me.branches[0]!.id : null;

  const value = React.useMemo(
    () => ({ me, refreshMe, branchId, concreteBranchId, setBranchId, branchEpoch }),
    [me, refreshMe, branchId, concreteBranchId, setBranchId, branchEpoch],
  );
  return (
    <Ctx.Provider value={value}>
      <ToastProvider><TaskPanelProvider>{children}</TaskPanelProvider></ToastProvider>
    </Ctx.Provider>
  );
}

export function useCabinet(): CabinetState {
  const value = React.useContext(Ctx);
  if (!value) throw new Error("useCabinet outside CabinetProvider");
  return value;
}
