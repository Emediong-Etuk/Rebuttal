// Spike: re-verify a captured webhook delivery (headers + raw body) two ways.
import { readFileSync } from "node:fs";
import { createVerify, X509Certificate } from "node:crypto";
import { pp } from "./lib.mjs";
const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
const a = d.audit.find((x) => x.data?.headers);
const h = a.data.headers, raw = a.data.rawBody, wid = "82T468282C6122132";
console.log("raw length", raw.length, "starts", raw.slice(0, 60));
// 1. PayPal endpoint, raw bytes embedded
const fields = { auth_algo: h["paypal-auth-algo"], cert_url: h["paypal-cert-url"], transmission_id: h["paypal-transmission-id"], transmission_sig: h["paypal-transmission-sig"], transmission_time: h["paypal-transmission-time"], webhook_id: wid };
const r = await pp("POST", "/v1/notifications/verify-webhook-signature", { json: undefined, headers: {}, form: undefined, requestId: false, ...{} , ...({}) , ...(await (async () => ({}))()) , json: { ...fields, webhook_event: JSON.parse(raw) } });
console.log("endpoint (parsed event):", JSON.stringify(r.data));
// 2. Local: sig over `${id}|${time}|${webhookId}|${crc32(raw)}` with the cert
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pem = await (await fetch(h["paypal-cert-url"])).text();
const msg = `${h["paypal-transmission-id"]}|${h["paypal-transmission-time"]}|${wid}|${crc32(Buffer.from(raw, "utf8"))}`;
const v = createVerify("RSA-SHA256"); v.update(msg);
console.log("local signature check:", v.verify(new X509Certificate(pem).publicKey, Buffer.from(h["paypal-transmission-sig"], "base64")));
