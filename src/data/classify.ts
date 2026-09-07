import type { ClassifiedResult, DocumentTypeId } from "../types";
import { DOCUMENT_TYPES, typeById } from "./taxonomy";

const TAX_YEAR = /\b(20\d{2})\s*[–\-—\/]\s*(20)?(\d{2})\b/;
const ISO_DATE = /\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/;
const UK_DATE = /\b(0?[1-9]|[12]\d|3[01])[\/.\-](0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/;
const MONTH_YEAR =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/i;
const EXPIRY =
  /\b(?:expir(?:y|es|ation)|valid until|valid to)\s*[:\-]?\s*((?:0?[1-9]|[12]\d|3[01])[\/.\-](?:0?[1-9]|1[0-2])[\/.\-]20\d{2}|20\d{2})\b/i;

function scoreType(haystack: string, typeId: DocumentTypeId): number {
  const def = typeById(typeId);
  let score = 0;
  for (const keyword of def.keywords) {
    if (haystack.includes(keyword)) score += keyword.length > 10 ? 4 : 3;
  }
  for (const hint of def.filenameHints) {
    if (haystack.includes(hint)) score += 2;
  }
  return score;
}

function extractPeriod(text: string): string | undefined {
  const tax = text.match(TAX_YEAR);
  if (tax) {
    const start = tax[1];
    const end = tax[2] ? `${tax[2]}${tax[3]}` : `20${tax[3]}`;
    return `${start}–${end.slice(2)}`;
  }
  const month = text.match(MONTH_YEAR);
  if (month) {
    const monthName = month[1][0].toUpperCase() + month[1].slice(1).toLowerCase();
    return `${monthName} ${month[2]}`;
  }
  return undefined;
}

function toIso(day: string, month: string, year: string): string {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function extractIssuedOn(text: string): string | undefined {
  const iso = text.match(ISO_DATE);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = text.match(UK_DATE);
  if (uk) return toIso(uk[1], uk[2], uk[3]);
  return undefined;
}

function extractExpiresOn(text: string): string | undefined {
  const match = text.match(EXPIRY);
  if (!match) return undefined;
  const value = match[1];
  if (/^20\d{2}$/.test(value)) return `${value}-12-31`;
  const uk = value.match(UK_DATE);
  if (uk) return toIso(uk[1], uk[2], uk[3]);
  return undefined;
}

export function classifyDocument(input: {
  text?: string;
  fileName?: string;
}): ClassifiedResult {
  const fileName = (input.fileName ?? "").toLowerCase();
  const text = `${fileName}\n${(input.text ?? "").toLowerCase()}`;
  const ranked = DOCUMENT_TYPES
    .filter((t) => t.id !== "other")
    .map((t) => ({ id: t.id, score: scoreType(text, t.id) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const typeId: DocumentTypeId = best && best.score >= 3 ? best.id : "other";
  const def = typeById(typeId);
  const period = extractPeriod(`${input.fileName ?? ""}\n${input.text ?? ""}`);
  const issuedOn = extractIssuedOn(input.text ?? "");
  const expiresOn = extractExpiresOn(input.text ?? "");
  const title = period ? `${def.label} ${period}` : def.label;
  const confidence: ClassifiedResult["confidence"] =
    best?.score >= 6 ? "high" : best?.score >= 3 ? "medium" : "low";

  const excerpt = (input.text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return { typeId, title, period, issuedOn, expiresOn, confidence, excerpt };
}

export function monthsOld(isoDate?: string, from = new Date()): number | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return (from.getFullYear() - date.getFullYear()) * 12 + (from.getMonth() - date.getMonth());
}

export function yearsUntil(isoDate?: string, from = new Date()): number | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear() - from.getFullYear();
}
