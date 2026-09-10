import { serviceSupabase } from "../_stripe.js";
import { jsonResponse, requireAdmin } from "../_admin.js";

export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return jsonResponse({ error: "Admin only." }, 403);
  const supabase = serviceSupabase();
  if (!supabase) return jsonResponse({ error: "Admin is not set up yet." }, 503);
  const { data, error } = await supabase
    .from("contact_messages")
    .select("id, created_at, email, name, message, status, reply_text, replied_at, ip, country")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return jsonResponse({ error: "Could not load messages." }, 500);
  const rows = data ?? [];
  return jsonResponse({
    open: rows.filter((row) => row.status !== "replied").length,
    messages: rows,
  });
}
