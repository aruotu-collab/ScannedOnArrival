import { classifyDocument } from "../data/classify";
import type { InboxItem } from "../types";

export const INBOX_DOMAIN = "inbox.scannedonarrival.com";

const PLACEHOLDER_LOCAL = new Set(["you", "your-name", "example", "test"]);
const SAMPLE_INBOX_IDS = new Set(["inbox-council", "inbox-insurance"]);

export function mintInboxAddress(): string {
  const slug = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `${slug}@${INBOX_DOMAIN}`;
}

export function isIssuedInboxAddress(value: string): boolean {
  const [local, domain] = value.trim().toLowerCase().split("@");
  if (!local || domain !== INBOX_DOMAIN) return false;
  if (PLACEHOLDER_LOCAL.has(local)) return false;
  return /^[a-z0-9]{8,16}$/.test(local);
}

export function ensureInboxAddress(address: string | undefined): string {
  return isIssuedInboxAddress(address ?? "") ? (address as string).trim().toLowerCase() : mintInboxAddress();
}

export function withoutSampleInbox(items: InboxItem[]): InboxItem[] {
  return items.filter((item) => !SAMPLE_INBOX_IDS.has(item.id));
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

type PendingPayload = {
  ready?: boolean;
  items?: Array<{
    id: string;
    emailId: string;
    attachmentId: string;
    from: string;
    subject: string;
    receivedAt: string;
    attachmentName: string;
    contentType?: string;
  }>;
};

export async function fetchPendingInbox(address: string): Promise<{ ready: boolean; items: InboxItem[] }> {
  if (!isIssuedInboxAddress(address)) return { ready: false, items: [] };
  try {
    const response = await fetch(`/api/inbox/pending?address=${encodeURIComponent(address)}`, { cache: "no-store" });
    const payload = (await response.json()) as PendingPayload;
    if (!response.ok || !payload.ready) return { ready: false, items: [] };
    const items = (payload.items ?? []).map((item) => {
      const classified = classifyDocument({ text: `${item.subject}\n${item.from}`, fileName: item.attachmentName });
      return {
        id: item.id,
        from: item.from,
        subject: item.subject,
        receivedAt: item.receivedAt,
        attachmentName: item.attachmentName,
        typeId: classified.typeId,
        period: classified.period,
        status: "pending" as const,
        emailId: item.emailId,
        attachmentId: item.attachmentId,
        contentType: item.contentType,
      };
    });
    return { ready: true, items };
  } catch {
    return { ready: false, items: [] };
  }
}

export async function downloadInboxFile(item: InboxItem, address: string): Promise<File | null> {
  if (!item.emailId || !item.attachmentId) return null;
  const params = new URLSearchParams({
    address,
    emailId: item.emailId,
    attachmentId: item.attachmentId,
  });
  const response = await fetch(`/api/inbox/file?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) return null;
  const blob = await response.blob();
  const name = item.attachmentName || "document.pdf";
  const type = item.contentType || blob.type || "application/pdf";
  return new File([blob], name, { type });
}

export async function confirmInboxFile(item: InboxItem, address: string): Promise<boolean> {
  if (!item.emailId) return true;
  try {
    const response = await fetch("/api/inbox/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, emailId: item.emailId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
