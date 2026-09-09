import {
  jsonResponse,
  serviceSupabase,
  stripeCancelScheduled,
  stripeGet,
  stripePeriodEndUnix,
  stripeSecret,
  upsertPlus,
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
    .select("stripe_subscription_id, stripe_customer_id, current_period_end, cancel_at_period_end, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (rowResult.error) {
    rowResult = await supabase
      .from("plus_subscribers")
      .select("stripe_subscription_id, stripe_customer_id, current_period_end, status")
      .eq("user_id", user.id)
      .maybeSingle();
  }
  const row = rowResult.data;
  const subscriptionId = typeof row?.stripe_subscription_id === "string" ? row.stripe_subscription_id : "";
  const customerId =
    row && typeof (row as { stripe_customer_id?: string }).stripe_customer_id === "string"
      ? (row as { stripe_customer_id: string }).stripe_customer_id
      : "";
  const sub = subscriptionId ? await stripeGet(`/subscriptions/${subscriptionId}`) : null;
  const periodUnix = sub ? stripePeriodEndUnix(sub) : null;
  const currentPeriodEnd = periodUnix
    ? new Date(periodUnix * 1000).toISOString()
    : typeof row?.current_period_end === "string"
      ? row.current_period_end
      : null;
  const cancelAtPeriodEnd = sub ? stripeCancelScheduled(sub) : row?.cancel_at_period_end === true;
  if (sub) {
    try {
      await upsertPlus({
        userId: user.id,
        customerId,
        subscriptionId,
        status: typeof sub.status === "string" ? sub.status : typeof row?.status === "string" ? row.status : "inactive",
        periodEnd: periodUnix,
        cancelAtPeriodEnd,
      });
    } catch {
      /* keep returning live Stripe values */
    }
  }
  return jsonResponse({
    currentPeriodEnd,
    cancelAtPeriodEnd,
  });
}
