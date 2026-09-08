import type { DocumentRecord } from "../types";
import { typeById } from "./taxonomy";
import { monthsOld } from "./classify";

export function freshnessLabel(doc: DocumentRecord, now = new Date()): string {
  if (doc.expiresOn) {
    const expiry = new Date(doc.expiresOn);
    if (!Number.isNaN(expiry.getTime())) {
      if (expiry < now) return `Expired ${expiry.getFullYear()}`;
      return `Expires ${expiry.getFullYear()}`;
    }
  }
  const age = monthsOld(doc.issuedOn ?? doc.lastChecked, now);
  if (age === null) return "Date unknown";
  if (age <= 0) return "This month";
  if (age === 1) return "1 month old";
  if (age < 12) return `${age} months old`;
  const years = Math.floor(age / 12);
  return years === 1 ? "1 year old" : `${years} years old`;
}

export function computeStatus(doc: DocumentRecord, now = new Date()): "current" | "outdated" | "expiring" {
  if (!doc.isCurrent) return "outdated";
  if (doc.expiresOn) {
    const expiry = new Date(doc.expiresOn);
    if (!Number.isNaN(expiry.getTime())) {
      const monthsLeft =
        (expiry.getFullYear() - now.getFullYear()) * 12 + (expiry.getMonth() - now.getMonth());
      if (monthsLeft < 0) return "outdated";
      if (monthsLeft <= 2) return "expiring";
      return "current";
    }
  }
  const def = typeById(doc.typeId);
  const age = monthsOld(doc.issuedOn ?? doc.lastChecked, now);
  if (def.freshnessMonths && age !== null && age > def.freshnessMonths) return "outdated";
  return "current";
}

export function locationShort(doc: DocumentRecord): string {
  if (doc.storageKind === "stored") {
    if (doc.source === "camera") return "scanned with your phone";
    if (doc.locationProvider === "local") return "stored locally";
    return `stored in ${providerLabel(doc.locationProvider)}`;
  }
  return `stored in ${providerLabel(doc.locationProvider)}`;
}

export function locationLine(doc: DocumentRecord): string {
  if (doc.storageKind === "stored" && (doc.source === "camera" || doc.locationProvider === "local")) {
    return "On this phone";
  }
  const label = doc.locationLabel?.trim();
  if (label && !/^stored locally/i.test(label)) return label;
  return `In ${providerLabel(doc.locationProvider)}`;
}

export function providerLabel(provider: DocumentRecord["locationProvider"]): string {
  switch (provider) {
    case "icloud":
      return "iCloud Drive";
    case "google_drive":
      return "Google Drive";
    case "onedrive":
      return "OneDrive";
    case "downloads":
      return "Downloads";
    case "files":
      return "Files";
    case "camera":
      return "Phone";
    case "email":
      return "Email";
    default:
      return "ScannedOnArrival";
  }
}

export function storageVerb(doc: DocumentRecord): string {
  return doc.storageKind === "stored" ? "Stored here" : "Referenced here";
}
