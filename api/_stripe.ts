import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { jsonResponse } from "./_lib.js";

export const PLUS_UNIT_AMOUNT = 399;
export const PLUS_PRODUCT_NAME = "ScannedOnArrival Plus";
/** SaaS — personal use. Required when Stripe Managed Payments is on. */
export const PLUS_TAX_CODE = "txcd_10103000";

export function stripeSecret(): string | undefined {
  return process.env.STRIPE_SECRET_KEY?.trim() || undefined;
}

export function stripeWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}

export function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || undefined;
}

export function supabaseAnonKey(): string | undefined {
  return process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || undefined;
}

export function supabaseServiceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
}

export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  if (forwarded) return `${proto}://${forwarded.split(",")[0].trim()}`;
  return `${url.protocol}//${url.host}`;
}

export async function userFromBearer(request: Request): Promise<{ id: string; email: string } | null> {
  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!url || !anon || !token) return null;
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email?.trim() || "" };
}

export function serviceSupabase() {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function stripeForm(path: string, params: URLSearchParams): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const secret = stripeSecret();
  if (!secret) {
    return { ok: false, status: 503, body: { error: "Plus checkout is not set up yet." } };
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}

export async function stripeGet(path: string): Promise<Record<string, unknown> | null> {
  const secret = stripeSecret();
  if (!secret) return null;
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

export function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key.trim(), rest.join("=")];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const got = Buffer.from(signature);
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function upsertPlus(input: {
  userId: string;
  customerId?: string;
  subscriptionId?: string;
  status: string;
  periodEnd?: number | null;
}): Promise<void> {
  const supabase = serviceSupabase();
  if (!supabase) throw new Error("Plus billing cannot update the account.");
  const { error } = await supabase.from("plus_subscribers").upsert({
    user_id: input.userId,
    stripe_customer_id: input.customerId || null,
    stripe_subscription_id: input.subscriptionId || null,
    status: input.status,
    current_period_end: input.periodEnd ? new Date(input.periodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function plusUserIdFromCustomer(customerId: string): Promise<string | null> {
  const supabase = serviceSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("plus_subscribers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return typeof data?.user_id === "string" ? data.user_id : null;
}

export { jsonResponse };
