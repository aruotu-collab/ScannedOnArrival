import { jsonResponse, sendContactMail } from "../_lib.js";
import { ADMIN_EMAIL, cleanText, requireAdmin } from "../_admin.js";
import { serviceSupabase } from "../_stripe.js";

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return jsonResponse({ error: "Admin only." }, 403);
  const supabase = serviceSupabase();
  if (!supabase) return jsonResponse({ error: "Admin is not set up yet." }, 503);

  const body = (await request.json().catch(() => ({}))) as { id?: string; reply?: string };
  const id = cleanText(body.id, 80);
  const reply = cleanText(body.reply, 4000);
  if (!id) return jsonResponse({ error: "Missing message." }, 400);
  if (!reply || reply.length < 2) return jsonResponse({ error: "Write a reply first." }, 400);

  const existing = await supabase
    .from("contact_messages")
    .select("id, email, name, message")
    .eq("id", id)
    .maybeSingle();
  if (existing.error || !existing.data?.email) return jsonResponse({ error: "Could not find that message." }, 404);

  const text = [
    reply,
    "",
    "—",
    "ScannedOnArrival",
    "https://www.scannedonarrival.com",
    "",
    "You wrote:",
    existing.data.message,
  ].join("\n");
  const sent = await sendContactMail({
    to: [existing.data.email],
    replyTo: ADMIN_EMAIL,
    subject: "Re: your message to ScannedOnArrival",
    text,
  });
  if (!sent.ok) {
    return jsonResponse({ error: sent.error || "Could not send the reply email." }, 502);
  }

  const { error } = await supabase
    .from("contact_messages")
    .update({
      status: "replied",
      reply_text: reply,
      replied_at: new Date().toISOString(),
      replied_by: admin.email,
    })
    .eq("id", id);
  if (error) return jsonResponse({ error: "The email sent, but the message could not be marked as replied." }, 500);
  return jsonResponse({ ok: true });
}
