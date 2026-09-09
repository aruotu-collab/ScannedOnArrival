import { createClient } from "@supabase/supabase-js";
import {
  jsonResponse,
  requestOrigin,
  serviceSupabase,
  stripeForm,
  stripeSecret,
  supabaseAnonKey,
  supabaseUrl,
  userFromBearer,
} from "../_stripe.js";

export async function POST(request: Request): Promise<Response> {
  if (!stripeSecret()) {
    return jsonResponse({ error: "Plus billing is not set up yet." }, 503);
  }
  const user = await userFromBearer(request);
  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  if (!user || !url || !anon) return jsonResponse({ error: "Sign in first." }, 401);

  const token = (request.headers.get("authorization") || "").slice(7).trim();
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await supabase.auth.getUser(token);
  if (!data.user) return jsonResponse({ error: "Sign in first." }, 401);
  const { data: row } = await supabase
    .from("plus_subscribers")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  let customer = typeof row?.stripe_customer_id === "string" ? row.stripe_customer_id : "";
  if (!customer) {
    const admin = serviceSupabase();
    const { data: adminRow } = admin
      ? await admin.from("plus_subscribers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle()
      : { data: null };
    customer = typeof adminRow?.stripe_customer_id === "string" ? adminRow.stripe_customer_id : "";
  }
  if (!customer) return jsonResponse({ error: "Start Plus first." }, 400);

  const params = new URLSearchParams();
  params.set("customer", customer);
  params.set("return_url", `${requestOrigin(request)}/`);
  const { ok, status, body } = await stripeForm("/billing_portal/sessions", params);
  const portal = typeof body.url === "string" ? body.url : "";
  if (!ok || !portal) {
    const stripeError =
      body.error && typeof body.error === "object" && "message" in body.error
        ? String((body.error as { message?: string }).message)
        : "";
    return jsonResponse({ error: stripeError || "Could not open Plus billing." }, status || 502);
  }
  return jsonResponse({ url: portal });
}
