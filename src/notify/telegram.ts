import type { SellerMessage } from "./message";

/** Sends one message to the seller's Telegram chat. A no-op (reported as skipped) when not configured. */
export async function sendTelegram(msg: SellerMessage, chatId = process.env.TELEGRAM_CHAT_ID): Promise<{ sent: boolean; reason?: string; messageId?: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { sent: false, reason: "Telegram is not configured" };
  // Telegram refuses inline URL buttons pointing at localhost; fall back to text in that case.
  const usableButton = msg.button && /^https:\/\//.test(msg.button.url) ? msg.button : null;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: usableButton || !msg.button ? msg.text : `${msg.text}\n\n${msg.button.label}: ${msg.button.url}`,
    disable_web_page_preview: true,
  };
  if (usableButton) body.reply_markup = { inline_keyboard: [[{ text: usableButton.label, url: usableButton.url }]] };
  // force_reply and inline_keyboard cannot be combined; prefer force_reply when a reply is needed.
  if (msg.expectsReply) body.reply_markup = { force_reply: true, input_field_placeholder: "e.g. USPS 9400111202555842761025" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
    return data.ok ? { sent: true, messageId: data.result?.message_id } : { sent: false, reason: data.description ?? `HTTP ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Parse a seller's plain-text reply like "USPS 9400111202555842761025" or just the number. */
export function parseTrackingReply(text: string): { carrier: string; trackingNumber: string } | null {
  const t = text.trim().toUpperCase();
  const num = t.match(/\b[A-Z0-9]{8,35}\b/g)?.find((x) => /\d{6,}/.test(x));
  if (!num) return null;
  const carriers = ["USPS", "UPS", "FEDEX", "DHL", "ROYAL_MAIL", "CANADA_POST", "NGA_NIPOST"];
  const word = t.replace(/[^A-Z_ ]/g, " ").split(/\s+/).find((w) => carriers.includes(w) || (w === "ROYAL" && t.includes("ROYAL MAIL")));
  const carrier = word === "ROYAL" ? "ROYAL_MAIL" : word ?? guessCarrier(num);
  return { carrier, trackingNumber: num };
}

function guessCarrier(n: string): string {
  if (/^(94|93|92|95)\d{20}$/.test(n)) return "USPS";
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "UPS";
  if (/^\d{12}$|^\d{15}$/.test(n)) return "FEDEX";
  return "OTHER";
}
