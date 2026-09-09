import {
  jsonResponse,
  PLUS_PRODUCT_NAME,
  PLUS_TAX_CODE,
  PLUS_UNIT_AMOUNT,
  requestOrigin,
  stripeForm,
  stripeSecret,
  userFromBearer,
} from "../_stripe.js";

export async function POST(request: Request): Promise<Response> {
  if (!stripeSecret()) {
    return jsonResponse({ error: "Plus checkout is not set up yet." }, 503);
  }
  const user = await userFromBearer(request);
  if (!user) return jsonResponse({ error: "Sign in first." }, 401);

  const origin = requestOrigin(request);
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", `${origin}/?plus=success`);
  params.set("cancel_url", `${origin}/?plus=cancel`);
  params.set("client_reference_id", user.id);
  params.set("allow_promotion_codes", "true");
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(PLUS_UNIT_AMOUNT));
  params.set("line_items[0][price_data][recurring][interval]", "month");
  params.set("line_items[0][price_data][product_data][name]", PLUS_PRODUCT_NAME);
  params.set("line_items[0][price_data][product_data][tax_code]", PLUS_TAX_CODE);
  params.set("subscription_data[metadata][supabase_user_id]", user.id);
  params.set("metadata[supabase_user_id]", user.id);
  if (user.email) params.set("customer_email", user.email);

  const { ok, status, body } = await stripeForm("/checkout/sessions", params);
  const url = typeof body.url === "string" ? body.url : "";
  if (!ok || !url) {
    const message = typeof body.error === "object" && body.error && "message" in body.error
      ? String((body.error as { message?: string }).message)
      : "Could not start Plus.";
    return jsonResponse({ error: message }, status || 502);
  }
  return jsonResponse({ url });
}
