import { currentSession, normalizeAccountEmail } from "./auth";

export const ADMIN_EMAIL = "aruotu@gmail.com";

export function isAdminEmail(email: string): boolean {
  return normalizeAccountEmail(email) === ADMIN_EMAIL;
}

export type AdminMember = {
  id: string
  email: string
  createdAt: string | null
  lastSignInAt: string | null
  plan: "Paid" | "Free"
  plusStatus: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  lastSeenAt: string | null
  lastPath: string | null
};

export type AdminGuest = {
  ip: string
  country: string | null
  visits: number
  lastSeenAt: string
  lastPath: string
  lastReferrer: string | null
  email?: string | null
};

export type AdminVisit = {
  id: string
  at: string
  ip: string
  path: string
  title: string | null
  referrer: string | null
  country: string | null
  email: string | null
};

export type AdminOverview = {
  visitsToday: number
  uniqueIpsToday: number
  members: number
  paid: number
  free: number
  guests: number
  topPaths: Array<{ path: string; count: number }>
  topReferrers: Array<{ referrer: string; count: number }>
  membersList: AdminMember[]
  guestsList: AdminGuest[]
  recentVisits: AdminVisit[]
};

export async function loadAdminOverview(): Promise<AdminOverview> {
  const session = await currentSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const response = await fetch("/api/admin/overview", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as AdminOverview & { error?: string };
  if (!response.ok) throw new Error(body.error || "Could not load admin.");
  return body;
}

export type ContactMessage = {
  id: string
  created_at: string
  email: string
  name: string | null
  message: string
  status: string
  reply_text: string | null
  replied_at: string | null
  ip: string | null
  country: string | null
};

export async function loadAdminMessages(): Promise<{ open: number; messages: ContactMessage[] }> {
  const session = await currentSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const response = await fetch("/api/admin/messages", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as {
    open?: number
    messages?: ContactMessage[]
    error?: string
  };
  if (!response.ok) throw new Error(body.error || "Could not load messages.");
  return { open: body.open ?? 0, messages: body.messages ?? [] };
}

export async function replyToContactMessage(id: string, reply: string): Promise<void> {
  const session = await currentSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const response = await fetch("/api/admin/reply", {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id, reply }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Could not send that reply.");
}
