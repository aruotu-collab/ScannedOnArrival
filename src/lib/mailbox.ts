import type { DocumentRecord, FoundEmailDoc } from "../types";

export function mailboxRef(item: Pick<FoundEmailDoc, "id" | "mailbox" | "messageId" | "attachmentName">): string {
  const message = item.messageId || item.id;
  const name = (item.attachmentName ?? "").trim().toLowerCase();
  return `${item.mailbox}:${message}:${name}`;
}

export function isMailboxItemIndexed(item: FoundEmailDoc, documents: DocumentRecord[]): boolean {
  const ref = mailboxRef(item);
  if (documents.some((doc) => doc.mailboxRef === ref)) return true;
  const fileName = (item.attachmentName ?? "").trim().toLowerCase();
  if (!fileName) return false;
  return documents.some(
    (doc) => doc.source === "email-connect" && (doc.fileName ?? "").trim().toLowerCase() === fileName,
  );
}

export function rememberFoundEmail(
  items: FoundEmailDoc[],
  documents: DocumentRecord[],
  skipped: string[],
): FoundEmailDoc[] {
  const skippedSet = new Set(skipped);
  return items
    .filter((item) => !skippedSet.has(mailboxRef(item)))
    .map((item) => ({ ...item, added: isMailboxItemIndexed(item, documents) }));
}
