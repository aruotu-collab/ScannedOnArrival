import type { AppSettings, DocumentRecord, FileBlobRecord, InboxItem } from "../types";

const DB_NAME = "scannedonarrival";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) {
        db.createObjectStore("documents", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadDocuments(): Promise<DocumentRecord[]> {
  const db = await openDb();
  const tx = db.transaction("documents", "readonly");
  const rows = await reqToPromise(tx.objectStore("documents").getAll());
  db.close();
  return (rows as DocumentRecord[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveDocument(doc: DocumentRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("documents", "readwrite");
  await reqToPromise(tx.objectStore("documents").put(doc));
  db.close();
}

export async function saveDocuments(docs: DocumentRecord[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("documents", "readwrite");
  const store = tx.objectStore("documents");
  await Promise.all(docs.map((doc) => reqToPromise(store.put(doc))));
  db.close();
}

export function pageBlobId(documentId: string, index: number): string {
  return index <= 0 ? documentId : `${documentId}::p${index}`;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["documents", "files"], "readwrite");
  const doc = (await reqToPromise(tx.objectStore("documents").get(id))) as DocumentRecord | undefined;
  await reqToPromise(tx.objectStore("documents").delete(id));
  const pageCount = Math.max(1, doc?.pageCount ?? 1);
  for (let index = 0; index < pageCount; index += 1) {
    await reqToPromise(tx.objectStore("files").delete(pageBlobId(id, index)));
  }
  const leftovers = (await reqToPromise(tx.objectStore("files").getAll())) as FileBlobRecord[];
  await Promise.all(
    leftovers
      .filter((file) => file.documentId === id || file.id === id || file.id.startsWith(`${id}::p`))
      .map((file) => reqToPromise(tx.objectStore("files").delete(file.id))),
  );
  db.close();
}

export async function loadDocumentPages(documentId: string, pageCount = 1): Promise<Blob[]> {
  const pages: Blob[] = [];
  for (let index = 0; index < Math.max(1, pageCount); index += 1) {
    const blob = await loadFileBlob(pageBlobId(documentId, index));
    if (blob) pages.push(blob);
  }
  return pages;
}

export async function saveFileBlob(record: FileBlobRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("files", "readwrite");
  await reqToPromise(tx.objectStore("files").put(record));
  db.close();
}

export async function loadFileBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  const tx = db.transaction("files", "readonly");
  const row = (await reqToPromise(tx.objectStore("files").get(id))) as FileBlobRecord | undefined;
  db.close();
  return row?.blob ?? null;
}

export async function loadAllFileRecords(): Promise<FileBlobRecord[]> {
  const db = await openDb();
  const tx = db.transaction("files", "readonly");
  const rows = await reqToPromise(tx.objectStore("files").getAll());
  db.close();
  return rows as FileBlobRecord[];
}

export async function replaceAllData(input: {
  documents: DocumentRecord[];
  files: FileBlobRecord[];
  settings: AppSettings;
  inbox: InboxItem[];
}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["documents", "files", "meta"], "readwrite");
  await reqToPromise(tx.objectStore("documents").clear());
  await reqToPromise(tx.objectStore("files").clear());
  await Promise.all(input.documents.map((doc) => reqToPromise(tx.objectStore("documents").put(doc))));
  await Promise.all(input.files.map((file) => reqToPromise(tx.objectStore("files").put(file))));
  await reqToPromise(tx.objectStore("meta").put({ key: "settings", value: input.settings }));
  await reqToPromise(tx.objectStore("meta").put({ key: "inbox", value: input.inbox }));
  db.close();
}

export async function loadSettings(): Promise<AppSettings | null> {
  const db = await openDb();
  const tx = db.transaction("meta", "readonly");
  const row = await reqToPromise(tx.objectStore("meta").get("settings"));
  db.close();
  return (row as { key: string; value: AppSettings } | undefined)?.value ?? null;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  await reqToPromise(tx.objectStore("meta").put({ key: "settings", value: settings }));
  db.close();
}

export async function loadInbox(): Promise<InboxItem[]> {
  const db = await openDb();
  const tx = db.transaction("meta", "readonly");
  const row = await reqToPromise(tx.objectStore("meta").get("inbox"));
  db.close();
  return (row as { key: string; value: InboxItem[] } | undefined)?.value ?? [];
}

export async function saveInbox(items: InboxItem[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  await reqToPromise(tx.objectStore("meta").put({ key: "inbox", value: items }));
  db.close();
}

export async function clearAllData(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["documents", "files", "meta"], "readwrite");
  await reqToPromise(tx.objectStore("documents").clear());
  await reqToPromise(tx.objectStore("files").clear());
  await reqToPromise(tx.objectStore("meta").clear());
  db.close();
}

export function uid(): string {
  return crypto.randomUUID();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
