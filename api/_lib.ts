const RESEND_API = "https://api.resend.com";
export const INBOX_DOMAIN = "inbox.scannedonarrival.com";

export type ReceivedAttachment = {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  size?: number;
  download_url?: string;
};

export type ReceivedEmail = {
  id: string;
  to?: string[];
  from?: string;
  created_at: string;
  subject?: string;
  received_for?: string[];
  attachments?: ReceivedAttachment[];
};

export function inboxApiKey(): string | undefined {
  const key = process.env.RESEND_API_KEY?.trim();
  return key || undefined;
}

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isIssuedInboxAddress(value: string): boolean {
  const [local, domain] = normalizeAddress(value).split("@");
  if (!local || domain !== INBOX_DOMAIN) return false;
  return /^[a-z0-9]{8,16}$/.test(local);
}

function recipientsOf(email: ReceivedEmail): string[] {
  return [...(email.to ?? []), ...(email.received_for ?? [])].map(normalizeAddress);
}

export function emailMatchesAddress(email: ReceivedEmail, address: string): boolean {
  const wanted = normalizeAddress(address);
  return recipientsOf(email).includes(wanted);
}

export function isDocumentAttachment(attachment: ReceivedAttachment): boolean {
  const type = (attachment.content_type ?? "").toLowerCase();
  const name = (attachment.filename ?? "").toLowerCase();
  const inlineImage = attachment.content_disposition === "inline" && type.startsWith("image/");
  if (inlineImage) return false;
  return type === "application/pdf" || type.startsWith("image/") || name.endsWith(".pdf") || /\.(jpe?g|png|webp)$/.test(name);
}

async function resendJson<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const key = inboxApiKey();
  if (!key) {
    return { ok: false, status: 503, body: { message: "Receive server is not configured." } as T };
  }
  const response = await fetch(`${RESEND_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {} as T;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = { message: text } as T;
    }
  }
  return { ok: response.ok, status: response.status, body };
}

export async function listReceivedEmails(): Promise<ReceivedEmail[]> {
  const items: ReceivedEmail[] = [];
  let after: string | undefined;
  for (let page = 0; page < 8; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const { ok, body } = await resendJson<{ data?: ReceivedEmail[]; has_more?: boolean; message?: string }>(
      `/emails/receiving?${query.toString()}`,
    );
    if (!ok) throw new Error(body.message ?? "Could not list received mail.");
    const data = body.data ?? [];
    items.push(...data);
    if (!body.has_more || data.length === 0) break;
    after = data[data.length - 1]?.id;
  }
  return items;
}

export async function getReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const { ok, status, body } = await resendJson<ReceivedEmail & { message?: string }>(`/emails/receiving/${emailId}`);
  if (status === 404) return null;
  if (!ok) throw new Error(body.message ?? "Could not load received mail.");
  return body;
}

export async function getAttachment(emailId: string, attachmentId: string): Promise<ReceivedAttachment | null> {
  const { ok, status, body } = await resendJson<ReceivedAttachment & { message?: string }>(
    `/emails/receiving/${emailId}/attachments/${attachmentId}`,
  );
  if (status === 404) return null;
  if (!ok) throw new Error(body.message ?? "Could not load attachment.");
  return body;
}

export async function deleteReceivedEmail(emailId: string): Promise<{ deleted: boolean; status: number }> {
  const { ok, status } = await resendJson(`/emails/receiving/${emailId}`, { method: "DELETE" });
  return { deleted: ok || status === 404, status };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
