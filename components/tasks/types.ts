export type StatusRef = { key: string; name: string; category: string };

export type TaskListItem = {
  id: string;
  number: number;
  branchId: string;
  title: string;
  status: StatusRef;
  assignee: { id: string; displayName: string; self: boolean };
  branchName: string | null;
  dueDate: string | null;
  dueAt: number | null;
  overdue: boolean;
  isPersonal: boolean;
  cancelled: boolean;
  checklist: { total: number; done: number };
  version: number;
  moves: { to: string; toName: string; kind: TransitionInfo["kind"]; needsForm: boolean }[];
  /** Основное действие участника, как в карточке. */
  primary: string | null;
};

export type TaskList = {
  items: TaskListItem[];
  hasMore: boolean;
  view: "mine" | "all";
  viewsDiffer: boolean;
  counts: { byStatus: Record<string, number>; overdue: number; cancelled: number; total: number };
  statuses: StatusRef[];
  cancelledName: string;
  allBranches: boolean;
  timezone: string;
  today: string;
  snapshotAt: number;
};

export type ChecklistItem = { id: string; text: string; done: boolean };

export type TransitionInfo = {
  to: string;
  toName: string;
  kind: "status_changed" | "submitted" | "accepted" | "returned" | "reopened";
  requires: { comment: boolean; result: boolean; resultText: boolean; attachment: boolean };
};

export type TaskCard = {
  task: {
    id: string;
    number: number;
    branchId: string;
    branchName: string | null;
    title: string;
    description: string | null;
    resultCriteria: string | null;
    status: StatusRef;
    assignee: { id: string; displayName: string | null };
    creator: { id: string; displayName: string | null };
    isPersonal: boolean;
    dueDate: string | null;
    dueTime: string | null;
    dueAt: number | null;
    overdue: boolean;
    checklist: ChecklistItem[];
    requiresResult: boolean;
    requiresAttachment: boolean;
    version: number;
    cancelledAt: number | null;
    createdAt: number;
    updatedAt: number;
  };
  permissions: { edit: boolean; cancel: boolean; checklist: boolean; comment: boolean; attach: boolean };
  transitions: TransitionInfo[];
  primary: string | null;
  comments: { id: string; kind: string; body: string; author: string | null; createdAt: number }[];
  attachments: {
    id: string;
    fileName: string;
    contentType: string;
    size: number;
    kind: string;
    uploader: string | null;
    canDelete: boolean;
    createdAt: number;
  }[];
  history: {
    id: string;
    type: string;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    comment: string | null;
    actor: string | null;
    channel: string;
    createdAt: number;
  }[];
  replayed?: boolean;
};

export type Assignee = { userId: string; displayName: string; role: string; self: boolean };
