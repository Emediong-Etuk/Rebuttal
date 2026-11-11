import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { sendTelegram, telegramApi, telegramWebhookSecret } from "@/notify/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time Telegram setup, so the bot token never has to leave the server:
 * 1. the seller sends /start to the bot; 2. this reads that chat ID, saves it, and registers the bot webhook.
 * Protected by CRON_SECRET.
 */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (!base.startsWith("https://")) return NextResponse.json({ ok: false, error: "APP_URL must be an https URL" }, { status: 400 });

  const me = await telegramApi<{ username: string }>("getMe");
  if (!me.ok) return NextResponse.json({ ok: false, error: me.description }, { status: 400 });

  // getUpdates only works while no webhook is set, so remove it first.
  await telegramApi("deleteWebhook", { drop_pending_updates: false });
  const updates = await telegramApi<Array<{ message?: { chat?: { id: number; type: string; first_name?: string } } }>>("getUpdates", { limit: 100 });
  const chats = (updates.result ?? []).map((u) => u.message?.chat).filter((c): c is { id: number; type: string; first_name?: string } => !!c && c.type === "private");
  const chat = chats.at(-1);

  const hook = await telegramApi("setWebhook", { url: `${base}/api/telegram`, secret_token: telegramWebhookSecret(), allowed_updates: ["message"] });
  if (!chat) return NextResponse.json({ ok: false, bot: me.result?.username, webhook: hook.ok, error: "No /start message found. Send /start to the bot, then run setup again." }, { status: 400 });

  const chatId = String(chat.id);
  await getDb().insert(schema.settings).values({ id: "default", telegramChatId: chatId }).onConflictDoUpdate({ target: schema.settings.id, set: { telegramChatId: chatId, updatedAt: new Date() } });
  const hello = await sendTelegram({ text: `Hi${chat.first_name ? ` ${chat.first_name}` : ""}! Rebuttal is connected. I'll message you here when a buyer opens a case.`, button: null, expectsReply: false }, chatId);
  return NextResponse.json({ ok: true, bot: me.result?.username, chatSaved: true, webhook: hook.ok, hello: hello.sent });
}
