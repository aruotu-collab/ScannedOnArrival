import { classifyDocument } from "../data/classify";
import { normalizeDocumentFile } from "./pdf";
import type { FoundEmailDoc } from "../types";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_KEY = "soa-gmail-token";
const TOKEN_EXP_KEY = "soa-gmail-token-exp";

type GmailPart = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
};

function clientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();
}

export function gmailConnectAvailable(): boolean {
  return Boolean(clientId());
}

function readStoredToken(): string {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? "";
  const expires = Number(sessionStorage.getItem(TOKEN_EXP_KEY) ?? 0);
  if (!token || Date.now() >= expires - 15_000) return "";
  return token;
}

function storeToken(token: string, expiresIn: number): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + Math.max(60, expiresIn) * 1000));
}

export function gmailHasSession(): boolean {
  return Boolean(readStoredToken());
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google sign-in.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google sign-in."));
    document.head.appendChild(script);
  });
}

export async function connectGmail(): Promise<void> {
  if (!gmailConnectAvailable()) {
    throw new Error("Gmail connect is not configured on this site yet.");
  }
  if (readStoredToken()) return;
  await loadGis();
  const oauth = window.google?.accounts.oauth2;
  if (!oauth) throw new Error("Could not load Google sign-in.");
  await new Promise<void>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId(),
      scope: GMAIL_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || "Gmail access was not granted."));
          return;
        }
        storeToken(response.access_token, Number(response.expires_in ?? 3600));
        resolve();
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

export async function disconnectGmail(): Promise<void> {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? "";
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXP_KEY);
  if (!token) return;
  try {
    await loadGis();
    const oauth = window.google?.accounts.oauth2;
    if (!oauth) return;
    await new Promise<void>((resolve) => {
      oauth.revoke(token, () => resolve());
      window.setTimeout(() => resolve(), 1500);
    });
  } catch {
    /* already signed out of this tab */
  }
}

async function gmailFetch<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = readStoredToken();
  if (!token) throw new Error("Connect Gmail first.");
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXP_KEY);
    throw new Error("Gmail access expired. Connect again.");
  }
  if (!response.ok) {
    throw new Error("Could not read Gmail on this device.");
  }
  return (await response.json()) as T;
}

function headerValue(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find((header) => header.name.toLowerCase() === name)?.value ?? "";
}

function flattenParts(part: GmailPart | undefined, acc: GmailPart[]): void {
  if (!part) return;
  if (part.parts?.length) {
    for (const child of part.parts) flattenParts(child, acc);
    return;
  }
  acc.push(part);
}

function isDocumentPart(part: GmailPart): boolean {
  const name = (part.filename ?? "").toLowerCase();
  const type = (part.mimeType ?? "").toLowerCase();
  const inlineTiny = type.startsWith("image/") && !name && (part.body?.size ?? 0) < 40_000;
  if (inlineTiny) return false;
  return type.includes("pdf") || name.endsWith(".pdf") || (Boolean(name) && (type.startsWith("image/") || /\.(jpe?g|png|webp)$/.test(name)));
}

function decodeBase64Url(data: string): Uint8Array {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function listGmailDocuments(): Promise<FoundEmailDoc[]> {
  const listed = await gmailFetch<{ messages?: Array<{ id: string }> }>("messages", {
    q: "has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png) newer_than:180d",
    maxResults: "20",
  });
  const found: FoundEmailDoc[] = [];
  for (const row of listed.messages ?? []) {
    if (found.length >= 12) break;
    const message = await gmailFetch<GmailMessage>(`messages/${row.id}`, { format: "full" });
    const parts: GmailPart[] = [];
    flattenParts(message.payload, parts);
    const attachment = parts.find((part) => part.body?.attachmentId && isDocumentPart(part));
    if (!attachment?.body?.attachmentId) continue;
    const subject = headerValue(message.payload?.headers, "subject");
    const from = headerValue(message.payload?.headers, "from");
    const filename = attachment.filename || "document.pdf";
    const classified = classifyDocument({ text: `${subject}\n${from}`, fileName: filename });
    found.push({
      id: `${message.id}:${filename.toLowerCase()}`,
      typeId: classified.typeId,
      title: classified.title,
      period: classified.period,
      mailbox: "gmail",
      added: false,
      from,
      subject,
      attachmentName: filename,
      contentType: attachment.mimeType,
      messageId: message.id,
      attachmentId: attachment.body.attachmentId,
    });
  }
  return found;
}

export async function downloadGmailAttachment(item: FoundEmailDoc): Promise<File | null> {
  if (!item.messageId || !item.attachmentId) return null;
  const payload = await gmailFetch<{ data?: string }>(`messages/${item.messageId}/attachments/${item.attachmentId}`);
  if (!payload.data) return null;
  const bytes = decodeBase64Url(payload.data);
  const name = item.attachmentName || "document.pdf";
  const type = item.contentType || "application/pdf";
  return normalizeDocumentFile(new File([bytes], name, { type }));
}
