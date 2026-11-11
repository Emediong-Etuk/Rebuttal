import { createHash } from "node:crypto";
import { getDb, schema, type DB } from "@/db";

export type TimelineInput = {
  caseId: string;
  kind: string;
  actor: string;
  title: string;
  body?: string | null;
  endpoint?: string | null;
  debugId?: string | null;
  detail?: unknown;
};

export async function timeline(e: TimelineInput, db: DB = getDb()) {
  await db.insert(schema.timelineEvents).values({
    caseId: e.caseId,
    kind: e.kind,
    actor: e.actor,
    title: e.title,
    body: e.body ?? null,
    endpoint: e.endpoint ?? null,
    debugId: e.debugId ?? null,
    detail: (e.detail ?? null) as never,
  });
}

export function hashInput(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 32);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** Append-only audit trail: every decision, its input hash, the actor and PayPal's debug ID. */
export async function audit(
  e: { caseId?: string | null; actor: "model" | "policy" | "seller" | "cron" | "system" | "paypal"; action: string; decision?: string | null; input?: unknown; debugId?: string | null; data?: unknown },
  db: DB = getDb(),
) {
  await db.insert(schema.auditLog).values({
    caseId: e.caseId ?? null,
    actor: e.actor,
    action: e.action,
    decision: e.decision ?? null,
    inputHash: e.input === undefined ? null : hashInput(e.input),
    debugId: e.debugId ?? null,
    data: (e.data ?? null) as never,
  });
}
