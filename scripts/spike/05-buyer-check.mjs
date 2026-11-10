// Check the sandbox buyer auth assertion is accepted (lists disputes as the buyer).
import { pp, buyerAssertion } from "./lib.mjs";
const a = buyerAssertion(process.env.PAYPAL_CLIENT_ID_PUBLIC, process.env.BUYER_EMAIL);
const r = await pp("GET", "/v1/customer/disputes?page_size=5", { headers: { "PayPal-Auth-Assertion": a } });
console.log(JSON.stringify(r.data).slice(0, 600));
