import { newId } from "./crypto";
import { getDb, schema } from "./db";

export async function audit(entry: {
  companyId: string | null;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  await getDb()
    .insert(schema.auditEvents)
    .values({
      id: newId(),
      companyId: entry.companyId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      dataJson: JSON.stringify(entry.data ?? {}),
      createdAt: Date.now(),
    });
}
