import { jsonResponse, sendContactMail } from "./_lib.js";
import { ADMIN_EMAIL, accountEmailKey, cleanText, clientCountry, clientIp } from "./_admin.js";
import { serviceSupabase, userFromBearer } from "./_stripe.js";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = serviceSupabase();
    if (!supabase) return jsonResponse({ error: "Contact is not set up yet." }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
      message?: string;
      website?: string;
    };
    if (cleanText(body.website, 80)) return jsonResponse({ ok: true });
    const email = accountEmailKey(body.email);
    const message = cleanText(body.message, 4000);
    const name = cleanText(body.name, 80);
    if (!looksLikeEmail(email)) return jsonResponse({ error: "Enter an email we can reply to." }, 400);
    if (!message || message.length < 8) return jsonResponse({ error: "Write a little more so we can help." }, 400);

    const ip = clientIp(request);
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await supabase
      .from("contact_messages")
      .select("id")
      .eq("ip", ip)
      .gte("created_at", since)
      .limit(3);
    if ((recent.data?.length ?? 0) >= 2) {
      return jsonResponse({ error: "Please wait a moment before sending another message." }, 429);
    }

    const user = await userFromBearer(request);
    const { data, error } = await supabase
      .from("contact_messages")
      .insert({
        email,
        name,
        message,
        user_id: user?.id ?? null,
        ip,
        country: clientCountry(request),
        status: "open",
      })
      .select("id")
      .maybeSingle();
    if (error || !data?.id) return jsonResponse({ error: "Could not send that message." }, 500);

    const notice = [
      name ? `${name} <${email}>` : email,
      "",
      message,
      "",
      `Reply in Admin, or email ${email} directly.`,
    ].join("\n");
    await sendContactMail({
      to: [ADMIN_EMAIL],
      replyTo: email,
      subject: "New ScannedOnArrival message",
      text: notice,
    });

    return jsonResponse({ ok: true, id: data.id });
  } catch {
    return jsonResponse({ error: "Could not send that message." }, 500);
  }
}
