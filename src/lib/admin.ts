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
