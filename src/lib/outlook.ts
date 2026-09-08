import { PublicClientApplication, type AuthenticationResult } from "@azure/msal-browser";
import { classifyDocument } from "../data/classify";
import { normalizeDocumentFile } from "./pdf";
import type { FoundEmailDoc } from "../types";

const SCOPES = ["Mail.Read"];

function clientId(): string {
  return (import.meta.env.VITE_MICROSOFT_CLIENT_ID ?? "").trim();
}

export function outlookConnectAvailable(): boolean {
  return Boolean(clientId());
}

let app: PublicClientApplication | null = null;
let accountReady = false;

async function msal(): Promise<PublicClientApplication> {
  if (app) return app;
  const id = clientId();
  if (!id) throw new Error("Outlook connect is not configured on this site yet.");
  app = new PublicClientApplication({
    auth: {
      clientId: id,
      authority: "https://login.microsoftonline.com/common",
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await app.initialize();
  accountReady = true;
  return app;
}

async function acquireToken(): Promise<string> {
  const pca = await msal();
  const account = pca.getAllAccounts()[0];
  try {
    const silent: AuthenticationResult = account
      ? await pca.acquireTokenSilent({ account, scopes: SCOPES })
      : await pca.ssoSilent({ scopes: SCOPES });
    return silent.accessToken;
  } catch {
    const popup = await pca.loginPopup({ scopes: SCOPES });
    return popup.accessToken;
  }
}

export function outlookHasSession(): boolean {
  if (!accountReady || !app) {
    try {
      return Boolean(sessionStorage.getItem(`msal.account.keys`));
    } catch {
      return false;
    }
  }
  return app.getAllAccounts().length > 0;
}

export async function connectOutlook(): Promise<void> {
  if (!outlookConnectAvailable()) {
    throw new Error("Outlook connect is not configured on this site yet.");
  }
  await acquireToken();
}

export async function disconnectOutlook(): Promise<void> {
  if (!outlookConnectAvailable()) return;
  try {
    const pca = await msal();
    const account = pca.getAllAccounts()[0];
    if (!account) return;
    await pca.logoutPopup({ account });
  } catch {
    app = null;
  }
}

type GraphAttachment = {
  id: string;
  name?: string;
  contentType?: string;
  contentBytes?: string;
  isInline?: boolean;
  size?: number;
};

type GraphMessage = {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
};

function isDocumentAttachment(attachment: GraphAttachment): boolean {
  if (attachment.isInline) return false;
  const name = (attachment.name ?? "").toLowerCase();
  const type = (attachment.contentType ?? "").toLowerCase();
  return type.includes("pdf") || name.endsWith(".pdf") || type.startsWith("image/") || /\.(jpe?g|png|webp)$/.test(name);
}

async function graphFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new Error("Outlook access expired. Connect again.");
  if (!response.ok) throw new Error("Could not read Outlook on this device.");
  return (await response.json()) as T;
}

export async function listOutlookDocuments(): Promise<FoundEmailDoc[]> {
  const token = await acquireToken();
  const listed = await graphFetch<{ value?: GraphMessage[] }>(
    "/me/messages?$filter=hasAttachments eq true&$orderby=receivedDateTime desc&$top=20&$select=id,subject,from,receivedDateTime,hasAttachments",
    token,
  );
  const found: FoundEmailDoc[] = [];
  for (const message of listed.value ?? []) {
    if (found.length >= 12) break;
    const attachments = await graphFetch<{ value?: GraphAttachment[] }>(
      `/me/messages/${message.id}/attachments?$select=id,name,contentType,isInline,size`,
      token,
    );
    const attachment = (attachments.value ?? []).find(isDocumentAttachment);
    if (!attachment) continue;
    const from = message.from?.emailAddress?.address ?? message.from?.emailAddress?.name ?? "";
    const filename = attachment.name || "document.pdf";
    const classified = classifyDocument({
      text: `${message.subject ?? ""}\n${from}`,
      fileName: filename,
    });
    found.push({
      id: `${message.id}:${attachment.id}`,
      typeId: classified.typeId,
      title: classified.title,
      period: classified.period,
      mailbox: "outlook",
      added: false,
      from,
      subject: message.subject,
      receivedAt: message.receivedDateTime,
      attachmentName: filename,
      contentType: attachment.contentType,
      messageId: message.id,
      attachmentId: attachment.id,
    });
  }
  return found;
}

export async function downloadOutlookAttachment(item: FoundEmailDoc): Promise<File | null> {
  if (!item.messageId || !item.attachmentId) return null;
  const token = await acquireToken();
  const attachment = await graphFetch<GraphAttachment>(
    `/me/messages/${item.messageId}/attachments/${item.attachmentId}`,
    token,
  );
  if (!attachment.contentBytes) return null;
  const binary = atob(attachment.contentBytes);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const name = attachment.name || item.attachmentName || "document.pdf";
  const type = attachment.contentType || item.contentType || "application/pdf";
  return normalizeDocumentFile(new File([bytes], name, { type }));
}
