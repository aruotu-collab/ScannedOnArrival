import type { AppSettings, CategoryDef, CustomTypeDef, DeletedRecord, DocumentRecord, HouseholdPerson } from "../types";
import { getSupabase } from "./auth";
import { loadAllFileRecords, loadDeletedRecords, loadDocumentPages, pageBlobId, saveDeletedRecords, saveFileBlob } from "./storage";

const BUCKET = "user-files";

export type CloudSettings = {
  privacyMode: AppSettings["privacyMode"];
  showDemoHousehold: boolean;
  onboardingComplete: boolean;
  customCategories: CategoryDef[];
  customTypes: CustomTypeDef[];
  people: HouseholdPerson[];
  trackedTypeIds?: string[];
  shareWithDevices?: boolean;
};

export type CloudPayload = {
  documents: DocumentRecord[];
  deleted: DeletedRecord[];
  settings: CloudSettings;
};

export type CloudRow = CloudPayload & {
  updated_at: string;
};

type ApplyResult = {
  documents: DocumentRecord[];
  settings: AppSettings;
  changed: boolean;
  imported: boolean;
};

function stamp(): string {
  return new Date().toISOString();
}

export function docUpdatedAt(doc: DocumentRecord): string {
  return doc.updatedAt || doc.createdAt || "";
}

function fingerprint(doc: DocumentRecord): string {
  const { updatedAt: _updatedAt, ...rest } = doc;
  return JSON.stringify(rest);
}

export function stampDocumentChanges(previous: DocumentRecord[], next: DocumentRecord[]): DocumentRecord[] {
  const earlier = new Map(previous.map((doc) => [doc.id, doc]));
  const now = stamp();
  return next.map((doc) => {
    const old = earlier.get(doc.id);
    if (old && fingerprint(old) === fingerprint(doc)) return old.updatedAt ? old : { ...doc, updatedAt: docUpdatedAt(doc) };
    return { ...doc, updatedAt: now };
  });
}

export function cloudSettingsFrom(settings: AppSettings): CloudSettings {
  return {
    privacyMode: settings.privacyMode,
    showDemoHousehold: settings.showDemoHousehold,
    onboardingComplete: settings.onboardingComplete,
    customCategories: settings.customCategories ?? [],
    customTypes: settings.customTypes ?? [],
    people: settings.people ?? [],
    trackedTypeIds: settings.trackedTypeIds ?? [],
  };
}

export function applyCloudSettings(local: AppSettings, cloud: CloudSettings): AppSettings {
  return {
    ...local,
    privacyMode: cloud.privacyMode ?? local.privacyMode,
    showDemoHousehold: cloud.showDemoHousehold,
    onboardingComplete: local.onboardingComplete || cloud.onboardingComplete,
    customCategories: cloud.customCategories ?? [],
    customTypes: cloud.customTypes ?? [],
    people: cloud.people ?? [],
    trackedTypeIds: cloud.trackedTypeIds ?? local.trackedTypeIds ?? [],
  };
}

function unionById<T extends { id: string }>(first: T[], second: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of first) map.set(item.id, item);
  for (const item of second) if (!map.has(item.id)) map.set(item.id, item);
  return [...map.values()];
}

function unionPeople(local: HouseholdPerson[], remote: HouseholdPerson[]): HouseholdPerson[] {
  const byName = new Map<string, HouseholdPerson>();
  const out: HouseholdPerson[] = [];
  for (const person of [...local, ...remote]) {
    const nameKey = person.name.trim().toLowerCase();
    if (out.some((item) => item.id === person.id)) continue;
    if (nameKey && byName.has(nameKey)) continue;
    out.push(person);
    if (nameKey) byName.set(nameKey, person);
  }
  return out;
}

export function mergeIndexes(local: CloudPayload, remote: CloudPayload): CloudPayload {
  const deletedMap = new Map<string, string>();
  for (const item of [...local.deleted, ...remote.deleted]) {
    const prev = deletedMap.get(item.id);
    if (!prev || item.deletedAt > prev) deletedMap.set(item.id, item.deletedAt);
  }

  const docs = new Map<string, DocumentRecord>();
  for (const doc of [...remote.documents, ...local.documents]) {
    const deletedAt = deletedMap.get(doc.id);
    if (deletedAt && deletedAt >= docUpdatedAt(doc)) continue;
    const existing = docs.get(doc.id);
    if (!existing || docUpdatedAt(doc) >= docUpdatedAt(existing)) docs.set(doc.id, doc);
  }

  for (const [id, deletedAt] of deletedMap) {
    const kept = docs.get(id);
    if (kept && docUpdatedAt(kept) > deletedAt) deletedMap.delete(id);
  }

  return {
    documents: [...docs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    deleted: [...deletedMap.entries()].map(([id, deletedAt]) => ({ id, deletedAt })),
    settings: {
      privacyMode: local.settings.privacyMode === "inbox" || remote.settings.privacyMode === "inbox" ? "inbox" : "local",
      showDemoHousehold: local.settings.showDemoHousehold || remote.settings.showDemoHousehold,
      onboardingComplete: local.settings.onboardingComplete || remote.settings.onboardingComplete,
      customCategories: unionById(local.settings.customCategories, remote.settings.customCategories),
      customTypes: unionById(local.settings.customTypes, remote.settings.customTypes),
      people: unionPeople(local.settings.people, remote.settings.people),
      trackedTypeIds: [...new Set([...(local.settings.trackedTypeIds ?? []), ...(remote.settings.trackedTypeIds ?? [])])],
    },
  };
}

function fileObjectName(fileId: string): string {
  return fileId.replace(/:/g, "--");
}

async function signedInUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function indexOwnerUserId(): Promise<string | null> {
  const supabase = getSupabase();
  const userId = await signedInUserId();
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.rpc("my_household_id");
  if (error) return userId;
  return typeof data === "string" && data ? data : userId;
}

export function cloudSyncAvailable(): boolean {
  return Boolean(getSupabase());
}

export async function loadCloudIndex(): Promise<CloudRow | null> {
  const supabase = getSupabase();
  const userId = await indexOwnerUserId();
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("user_indexes")
    .select("documents, deleted, settings, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    documents: Array.isArray(data.documents) ? data.documents : [],
    deleted: Array.isArray(data.deleted) ? data.deleted : [],
    settings: {
      privacyMode: data.settings?.privacyMode === "inbox" ? "inbox" : "local",
      showDemoHousehold: Boolean(data.settings?.showDemoHousehold),
      onboardingComplete: Boolean(data.settings?.onboardingComplete),
      customCategories: Array.isArray(data.settings?.customCategories) ? data.settings.customCategories : [],
      customTypes: Array.isArray(data.settings?.customTypes) ? data.settings.customTypes : [],
      people: Array.isArray(data.settings?.people) ? data.settings.people : [],
      trackedTypeIds: Array.isArray(data.settings?.trackedTypeIds) ? data.settings.trackedTypeIds : [],
      shareWithDevices: data.settings?.shareWithDevices !== false,
    },
    updated_at: data.updated_at,
  };
}

export async function saveCloudIndex(payload: CloudPayload): Promise<string> {
  const supabase = getSupabase();
  const userId = await indexOwnerUserId();
  if (!supabase || !userId) throw new Error("Sign in to sync this index.");
  const updatedAt = stamp();
  const { error } = await supabase.from("user_indexes").upsert({
    user_id: userId,
    documents: payload.documents,
    deleted: payload.deleted,
    settings: payload.settings,
    updated_at: updatedAt,
  });
  if (error) throw error;
  return updatedAt;
}

export async function uploadStoredFiles(userId: string, documents: DocumentRecord[]): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const records = await loadAllFileRecords();
  const wanted = new Set(documents.filter((doc) => doc.storageKind === "stored").map((doc) => doc.id));
  for (const file of records) {
    if (!wanted.has(file.documentId)) continue;
    const path = `${userId}/${fileObjectName(file.id)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file.blob, {
      upsert: true,
      contentType: file.blob.type || "application/octet-stream",
    });
    if (error && !/already exists|Duplicate/i.test(error.message)) throw error;
  }
}

export async function downloadStoredFiles(userId: string, documents: DocumentRecord[]): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  for (const doc of documents) {
    if (doc.storageKind !== "stored") continue;
    const pages = Math.max(1, doc.pageCount ?? 1);
    const existing = await loadDocumentPages(doc.id, pages);
    if (existing.length >= pages) continue;
    for (let index = 0; index < pages; index += 1) {
      if (existing[index]) continue;
      const id = pageBlobId(doc.id, index);
      const path = `${userId}/${fileObjectName(id)}`;
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) continue;
      await saveFileBlob({ id, documentId: doc.id, blob: data });
    }
  }
}

async function removeStoredFiles(userId: string, deleted: DeletedRecord[]): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || deleted.length === 0) return;
  const paths = deleted.flatMap((item) => [
    `${userId}/${fileObjectName(item.id)}`,
    `${userId}/${fileObjectName(`${item.id}::p1`)}`,
    `${userId}/${fileObjectName(`${item.id}::p2`)}`,
  ]);
  await supabase.storage.from(BUCKET).remove(paths);
}

export async function localCloudPayload(settings: AppSettings, documents: DocumentRecord[]): Promise<CloudPayload> {
  return {
    documents,
    deleted: await loadDeletedRecords(),
    settings: cloudSettingsFrom(settings),
  };
}

export async function applyAccountIndex(
  localSettings: AppSettings,
  localDocuments: DocumentRecord[],
  options: { replaceRemote?: boolean } = {},
): Promise<ApplyResult> {
  const userId = await signedInUserId();
  const ownerId = await indexOwnerUserId();
  if (!userId || !ownerId) {
    return { documents: localDocuments, settings: localSettings, changed: false, imported: false };
  }

  const local = await localCloudPayload(localSettings, localDocuments);
  const remote = await loadCloudIndex();
  const householdMember = userId !== ownerId;
  if (!householdMember && remote && remote.settings.shareWithDevices === false) {
    return { documents: localDocuments, settings: localSettings, changed: false, imported: false };
  }
  const merged = options.replaceRemote || !remote ? local : mergeIndexes(local, remote);
  merged.settings.shareWithDevices = remote?.settings.shareWithDevices !== false;
  const mergedCore = {
    privacyMode: merged.settings.privacyMode,
    showDemoHousehold: merged.settings.showDemoHousehold,
    onboardingComplete: merged.settings.onboardingComplete,
    customCategories: merged.settings.customCategories,
    customTypes: merged.settings.customTypes,
    people: merged.settings.people,
    trackedTypeIds: merged.settings.trackedTypeIds ?? [],
  };
  const sameDocs =
    JSON.stringify(merged.documents) === JSON.stringify(localDocuments) &&
    JSON.stringify(mergedCore) === JSON.stringify(cloudSettingsFrom(localSettings));
  const nextSettings = applyCloudSettings(localSettings, merged.settings);

  const deletedChanged = JSON.stringify(merged.deleted) !== JSON.stringify(local.deleted);
  if (deletedChanged) await saveDeletedRecords(merged.deleted);
  if (!remote || !sameDocs || deletedChanged || options.replaceRemote) {
    await saveCloudIndex(merged);
  }
  await uploadStoredFiles(ownerId, merged.documents);
  await downloadStoredFiles(ownerId, merged.documents);
  if (options.replaceRemote) await removeStoredFiles(ownerId, merged.deleted);

  const localIds = new Set(localDocuments.map((doc) => doc.id));
  return {
    documents: merged.documents,
    settings: nextSettings,
    changed: !sameDocs || nextSettings.onboardingComplete !== localSettings.onboardingComplete,
    imported: merged.documents.some((doc) => !localIds.has(doc.id)),
  };
}

export async function loadShareWithDevices(): Promise<boolean> {
  const remote = await loadCloudIndex();
  if (!remote) return true;
  return remote.settings.shareWithDevices !== false;
}

export async function writeShareWithDevices(
  enabled: boolean,
  settings: AppSettings,
  documents: DocumentRecord[],
): Promise<void> {
  const remote = await loadCloudIndex();
  const local = await localCloudPayload(settings, documents);
  const payload = remote ? mergeIndexes(local, remote) : local;
  payload.settings.shareWithDevices = enabled;
  await saveCloudIndex(payload);
}

export function isCloudSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /user_indexes|household_members|household_invites|household_snapshot|my_household_id|plus_subscribers|plus_active|schema cache|does not exist|Could not find the table/i.test(message);
}
