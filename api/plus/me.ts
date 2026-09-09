import {
  jsonResponse,
  serviceSupabase,
  stripeGet,
  stripePeriodEndUnix,
  stripeSecret,
  userFromBearer,
} from "../_stripe.js";

export async function GET(request: Request): Promise<Response> {
  if (!stripeSecret()) return jsonResponse({ billing: false });
  const user = await userFromBearer(request);
  if (!user) return jsonResponse({ error: "Sign in first." }, 401);
  const supabase = serviceSupabase();
  if (!supabase) return jsonResponse({ error: "Plus billing is not set up yet." }, 503);
  let rowResult = await supabase
    .from("plus_subscribers")
    .select("stripe_subscription_id, current_period_end, cancel_at_period_end, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (rowResult.error) {
    rowResult = await supabase
      .from("plus_subscribers")
      .select("stripe_subscription_id, current_period_end, status")
      .eq("user_id", user.id)
      .maybeSingle();
  }
  const row = rowResult.data;
  const subscriptionId = typeof row?.stripe_subscription_id === "string" ? row.stripe_subscription_id : "";
  const sub = subscriptionId ? await stripeGet(`/subscriptions/${subscriptionId}`) : null;
  const periodUnix = sub ? stripePeriodEndUnix(sub) : null;
  const currentPeriodEnd = periodUnix
    ? new Date(periodUnix * 1000).toISOString()
    : typeof row?.current_period_end === "string"
      ? row.current_period_end
      : null;
  const cancelAtPeriodEnd = sub ? sub.cancel_at_period_end === true : row?.cancel_at_period_end === true;
  return jsonResponse({
    currentPeriodEnd,
    cancelAtPeriodEnd,
  });
}
