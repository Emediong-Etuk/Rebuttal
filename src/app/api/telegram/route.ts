import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { latestCaseNeedingInput, sellerProvidedTracking } from "@/agent/pipeline";
import { parseTrackingReply, sellerChatId, sendTelegram, telegramWebhookSecret } from "@/notify/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function secretOk(given: string | null): boolean {
  const want = telegramWebhookSecret();
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Seller replies to the bot in plain text, e.g. "USPS 9400111202555842761025". */
export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-telegram-bot-api-secret-token"))) return NextResponse.json({ ok: false }, { status: 401 });
  const update = (await req.json()) as { message?: { chat?: { id?: number }; text?: string } };
  const chatId = String(update.message?.chat?.id ?? "");
  const text = update.message?.text ?? "";
  // Only the configured seller chat can drive the pipeline.
  if (!chatId || chatId !== (await sellerChatId()) || !text) return NextResponse.json({ ok: true });
  if (text.trim().startsWith("/start")) {
    await sendTelegram({ text: "Rebuttal is connected. I'll message you here when a buyer opens a case, with one button to resolve it.", button: null, expectsReply: false });
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    const parsed = parseTrackingReply(text);
    const c = await latestCaseNeedingInput();
    if (!c) {
      await sendTelegram({ text: "Thanks! There's no case waiting on you right now, so I didn't change anything.", button: null, expectsReply: false });
      return;
    }
    if (!parsed) {
      await sendTelegram({ text: "I couldn't find a tracking number in that. Please reply with the carrier and number, for example: USPS 9400111202555842761025", button: null, expectsReply: true });
      return;
    }
    await sendTelegram({ text: `Got it: ${parsed.carrier} ${parsed.trackingNumber}. I'm adding it to the PayPal order and re-checking the case.`, button: null, expectsReply: false });
    await sellerProvidedTracking(c.id, parsed.carrier, parsed.trackingNumber, { shipDate: parsed.shipDate }).catch((e) => console.error("[telegram] re-run failed", e));
  });
  return NextResponse.json({ ok: true });
}
