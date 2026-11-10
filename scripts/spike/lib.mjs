// Throwaway helpers for the Phase 0 sandbox spike. Not used by the app.
// Credentials: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, or "proxy-injected" in the dev sandbox.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";

export const BASE = process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";
const id = process.env.PAYPAL_CLIENT_ID ?? "proxy-injected";
const secret = process.env.PAYPAL_CLIENT_SECRET ?? "proxy-injected";
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
const LOG = new URL("./out/calls.log", import.meta.url);

let cached;
export async function token() {
  if (cached) return cached;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token ${r.status} ${JSON.stringify(j)}`);
  cached = j.access_token;
  return cached;
}

/** Call PayPal, log request shape (no secrets), status and debug id. */
export async function pp(method, path, { json, form, headers = {}, requestId } = {}) {
  const h = { Authorization: `Bearer ${await token()}`, ...headers };
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form; // FormData sets its own content type
  if (requestId !== false && method !== "GET") h["PayPal-Request-Id"] = requestId ?? randomUUID();
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const debugId = r.headers.get("paypal-debug-id");
  const safeHeaders = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, /authorization|assertion/i.test(k) ? "<redacted>" : v]));
  const entry = { at: new Date().toISOString(), method, path, status: r.status, debugId, headers: safeHeaders, request: json ?? (form ? "<multipart>" : undefined), response: data };
  appendFileSync(LOG, JSON.stringify(entry) + "\n");
  console.log(`${method} ${path} -> ${r.status} debug=${debugId}`);
  return { status: r.status, ok: r.ok, data, debugId };
}

/** Unsigned PayPal-Auth-Assertion (sandbox) acting as a buyer, per PayPal's dispute test guide. */
export function buyerAssertion(clientId, buyerEmail) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ iss: clientId, email: buyerEmail })}.`;
}
