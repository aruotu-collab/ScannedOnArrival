import {
  jsonResponse,
  plusUserIdFromCustomer,
  stripeCancelScheduled,
  stripeGet,
  stripePeriodEndUnix,
  stripeWebhookSecret,
  upsertPlus,
  verifyStripeSignature,
} from "../_stripe.js";

type StripeObject = Record<string, unknown>;

function textId(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return "";
}

async function applySubscription(sub: StripeObject, fallbackUserId?: string): Promise<void> {
  const metadata = (sub.metadata && typeof sub.metadata === "object" ? sub.metadata : {}) as Record<string, unknown>;
  const customerId = textId(sub.customer);
  const userId =
    (typeof metadata.supabase_user_id === "string" && metadata.supabase_user_id) ||
    fallbackUserId ||
    (customerId ? await plusUserIdFromCustomer(customerId) : null);
  if (!userId) return;
  await upsertPlus({
    userId,
    customerId,
    subscriptionId: textId(sub.id) || textId(sub),
    status: typeof sub.status === "string" ? sub.status : "inactive",
    periodEnd: stripePeriodEndUnix(sub),
    cancelAtPeriodEnd: stripeCancelScheduled(sub),
  });
}

export async function POST(request: Request): Promise<Response> {
  const secret = stripeWebhookSecret();
  const payload = await request.text();
  if (secret && !verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return jsonResponse({ error: "Invalid webhook signature." }, 400);
  }
  let event: { type?: string; data?: { object?: StripeObject } } = {};
  try {
    event = JSON.parse(payload) as { type?: string; data?: { object?: StripeObject } };
  } catch {
    return jsonResponse({ error: "Invalid payload." }, 400);
  }
  const object = event.data?.object ?? {};
  try {
    if (event.type === "checkout.session.completed") {
      const userId = typeof object.client_reference_id === "string" ? object.client_reference_id : "";
      const subscriptionId = textId(object.subscription);
      if (subscriptionId) {
        const sub = (await stripeGet(`/subscriptions/${subscriptionId}`)) ?? object;
        await applySubscription(sub, userId);
      } else if (userId) {
        await upsertPlus({
          userId,
          customerId: textId(object.customer),
          status: "active",
        });
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await applySubscription(object);
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Plus.";
    return jsonResponse({ error: message }, 500);
  }
}
