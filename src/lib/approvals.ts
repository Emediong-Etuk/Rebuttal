import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db";
import type { ActionKind } from "@/db/schema";
import { baseUrl } from "./site";

/**
 * Approval links: HMAC-signed, single-use, bound to one case + one action + one draft version,
 * expiring after 24 hours. GET only renders a confirmation page; the action runs on POST.
 */
export const APPROVAL_TTL_MS = 24 * 3_600_000;

export type ApprovalPayload = { jti: string; c: string; a: ActionKind; v: number; exp: number };

function secret(): string {
  const s = process.env.APPROVAL_SECRET;
  if (!s || s.length < 32) throw new Error("APPROVAL_SECRET must be set (32+ characters)");
  return s;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest();

export function encodeToken(p: ApprovalPayload): string {
  const body = b64(JSON.stringify(p));
  return `${body}.${b64(sign(body))}`;
}

export type VerifyError = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "UNKNOWN" | "USED" | "MISMATCH";

/** Signature and expiry only; no database. */
export function decodeToken(token: string, now = Date.now()): { ok: true; payload: ApprovalPayload } | { ok: false; error: VerifyError } {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: "MALFORMED" };
  const [body, sig] = parts as [string, string];
  const expected = sign(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: "BAD_SIGNATURE" };
  let payload: ApprovalPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  if (typeof payload.exp !== "number" || payload.exp <= now) return { ok: false, error: "EXPIRED" };
  return { ok: true, payload };
}

export async function issueApproval(caseId: string, action: ActionKind, draftVersion: number, db: DB = getDb(), now = Date.now()): Promise<string> {
  const payload: ApprovalPayload = { jti: randomUUID(), c: caseId, a: action, v: draftVersion, exp: now + APPROVAL_TTL_MS };
  await db.insert(schema.approvalTokens).values({ jti: payload.jti, caseId, action, draftVersion, expiresAt: new Date(payload.exp) });
  return encodeToken(payload);
}

/** For rendering the confirmation page (GET). Never changes state. */
export async function inspectApproval(token: string, db: DB = getDb(), now = Date.now()) {
  const d = decodeToken(token, now);
  if (!d.ok) return d;
  const [row] = await db.select().from(schema.approvalTokens).where(eq(schema.approvalTokens.jti, d.payload.jti));
  if (!row) return { ok: false as const, error: "UNKNOWN" as const };
  if (row.caseId !== d.payload.c || row.action !== d.payload.a || row.draftVersion !== d.payload.v) return { ok: false as const, error: "MISMATCH" as const };
  if (row.usedAt) return { ok: false as const, error: "USED" as const };
  return { ok: true as const, payload: d.payload };
}

/**
 * For the POST. Atomically marks the token used; a second concurrent POST with the same token gets USED.
 * `expected` binds the token to the case/action the page claims to act on.
 */
export async function consumeApproval(token: string, expected: { caseId: string; action: ActionKind }, db: DB = getDb(), now = Date.now()) {
  const d = await inspectApproval(token, db, now);
  if (!d.ok) return d;
  if (d.payload.c !== expected.caseId || d.payload.a !== expected.action) return { ok: false as const, error: "MISMATCH" as const };
  const updated = await db
    .update(schema.approvalTokens)
    .set({ usedAt: new Date(now) })
    .where(and(eq(schema.approvalTokens.jti, d.payload.jti), isNull(schema.approvalTokens.usedAt)))
    .returning({ jti: schema.approvalTokens.jti });
  if (!updated.length) return { ok: false as const, error: "USED" as const };
  return { ok: true as const, payload: d.payload };
}

export function approvalUrl(token: string): string {
  const base = baseUrl();
  return `${base}/approve/${token}`;
}

export const APPROVAL_ERRORS: Record<VerifyError, string> = {
  MALFORMED: "This link is incomplete. Open it again from the latest message.",
  BAD_SIGNATURE: "This link has been altered and cannot be used.",
  EXPIRED: "This link has expired. Open the case page to get a fresh one.",
  UNKNOWN: "This link is not recognised.",
  USED: "This link has already been used. Nothing else will happen.",
  MISMATCH: "This link belongs to a different action or an older draft. Use the latest message.",
};
