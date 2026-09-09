export type ViewId = "ready" | "demo" | "documents" | "tree" | "inbox" | "settings";

export type PrivacyMode = "local" | "inbox";

export type StorageKind = "stored" | "referenced";

export type SourceKind =
  | "camera"
  | "upload"
  | "files"
  | "reference"
  | "email-forward"
  | "email-connect";

export type LocationProvider =
  | "local"
  | "icloud"
  | "google_drive"
  | "onedrive"
  | "downloads"
  | "files"
  | "camera"
  | "email";

export type DocStatus = "current" | "outdated" | "expiring" | "missing";

export type DocumentTypeId =
  | "council_tax"
  | "utility_bill"
  | "tenancy"
  | "bank_statement"
  | "payslip"
  | "tax"
  | "passport"
  | "driving_licence"
  | "car_insurance"
  | "mot"
  | "v5c"
  | "other";

export interface DocumentTypeDef {
  id: DocumentTypeId;
  label: string;
  categoryId: string;
  folderName: string;
  freshnessMonths?: number;
  expiryTracked?: boolean;
  keywords: string[];
  filenameHints: string[];
}

export interface CategoryDef {
  id: string;
  label: string;
}

export interface HouseholdPerson {
  id: string;
  name: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  typeId: DocumentTypeId;
  categoryId: string;
  personId?: string;
  period?: string;
  issuedOn?: string;
  expiresOn?: string;
  lastChecked: string;
  createdAt: string;
  storageKind: StorageKind;
  source: SourceKind;
  locationLabel: string;
  locationProvider: LocationProvider;
  fileName?: string;
  mimeType?: string;
  pageCount?: number;
  isCurrent: boolean;
  supersededBy?: string;
  notes?: string;
  mailboxRef?: string;
}

export interface FileBlobRecord {
  id: string;
  documentId: string;
  blob: Blob;
}

export interface InboxItem {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  attachmentName: string;
  typeId: DocumentTypeId;
  period?: string;
  status: "pending" | "added" | "dismissed";
  emailId?: string;
  attachmentId?: string;
  contentType?: string;
}

export interface FoundEmailDoc {
  id: string;
  typeId: DocumentTypeId;
  title: string;
  period?: string;
  mailbox: "gmail" | "outlook";
  added: boolean;
  skipped?: boolean;
  from?: string;
  subject?: string;
  receivedAt?: string;
  attachmentName?: string;
  contentType?: string;
  messageId?: string;
  attachmentId?: string;
}

export interface CustomTypeDef {
  id: string;
  label: string;
  categoryId: string;
}

export interface AppSettings {
  privacyMode: PrivacyMode;
  inboxAddress: string;
  gmailConnected: boolean;
  outlookConnected: boolean;
  showDemoHousehold: boolean;
  onboardingComplete: boolean;
  notificationsEnabled: boolean;
  openaiApiKey: string;
  customCategories: CategoryDef[];
  customTypes: CustomTypeDef[];
  people: HouseholdPerson[];
  mailboxSkipped: string[];
}

export interface AppState {
  documents: DocumentRecord[];
  settings: AppSettings;
  inbox: InboxItem[];
  foundEmail: FoundEmailDoc[];
}

export interface ClassifiedResult {
  typeId: DocumentTypeId;
  title: string;
  period?: string;
  issuedOn?: string;
  expiresOn?: string;
  confidence: "high" | "medium" | "low";
  excerpt?: string;
}

export interface AddDraft {
  method: SourceKind;
  file?: File;
  previewUrl?: string;
  classified?: ClassifiedResult;
  title: string;
  typeId: DocumentTypeId;
  categoryId: string;
  personId?: string;
  period: string;
  issuedOn: string;
  expiresOn: string;
  storageKind: StorageKind;
  locationLabel: string;
  locationProvider: LocationProvider;
  fileName?: string;
  mimeType?: string;
  files?: File[];
}
