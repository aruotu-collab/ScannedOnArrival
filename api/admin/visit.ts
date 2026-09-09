import { userFromBearer } from "../_stripe.js";
import { cleanPath, cleanReferrer, cleanText, clientCountry, clientIp, jsonResponse, serviceSupabase } from "../_admin.js";

export async function POST(request: Request): Promise<Response> {
  const supabase = serviceSupabase();
  if (!supabase) return jsonResponse({ ok: true });
  const body = (await request.json().catch(() => ({}))) as { path?: string; title?: string; referrer?: string };
  const user = await userFromBearer(request);
  const { error } = await supabase.from("site_visits").insert({
    ip: clientIp(request),
    path: cleanPath(body.path),
    title: cleanText(body.title, 80),
    referrer: cleanReferrer(body.referrer),
    country: clientCountry(request),
    user_agent: cleanText(request.headers.get("user-agent"), 400),
    user_id: user?.id ?? null,
    email: user?.email?.trim().toLowerCase() || null,
  });
  if (error) return jsonResponse({ error: "Could not record visit." }, 500);
  return jsonResponse({ ok: true });
}
