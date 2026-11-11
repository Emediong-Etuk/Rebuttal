import { NextResponse } from "next/server";
import { executeAction } from "@/agent/executor";
import type { ActionKind } from "@/db/schema";
import { APPROVAL_ERRORS, consumeApproval, decodeToken } from "@/lib/approvals";
import { audit } from "@/lib/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Approval links only act on POST (from the confirmation page). GET never reaches here. */
export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const typedAmount = form.get("typed_amount") ? String(form.get("typed_amount")) : null;
  const decoded = decodeToken(token);
  const back = (caseId: string | null, q: string) => NextResponse.redirect(new URL(caseId ? `/cases/${caseId}?${q}` : `/approve/${encodeURIComponent(token)}?${q}`, req.url), 303);
  if (!decoded.ok) return back(null, `error=${decoded.error}`);

  const { c: caseId, a: action } = decoded.payload;
  const consumed = await consumeApproval(token, { caseId, action: action as ActionKind });
  if (!consumed.ok) return back(caseId, `notice=${encodeURIComponent(APPROVAL_ERRORS[consumed.error])}`);

  await audit({ caseId, actor: "seller", action: "approve", decision: action, data: { jti: consumed.payload.jti, typedAmount } });
  const r = await executeAction({ caseId, action: action as ActionKind, actor: "seller", approval: { jti: consumed.payload.jti, typedAmount } });
  const notice =
    r.status === "SUCCEEDED"
      ? "Done. PayPal accepted it."
      : r.status === "DUPLICATE"
        ? "This was already sent. Nothing else happened."
        : r.status === "REJECTED"
          ? `Not sent: ${r.reason}`
          : `PayPal rejected it: ${r.error}. Nothing was changed; you can respond in your PayPal Resolution Center.`;
  return back(caseId, `notice=${encodeURIComponent(notice)}`);
}
