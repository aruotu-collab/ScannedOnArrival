import { jsonResponse, stripeSecret } from "../_stripe.js";

export function GET(): Response {
  return jsonResponse({ billing: Boolean(stripeSecret()) });
}
