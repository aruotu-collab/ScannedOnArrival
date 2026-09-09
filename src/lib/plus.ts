import { currentSession, getSupabase } from "./auth";

export const PLUS_PRICE_LABEL = "$3.99/month";
export const FREE_TRACKED_TYPES = 3;
export const FREE_REMINDERS = 2;
export const GUEST_PAGE_LIMIT = 5;
export const FREE_PAGE_LIMIT = 15;

export type PlusReason = "inbox" | "gmail" | "outlook" | "invite" | "tracked" | "pages";

export type PlusState = {
  billingReady: boolean
  active: boolean
  subscriber: boolean
};

const PLUS_INTENT_KEY = "soa-plus-intent";

export function plusEffective(state: PlusState | null): boolean {
  if (!state) return true;
  return !state.billingReady || state.active;
}

export function pageLimit(signedIn: boolean, plus: boolean): number {
  if (plus) return 99;
  if (signedIn) return FREE_PAGE_LIMIT;
  return GUEST_PAGE_LIMIT;
}

export function canTrackType(tracked: string[], typeId: string, plus: boolean): boolean {
  if (plus || typeId === "other") return true;
  if (tracked.includes(typeId)) return true;
  return tracked.length < FREE_TRACKED_TYPES;
}

export function plusPitch(reason: PlusReason): { title: string; message: string } {
  switch (reason) {
    case "inbox":
      return {
        title: "Forwarding is Plus",
        message: `Free accounts keep mail on this phone. Plus is ${PLUS_PRICE_LABEL} to forward a PDF to your private inbox address.`,
      };
    case "gmail":
      return {
        title: "Gmail is Plus",
        message: `Look in Gmail is Plus — ${PLUS_PRICE_LABEL}. Free accounts still add PDFs from Files on this phone.`,
      };
    case "outlook":
      return {
        title: "Outlook is Plus",
        message: `Mailbox connect is Plus — ${PLUS_PRICE_LABEL}. Free accounts still add PDFs from Files on this phone.`,
      };
    case "invite":
      return {
        title: "Household invites are Plus",
        message: `A different email on this index is Plus — ${PLUS_PRICE_LABEL}. They sign in free and join your household. You pay; they do not.`,
      };
    case "tracked":
      return {
        title: "Free accounts remember three",
        message: `This listing is saved on this phone. Plus is ${PLUS_PRICE_LABEL} to keep every important type current — and for one other person, inbox, and Gmail.`,
      };
    case "pages":
      return {
        title: "More pages is Plus",
        message: `This scan can have ${GUEST_PAGE_LIMIT} pages until you sign in, or ${FREE_PAGE_LIMIT} on a free account. Plus is ${PLUS_PRICE_LABEL} for longer letters.`,
      };
  }
}

export function rememberPlusIntent(reason: PlusReason): void {
  sessionStorage.setItem(PLUS_INTENT_KEY, reason);
}

export function takePlusIntent(): PlusReason | null {
  const value = sessionStorage.getItem(PLUS_INTENT_KEY);
  sessionStorage.removeItem(PLUS_INTENT_KEY);
  if (value === "inbox" || value === "gmail" || value === "outlook" || value === "invite" || value === "tracked" || value === "pages") {
    return value;
  }
  return null;
}

export async function loadPlusState(): Promise<PlusState> {
  const billingReady = await plusBillingReady();
  const supabase = getSupabase();
  const session = await currentSession();
  if (!supabase || !session?.user) {
    return { billingReady, active: false, subscriber: false };
  }
  try {
    const [{ data: active }, { data: row }] = await Promise.all([
      supabase.rpc("plus_active"),
      supabase.from("plus_subscribers").select("status").eq("user_id", session.user.id).maybeSingle(),
    ]);
    const status = typeof row?.status === "string" ? row.status : "";
    return {
      billingReady,
      active: active === true,
      subscriber: status === "active" || status === "trialing",
    };
  } catch {
    return { billingReady, active: false, subscriber: false };
  }
}

export async function plusBillingReady(): Promise<boolean> {
  try {
    const response = await fetch("/api/plus/status", { cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { billing?: boolean };
    return body.billing === true;
  } catch {
    return false;
  }
}

export async function startPlusCheckout(): Promise<void> {
  const session = await currentSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const response = await fetch("/api/plus/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new Error(body.error || "Could not start Plus.");
  window.location.href = body.url;
}

export async function startPlusPortal(): Promise<void> {
  const session = await currentSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const response = await fetch("/api/plus/portal", {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new Error(body.error || "Could not open Plus billing.");
  window.location.assign(body.url);
}

export function seedTrackedTypes(documents: { typeId: string; isCurrent?: boolean }[], existing: string[] | undefined): string[] {
  if (existing && existing.length > 0) return existing;
  const types: string[] = [];
  for (const doc of documents) {
    if (!doc.isCurrent || doc.typeId === "other") continue;
    if (types.includes(doc.typeId)) continue;
    types.push(doc.typeId);
    if (types.length >= FREE_TRACKED_TYPES) break;
  }
  return types;
}

export function trackedAttention<T extends { documentId: string }>(
  items: T[],
  documents: Array<{ id: string; typeId: string }>,
  tracked: string[],
  signedIn: boolean,
  plus: boolean,
): T[] {
  if (!signedIn || plus) return items;
  const allowed = new Set(tracked);
  return items.filter((item) => {
    const doc = documents.find((row) => row.id === item.documentId);
    return Boolean(doc && allowed.has(doc.typeId));
  });
}
