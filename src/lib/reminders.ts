import type { DocumentRecord } from "../types";
import { DOCUMENT_TYPES, typeById } from "../data/taxonomy";
import { computeStatus, freshnessLabel } from "../data/status";
import { todayIso } from "./storage";

export interface AttentionItem {
  key: string;
  kind: "outdated" | "expiring";
  documentId: string;
  title: string;
  typeLabel: string;
  detail: string;
}

const NOTIFY_KEY = "soa-notify-day";

export function listAttention(documents: DocumentRecord[]): AttentionItem[] {
  return documents
    .filter((doc) => doc.isCurrent)
    .map((doc) => {
      const status = computeStatus(doc);
      if (status !== "outdated" && status !== "expiring") return null;
      const type = typeById(doc.typeId);
      return {
        key: doc.id,
        kind: status,
        documentId: doc.id,
        title: doc.title,
        typeLabel: type.label,
        detail: freshnessLabel(doc),
      } satisfies AttentionItem;
    })
    .filter((item): item is AttentionItem => item !== null)
    .sort((a, b) => a.typeLabel.localeCompare(b.typeLabel));
}

export function missingCount(documents: DocumentRecord[]): number {
  const current = documents.filter((doc) => doc.isCurrent);
  return DOCUMENT_TYPES.filter((type) => type.id !== "other").filter(
    (type) => !current.some((doc) => doc.typeId === type.id),
  ).length;
}

export async function enableNotifications(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function maybeNotify(items: AttentionItem[]): void {
  if (!("Notification" in window) || Notification.permission !== "granted" || items.length === 0) return;
  const today = todayIso();
  try {
    if (localStorage.getItem(NOTIFY_KEY) === today) return;
    localStorage.setItem(NOTIFY_KEY, today);
  } catch {
    return;
  }
  const labels = items.map((item) => item.typeLabel);
  const body =
    items.length === 1
      ? `${items[0].typeLabel} — ${items[0].detail}`
      : `${items.length} documents need attention: ${labels.slice(0, 3).join(", ")}`;
  try {
    new Notification("ScannedOnArrival", {
      body,
      tag: "soa-attention",
    });
  } catch {
    /* some browsers only allow this from a service worker */
  }
}
