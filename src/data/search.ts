import type { DocumentRecord } from "../types";
import { todayIso } from "../lib/storage";
import { isSuperseded } from "./status";
import { categoryLabel, typeById } from "./taxonomy";

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function documentSearchText(doc: DocumentRecord): string {
  const type = typeById(doc.typeId);
  return [
    doc.title,
    doc.period,
    doc.notes,
    doc.fileName,
    doc.locationLabel,
    type.label,
    type.folderName,
    categoryLabel(doc.categoryId),
    doc.isCurrent ? "current" : "",
    isSuperseded(doc) ? "outdated previous" : "relevant",
    doc.storageKind === "stored" ? "stored" : "referenced",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function documentMatchesQuery(doc: DocumentRecord, query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  const hay = documentSearchText(doc);
  return q.split(" ").every((part) => hay.includes(part));
}

export function searchDocuments(documents: DocumentRecord[], query: string): DocumentRecord[] {
  if (!normalizeQuery(query)) return documents;
  return documents
    .filter((doc) => documentMatchesQuery(doc, query))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.createdAt.localeCompare(a.createdAt));
}

export function formatCheckedDate(iso: string): string {
  const day = iso.slice(0, 10);
  const parts = day.split("-").map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function isCheckedToday(iso: string): boolean {
  return iso.slice(0, 10) === todayIso();
}
