import { serviceSupabase } from "../_stripe.js";
import { jsonResponse, requireAdmin } from "../_admin.js";

type VisitRow = {
  id: string
  created_at: string
  ip: string
  path: string
  title: string | null
  referrer: string | null
  country: string | null
  email: string | null
  user_id: string | null
};

type PlusRow = {
  user_id: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean | null
};

function startOfUtcDay(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function countBy(items: string[]): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!item) continue;
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return jsonResponse({ error: "Admin only." }, 403);
  const supabase = serviceSupabase();
  if (!supabase) return jsonResponse({ error: "Admin is not set up yet." }, 503);

  const [{ data: usersData, error: usersError }, plusResult, visitsResult] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 200 }),
    supabase.from("plus_subscribers").select("user_id, status, current_period_end, cancel_at_period_end"),
    supabase
      .from("site_visits")
      .select("id, created_at, ip, path, title, referrer, country, email, user_id")
      .order("created_at", { ascending: false })
      .limit(800),
  ]);
  if (usersError) return jsonResponse({ error: "Could not load members." }, 500);
  let plusRows = (plusResult.data ?? []) as PlusRow[];
  if (plusResult.error) {
    const fallback = await supabase.from("plus_subscribers").select("user_id, status, current_period_end");
    plusRows = ((fallback.data ?? []) as PlusRow[]).map((row) => ({ ...row, cancel_at_period_end: false }));
  }
  const visits = (visitsResult.data ?? []) as VisitRow[];
  const plusByUser = new Map(plusRows.map((row) => [row.user_id, row]));
  const lastByEmail = new Map<string, VisitRow>();
  const lastByIp = new Map<string, VisitRow>();
  const guestCounts = new Map<string, number>();
  for (const visit of visits) {
    if (visit.email && !lastByEmail.has(visit.email)) lastByEmail.set(visit.email, visit);
    if (!lastByIp.has(visit.ip)) lastByIp.set(visit.ip, visit);
    if (!visit.email) guestCounts.set(visit.ip, (guestCounts.get(visit.ip) ?? 0) + 1);
  }

  const membersList = (usersData.users ?? []).map((user) => {
    const email = user.email?.trim().toLowerCase() || "";
    const plus = plusByUser.get(user.id);
    const paid = plus?.status === "active" || plus?.status === "trialing";
    const last = email ? lastByEmail.get(email) : undefined;
    return {
      id: user.id,
      email,
      createdAt: user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      plan: paid ? "Paid" : "Free",
      plusStatus: plus?.status || "none",
      cancelAtPeriodEnd: plus?.cancel_at_period_end === true,
      currentPeriodEnd: plus?.current_period_end ?? null,
      lastSeenAt: last?.created_at ?? null,
      lastPath: last?.path ?? null,
    };
  });
  const paid = membersList.filter((row) => row.plan === "Paid").length;
  const today = startOfUtcDay();
  const todayVisits = visits.filter((visit) => visit.created_at >= today);
  const guestsList = [...guestCounts.entries()]
    .map(([ip, count]) => {
      const last = lastByIp.get(ip);
      return {
        ip,
        country: last?.country ?? null,
        visits: count,
        lastSeenAt: last?.created_at ?? "",
        lastPath: last?.path ?? "/",
        lastReferrer: last?.referrer ?? null,
      };
    })
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));

  return jsonResponse({
    visitsToday: todayVisits.length,
    uniqueIpsToday: new Set(todayVisits.map((visit) => visit.ip)).size,
    members: membersList.length,
    paid,
    free: membersList.length - paid,
    guests: guestsList.length,
    topPaths: countBy(visits.map((visit) => visit.path)).slice(0, 6).map((row) => ({ path: row.key, count: row.count })),
    topReferrers: countBy(visits.map((visit) => visit.referrer || "").filter(Boolean))
      .slice(0, 6)
      .map((row) => ({ referrer: row.key, count: row.count })),
    membersList,
    guestsList,
    recentVisits: visits.slice(0, 80).map((visit) => ({
      id: visit.id,
      at: visit.created_at,
      ip: visit.ip,
      path: visit.path,
      title: visit.title,
      referrer: visit.referrer,
      country: visit.country,
      email: visit.email,
    })),
  });
}
