import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator diagnostics: re-run verification of the last rejected webhook with this deployment's credentials. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const base = process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const tok = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const t = (await tok.json()) as { access_token?: string; app_id?: string; error?: string };
  const hooks = t.access_token ? ((await (await fetch(`${base}/v1/notifications/webhooks`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json()) as { webhooks?: Array<{ id: string; url: string }> }) : null;
  const [row] = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.action, "webhook_rejected")).orderBy(desc(schema.auditLog.id)).limit(1);
  const data = row?.data as { headers?: Record<string, string>; rawBody?: string } | null;
  let verify: unknown = null;
  if (t.access_token && data?.headers && data.rawBody) {
    const h = data.headers;
    const fields = { auth_algo: h["paypal-auth-algo"], cert_url: h["paypal-cert-url"], transmission_id: h["paypal-transmission-id"], transmission_sig: h["paypal-transmission-sig"], transmission_time: h["paypal-transmission-time"], webhook_id: (process.env.PAYPAL_WEBHOOK_ID ?? "").trim() };
    const res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json" }, body: `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${data.rawBody.trim()}}` });
    verify = { status: res.status, debugId: res.headers.get("paypal-debug-id"), body: await res.json().catch(() => null) };
  }
  return NextResponse.json({ baseUrl: base, tokenOk: !!t.access_token, tokenError: t.error ?? null, appId: t.app_id ?? null, webhooksVisibleToThisApp: hooks?.webhooks?.map((w) => ({ id: w.id, url: w.url })) ?? null, verify });
}
