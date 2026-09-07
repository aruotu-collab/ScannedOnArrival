import type { AppSettings, DocumentRecord, FileBlobRecord, InboxItem } from "../types";
import { loadAllFileRecords, loadDocuments, loadInbox, loadSettings, replaceAllData, todayIso } from "./storage";

const FORMAT = "scannedonarrival-backup";
const VERSION = 1;

export interface BackupFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  settings: AppSettings;
  documents: DocumentRecord[];
  inbox: InboxItem[];
  files: Array<{
    id: string;
    documentId: string;
    name: string;
    type: string;
    data: string;
  }>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: type || "application/octet-stream" });
}

export async function buildBackup(fallbackSettings: AppSettings): Promise<BackupFile> {
  const [documents, files, settings, inbox] = await Promise.all([
    loadDocuments(),
    loadAllFileRecords(),
    loadSettings(),
    loadInbox(),
  ]);
  const encoded = await Promise.all(
    files.map(async (file) => ({
      id: file.id,
      documentId: file.documentId,
      name: documents.find((doc) => doc.id === file.documentId)?.fileName ?? `${file.id}.bin`,
      type: file.blob.type || "application/octet-stream",
      data: await blobToBase64(file.blob),
    })),
  );
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    settings: settings ?? fallbackSettings,
    documents,
    inbox,
    files: encoded,
  };
}

export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ScannedOnArrival-backup-${todayIso()}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function parseBackupFile(file: File): Promise<BackupFile> {
  const raw = JSON.parse(await file.text()) as BackupFile;
  if (raw.format !== FORMAT || !Array.isArray(raw.documents) || !Array.isArray(raw.files)) {
    throw new Error("That file is not a ScannedOnArrival backup.");
  }
  return raw;
}

export async function restoreBackup(backup: BackupFile, fallbackSettings: AppSettings): Promise<{
  documents: DocumentRecord[];
  settings: AppSettings;
  inbox: InboxItem[];
}> {
  const files: FileBlobRecord[] = backup.files.map((file) => ({
    id: file.id,
    documentId: file.documentId,
    blob: base64ToBlob(file.data, file.type),
  }));
  const settings = { ...fallbackSettings, ...backup.settings, onboardingComplete: true };
  const inbox = Array.isArray(backup.inbox) ? backup.inbox : [];
  await replaceAllData({
    documents: backup.documents,
    files,
    settings,
    inbox,
  });
  return { documents: backup.documents, settings, inbox };
}
