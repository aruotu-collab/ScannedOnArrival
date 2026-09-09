import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { createPortal, flushSync } from "react-dom";
import type {
  AddDraft,
  AppSettings,
  DocumentRecord,
  DocumentTypeDef,
  DocumentTypeId,
  FoundEmailDoc,
  HouseholdPerson,
  InboxItem,
  LocationProvider,
  SourceKind,
  ViewId,
} from "./types";
import {
  allCategories,
  allTypes,
  categoryLabel,
  setCatalogExtras,
  suggestedPath,
  typeById,
} from "./data/taxonomy";
import { SAMPLE_DOCUMENTS, SAMPLE_INBOX, SAMPLE_PEOPLE } from "./data/sample";
import {
  documentsForFilter,
  missingTypeRows,
  personLabel,
  sameOwner,
  type PersonFilterId,
} from "./data/household";
import {
  confirmInboxFile,
  copyText,
  downloadInboxFile,
  ensureInboxAddress,
  fetchPendingInbox,
  mintInboxAddress,
  withoutSampleInbox,
} from "./lib/inbox";
import {
  connectGmail,
  disconnectGmail,
  downloadGmailAttachment,
  gmailConnectAvailable,
  gmailHasSession,
  listGmailDocuments,
} from "./lib/gmail";
import {
  connectOutlook,
  disconnectOutlook,
  downloadOutlookAttachment,
  listOutlookDocuments,
  outlookConnectAvailable,
  outlookHasSession,
} from "./lib/outlook";
import { mailboxRef, rememberFoundEmail } from "./lib/mailbox";
import { computeStatus, isSuperseded, locationLine, locationUrl, referencedOpenHint } from "./data/status";
import { previewPagesFromBlob, urlsFromPreviewPages } from "./lib/viewFile";
import {
  formatCheckedDate,
  isCheckedToday,
  searchDocuments,
} from "./data/search";
import {
  blobLooksLikePdf,
  extractPdfText,
  isImage,
  isPdf,
  isPdfBlob,
  rasterizePdfForStorage,
  renderPdfPages,
} from "./lib/pdf";
import { extractImageText } from "./lib/ocr";
import { consumeSharedFile, isDesktopLayout, isIos, isStandalone } from "./lib/pwa";
import { buildBackup, downloadBackup, fileLooksLikeBackup, parseBackupFile, restoreBackup } from "./lib/backup";
import { canShareBackup, sendBackupToAnotherPhone } from "./lib/sync";
import {
  authAvailable,
  getSupabase,
  onAuthChange,
  sendMagicLink,
  signOutUser,
  helloNameFromEmail,
  stripAuthParamsFromUrl,
  userEmail,
  verifyEmailCode,
} from "./lib/auth";
import { isAppPath, pathForView, viewFromPath, writeViewUrl } from "./lib/routes";
import { enableNotifications, listAttention, maybeNotify, type AttentionItem } from "./lib/reminders";
import { classifySmart } from "./lib/openai";
import { flattenImageFile } from "./lib/detect";
import { makeDemoLetterScenes } from "./lib/demoLetter";
import { enableDemoMotion } from "./lib/demoScan";
import { bleachScanBlob, cropImageFile, enhanceDocument, type CropInsets } from "./lib/scan";
import { DemoScanner } from "./scanner/DemoScanner";
import { ScannerScreen } from "./scanner/ScannerScreen";
import {
  clearAllData,
  deleteDocument,
  loadDocuments,
  loadDocumentPages,
  loadInbox,
  pageBlobId,
  loadSettings,
  saveDocuments,
  saveFileBlob,
  saveInbox,
  saveSettings,
  todayIso,
  uid,
} from "./lib/storage";

const DEFAULT_SETTINGS: AppSettings = {
  privacyMode: "local",
  inboxAddress: "",
  gmailConnected: false,
  outlookConnected: false,
  showDemoHousehold: false,
  onboardingComplete: false,
  notificationsEnabled: false,
  openaiApiKey: "",
  customCategories: [],
  customTypes: [],
  people: [],
  mailboxSkipped: [],
};

const DEFAULT_CROP: CropInsets = { top: 4, right: 4, bottom: 4, left: 4 };

function isMailboxAdd(method: SourceKind) {
  return method === "email-forward" || method === "email-connect";
}
const DEMO_DOC_ID = "demo-try-scan";
const DEMO_PAGE_LIMIT = 3;
const NAV_ITEMS: Array<{ id: ViewId; label: string; short: string }> = [
  { id: "documents", label: "Scan & Docs", short: "Scan & Docs" },
  { id: "tree", label: "Tree", short: "Tree" },
  { id: "inbox", label: "Inbox", short: "Inbox" },
  { id: "settings", label: "Settings", short: "Settings" },
];

function slugifyCatalogId(label: string, used: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "category";
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

function providerFromLabel(label: string): LocationProvider {
  const value = label.toLowerCase();
  if (value.includes("icloud")) return "icloud";
  if (value.includes("google")) return "google_drive";
  if (value.includes("onedrive") || value.includes("one drive")) return "onedrive";
  if (value.includes("download")) return "downloads";
  if (value.includes("email")) return "email";
  if (value.includes("files")) return "files";
  return "local";
}

function ProductBadge({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <p className={`product-badge ${tone}`}>
      <span>Scan with your phone</span>
      <span className="dot" aria-hidden="true">
        ·
      </span>
      <span>Web app in your browser</span>
    </p>
  );
}

function PhoneGlyph() {
  return (
    <svg className="scan-cta-glyph" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M17.4 2.6h13.2A6.4 6.4 0 0 1 37 9v30a6.4 6.4 0 0 1-6.4 6.4H17.4A6.4 6.4 0 0 1 11 39V9a6.4 6.4 0 0 1 6.4-6.4Zm3.8 3.2h5.6c.8 0 1.4.6 1.4 1.3s-.6 1.3-1.4 1.3h-5.6c-.8 0-1.4-.6-1.4-1.3s.6-1.3 1.4-1.3ZM15.6 11.2h16.8c.9 0 1.6.7 1.6 1.6v22.4c0 .9-.7 1.6-1.6 1.6H15.6c-.9 0-1.6-.7-1.6-1.6V12.8c0-.9.7-1.6 1.6-1.6Z"
      />
    </svg>
  );
}

function ScanCta({
  onScan,
  onAdd,
  title = "Scan with your phone",
  subtitle = "Point this browser at the paper — no app to install",
  addLabel = "or add a PDF or file",
  busy = false,
}: {
  onScan: () => void;
  onAdd?: () => void;
  title?: string;
  subtitle?: string;
  addLabel?: string;
  busy?: boolean;
}) {
  return (
    <div className="scan-cta">
      <button type="button" className="scan-cta-btn" disabled={busy} onClick={onScan}>
        <span className="scan-cta-icon">
          <PhoneGlyph />
        </span>
        <span className="scan-cta-copy">
          <strong>{title}</strong>
          <em>{subtitle}</em>
        </span>
      </button>
      {onAdd && (
        <button type="button" className="scan-cta-add" onClick={onAdd}>
          {addLabel}
        </button>
      )}
    </div>
  );
}

const INSTALL_DISMISS_KEY = "soa-install-dismissed";

function InstallBanner({
  prompt,
  onInstalled,
}: {
  prompt: BeforeInstallPromptEvent | null;
  onInstalled: () => void;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed || isStandalone()) return null;
  const ios = isIos();
  if (!prompt && !ios) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    } catch {
      /* ignore quota */
    }
    setDismissed(true);
  };

  return (
    <div className="install-banner">
      <strong>Add to Home Screen</strong>
      <span>
        {ios
          ? "In Safari, tap Share, then Add to Home Screen. You get a camera-ready icon without the App Store."
          : "Install this site like an app. Then you can share PDFs from Mail or Files straight in."}
      </span>
      <div className="row">
        {prompt && (
          <button
            className="primary"
            onClick={() => {
              void (async () => {
                await prompt.prompt();
                const choice = await prompt.userChoice;
                if (choice.outcome === "accepted") onInstalled();
              })();
            }}
          >
            Add to Home Screen
          </button>
        )}
        <button className="secondary" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

function PhoneHandoff() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(() => isDesktopLayout());

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 861px)");
    const sync = () => setVisible(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const url = `${window.location.origin}/?scan=1`;
    void import("qrcode").then((mod) => {
      const QRCode = mod.default;
      return QRCode.toDataURL(url, {
        width: 180,
        margin: 1,
        color: { dark: "#1B3A2F", light: "#F3EEE4" },
      }).then(setDataUrl);
    });
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="qr-strip">
      <div>
        <strong>Scan from your phone</strong>
        <span>
          Point your phone camera at this code. It opens this same site, ready to photograph a letter.
        </span>
      </div>
      {dataUrl ? <img src={dataUrl} alt="QR code that opens the phone scanner" width={120} height={120} /> : null}
    </div>
  );
}

function defaultLocation(method: SourceKind, storageKind: "stored" | "referenced"): string {
  if (storageKind === "stored") {
    return method === "camera" ? "Stored locally in ScannedOnArrival" : "Stored locally in ScannedOnArrival";
  }
  if (method === "files") return "Files → Documents";
  return "iCloud Drive → Documents";
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [foundEmail, setFoundEmail] = useState<FoundEmailDoc[]>([]);
  const [mailboxPreview, setMailboxPreview] = useState<{
    item: FoundEmailDoc;
    pages: Array<{ url: string; image: boolean }>;
  } | null>(null);
  const mailboxFiles = useRef(new Map<string, File>());
  const [view, setView] = useState<ViewId>(() => viewFromPath(window.location.pathname));
  const goToViewRef = useRef<(next: ViewId, opts?: { replace?: boolean; fromPop?: boolean }) => void>(() => {});
  const viewRef = useRef(view);
  viewRef.current = view;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addStart, setAddStart] = useState<"choose" | "camera">("choose");
  const [intendedTypeId, setIntendedTypeId] = useState<string | null>(null);
  const [incomingFile, setIncomingFile] = useState<File | null>(null);
  const [incomingMethod, setIncomingMethod] = useState<SourceKind | null>(null);
  const [pendingInboxItem, setPendingInboxItem] = useState<InboxItem | null>(null);
  const [pendingFoundItem, setPendingFoundItem] = useState<FoundEmailDoc | null>(null);
  const [inboxBusyId, setInboxBusyId] = useState<string | null>(null);
  const [inboxBusyKind, setInboxBusyKind] = useState<"confirm" | "remove" | "mailbox" | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [demoLanding, setDemoLanding] = useState(false);
  const [fromDemoNav, setFromDemoNav] = useState(false);
  const [inboxReady, setInboxReady] = useState(false);
  const [docQuery, setDocQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [receiveHint, setReceiveHint] = useState(false);
  const [focusDocId, setFocusDocId] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<PersonFilterId>("all");
  const incomingFileRef = useRef<(file: File) => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [docs, storedSettings, storedInbox] = await Promise.all([
          loadDocuments(),
          loadSettings(),
          loadInbox(),
        ]);
        if (!alive) return;
        setDocuments(docs);
        const next = {
          ...DEFAULT_SETTINGS,
          ...(storedSettings ?? {}),
          customCategories: storedSettings?.customCategories ?? [],
          customTypes: storedSettings?.customTypes ?? [],
          people: storedSettings?.people ?? [],
          mailboxSkipped: storedSettings?.mailboxSkipped ?? [],
          inboxAddress: ensureInboxAddress(storedSettings?.inboxAddress),
        };
        setCatalogExtras(next.customCategories, next.customTypes);
        setSettings(next);
        if (!storedSettings || next.inboxAddress !== storedSettings.inboxAddress) {
          await saveSettings(next);
        }
        const realInbox = withoutSampleInbox(storedInbox);
        setInbox(realInbox);
        if (realInbox.length !== storedInbox.length) await saveInbox(realInbox);
      } catch {
        if (!alive) return;
        const fallback = { ...DEFAULT_SETTINGS, inboxAddress: mintInboxAddress() };
        setSettings(fallback);
        setInbox([]);
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!hydrated || !settings.onboardingComplete) return;
    const sync = () => {
      syncNameplateOffset();
    };
    sync();
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
    };
  }, [hydrated, settings.onboardingComplete]);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    if (!getSupabase()) return;
    const url = new URL(window.location.href);
    const error = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (error) {
      setToast(error.replace(/\+/g, " "));
      stripAuthParamsFromUrl();
    }
    return onAuthChange((user) => {
      if (url.searchParams.has("code") && user) {
        setToast("Signed in");
        stripAuthParamsFromUrl();
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const openScan = params.get("scan") === "1";
    const shared = params.get("shared") === "1";
    const openRestore = params.get("restore") === "1";

    const consumeLaunch = async () => {
      if (shared) {
        const file = await consumeSharedFile();
        if (file) await incomingFileRef.current(file);
      } else if (openScan) {
        setAddStart("camera");
        setAddOpen(true);
      } else if (openRestore) {
        goToViewRef.current("settings", { replace: true });
        setReceiveHint(true);
      }
      if (openScan || shared || openRestore) {
        const url = new URL(window.location.href);
        url.searchParams.delete("scan");
        url.searchParams.delete("shared");
        url.searchParams.delete("restore");
        window.history.replaceState({ view: viewRef.current }, "", `${url.pathname}${url.search}`);
      }
    };

    void consumeLaunch();

    if (window.launchQueue) {
      window.launchQueue.setConsumer((params) => {
        void (async () => {
          const file = await params.files[0]?.getFile();
          if (!file) return;
          await incomingFileRef.current(file);
        })();
      });
    }
  }, [hydrated]);

  const persistSettings = async (next: AppSettings) => {
    const safe = {
      ...next,
      customCategories: next.customCategories ?? [],
      customTypes: next.customTypes ?? [],
      people: next.people ?? [],
      mailboxSkipped: next.mailboxSkipped ?? [],
    };
    setCatalogExtras(safe.customCategories, safe.customTypes);
    setSettings(safe);
    await saveSettings(safe);
  };

  const restoreFromFile = async (file: File): Promise<boolean> => {
    if (!window.confirm("Receive this index? It replaces everything on this browser.")) return false;
    try {
      const backup = await parseBackupFile(file);
      const restored = await restoreBackup(backup, DEFAULT_SETTINGS);
      const nextSettings = {
        ...DEFAULT_SETTINGS,
        ...restored.settings,
        customCategories: restored.settings.customCategories ?? [],
        customTypes: restored.settings.customTypes ?? [],
        people: restored.settings.people ?? [],
        mailboxSkipped: restored.settings.mailboxSkipped ?? [],
        inboxAddress: ensureInboxAddress(restored.settings.inboxAddress),
      };
      setCatalogExtras(nextSettings.customCategories, nextSettings.customTypes);
      setDocuments(restored.documents);
      setSettings(nextSettings);
      setInbox(withoutSampleInbox(restored.inbox));
      if (nextSettings.inboxAddress !== restored.settings.inboxAddress) {
        await persistSettings(nextSettings);
      }
      setFoundEmail([]);
      setReceiveHint(false);
      setToast(`Restored ${restored.documents.length} documents`);
      return true;
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Could not restore that backup.");
      return false;
    }
  };

  const openIncomingFile = async (file: File) => {
    if (await fileLooksLikeBackup(file)) {
      goToViewRef.current("settings", { replace: true });
      await restoreFromFile(file);
      return;
    }
    if (isImage(file) || isPdf(file) || (await blobLooksLikePdf(file))) {
      setIncomingFile(file);
      setAddStart("choose");
      setAddOpen(true);
      return;
    }
    setToast("Share a letter, a PDF, or a ScannedOnArrival backup.");
  };
  incomingFileRef.current = openIncomingFile;

  const openAdd = (start: "choose" | "camera", typeId?: string | null) => {
    setIncomingFile(null);
    setIncomingMethod(null);
    setPendingInboxItem(null);
    setPendingFoundItem(null);
    setIntendedTypeId(typeId ?? null);
    setAddStart(start);
    setAddOpen(true);
  };

  const createCategory = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Enter a category name.");
    const existing = allCategories().find((category) => category.label.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      const type = allTypes().find((item) => item.categoryId === existing.id) ?? typeById("other");
      return { categoryId: existing.id, typeId: type.id };
    }
    const used = new Set([...allCategories().map((category) => category.id), ...allTypes().map((type) => type.id)]);
    const categoryId = slugifyCatalogId(trimmed, used);
    used.add(categoryId);
    const typeId = slugifyCatalogId(`${trimmed}_docs`, used);
    await persistSettings({
      ...settings,
      customCategories: [...(settings.customCategories ?? []), { id: categoryId, label: trimmed }],
      customTypes: [...(settings.customTypes ?? []), { id: typeId, label: trimmed, categoryId }],
    });
    return { categoryId, typeId };
  };

  const createType = async (label: string, categoryId: string) => {
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Enter a document type name.");
    const existing = allTypes().find(
      (type) => type.categoryId === categoryId && type.label.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) return { typeId: existing.id, categoryId };
    const used = new Set([...allCategories().map((category) => category.id), ...allTypes().map((type) => type.id)]);
    const typeId = slugifyCatalogId(trimmed, used);
    await persistSettings({
      ...settings,
      customTypes: [...(settings.customTypes ?? []), { id: typeId, label: trimmed, categoryId }],
    });
    return { typeId, categoryId };
  };

  const createPerson = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a name.");
    const existing = (settings.people ?? []).find((person) => person.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const used = new Set((settings.people ?? []).map((person) => person.id));
    const person = { id: slugifyCatalogId(trimmed, used), name: trimmed };
    await persistSettings({
      ...settings,
      people: [...(settings.people ?? []), person],
    });
    return person;
  };

  const removePerson = async (id: string) => {
    await persistDocs(documents.map((doc) => (doc.personId === id ? { ...doc, personId: undefined } : doc)));
    await persistSettings({
      ...settings,
      people: (settings.people ?? []).filter((person) => person.id !== id),
    });
    if (personFilter === id) setPersonFilter("all");
  };

  const persistDocs = async (next: DocumentRecord[]) => {
    setDocuments(next);
    await saveDocuments(next);
  };

  const persistInbox = async (next: InboxItem[]) => {
    setInbox(next);
    await saveInbox(next);
  };

  const markChecked = async (id: string) => {
    const next = documents.map((doc) => (doc.id === id ? { ...doc, lastChecked: todayIso() } : doc));
    await persistDocs(next);
    setToast("Marked as checked today");
  };

  const keepReferencedCopy = async (original: DocumentRecord, file: File) => {
    const pdf = isPdf(file) || (await blobLooksLikePdf(file));
    let pagesToStore = [file];
    if (pdf) {
      try {
        pagesToStore = await rasterizePdfForStorage(file);
      } catch {
        pagesToStore = [file];
      }
    }
    for (let index = 0; index < pagesToStore.length; index += 1) {
      await saveFileBlob({
        id: pageBlobId(original.id, index),
        documentId: original.id,
        blob: pagesToStore[index],
      });
    }
    const updated: DocumentRecord = {
      ...original,
      storageKind: "stored",
      locationLabel: "Stored locally in ScannedOnArrival",
      locationProvider: "local",
      fileName: file.name,
      mimeType: pagesToStore[0]?.type || file.type,
      pageCount: pagesToStore.length,
      lastChecked: todayIso(),
    };
    await persistDocs(documents.map((doc) => (doc.id === original.id ? updated : doc)));
    setToast("Kept a copy on this phone");
  };

  const saveEditedDocument = async (
    original: DocumentRecord,
    next: DocumentRecord,
    makeCurrent: boolean,
    toastMessage = "Listing updated",
  ) => {
    const updated: DocumentRecord = {
      ...next,
      period: next.period || undefined,
      issuedOn: next.issuedOn || undefined,
      expiresOn: next.expiresOn || undefined,
      notes: next.notes?.trim() || undefined,
      isCurrent: makeCurrent,
      supersededBy: makeCurrent ? undefined : next.supersededBy,
    };
    const saved = documents.map((doc) => {
      if (doc.id === original.id) return updated;
      if (makeCurrent && doc.typeId === updated.typeId && doc.isCurrent && sameOwner(doc, updated)) {
        return { ...doc, isCurrent: false, supersededBy: original.id };
      }
      if (!makeCurrent && doc.supersededBy === original.id) {
        return { ...doc, supersededBy: undefined };
      }
      return doc;
    });
    await persistDocs(saved);
    setEditingId(null);
    setSelectedId(updated.id);
    setExpandedTypeId(updated.typeId);
    setToast(toastMessage);
    return updated;
  };

  const moveDocument = async (original: DocumentRecord, typeId: string, categoryId: string, makeCurrent: boolean) => {
    const next = {
      ...original,
      typeId: typeId as DocumentTypeId,
      categoryId,
    };
    const moved = await saveEditedDocument(
      original,
      next,
      makeCurrent,
      `Moved to ${categoryLabel(categoryId)} → ${typeById(typeId).folderName}`,
    );
    return moved;
  };

  useEffect(() => {
    if (!hydrated || settings.privacyMode !== "inbox") {
      setInboxReady(false);
      return;
    }
    let alive = true;
    const pull = async () => {
      const result = await fetchPendingInbox(settings.inboxAddress);
      if (!alive) return;
      setInboxReady(result.ready);
      if (!result.ready) return;
      setInbox((prev) => {
        const done = prev.filter((item) => item.status !== "pending");
        const doneIds = new Set(done.map((item) => item.id));
        const pending = result.items.filter((item) => !doneIds.has(item.id));
        const next = [...pending, ...done];
        void saveInbox(next);
        return next;
      });
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [hydrated, settings.privacyMode, settings.inboxAddress]);

  const people = settings.people ?? [];
  const visibleDocuments = useMemo(
    () => documentsForFilter(documents, personFilter),
    [documents, personFilter],
  );
  const currentDocs = visibleDocuments.filter((d) => d.isCurrent);
  const attention = useMemo(() => listAttention(visibleDocuments), [visibleDocuments]);
  const searchHits = useMemo(
    () => searchDocuments(visibleDocuments, docQuery, people),
    [visibleDocuments, docQuery, people],
  );
  const searching = Boolean(docQuery.trim());
  const editingDoc = editingId ? documents.find((doc) => doc.id === editingId) ?? null : null;

  useEffect(() => {
    if (!hydrated || !settings.notificationsEnabled) return;
    maybeNotify(attention);
  }, [hydrated, settings.notificationsEnabled, attention]);

  const startEmpty = async () => {
    await persistSettings({ ...settings, onboardingComplete: true, showDemoHousehold: false });
    goToViewRef.current("documents", { replace: true });
  };

  const startDemo = async () => {
    await persistDocs(SAMPLE_DOCUMENTS);
    await persistInbox(SAMPLE_INBOX);
    await persistSettings({
      ...settings,
      onboardingComplete: true,
      showDemoHousehold: true,
      people: SAMPLE_PEOPLE,
    });
    goToViewRef.current("documents", { replace: true });
  };

  const startTryDemo = async () => {
    await persistSettings({ ...settings, onboardingComplete: true, showDemoHousehold: false });
    goToViewRef.current("demo");
  };

  const goToView = (next: ViewId, opts?: { replace?: boolean; fromPop?: boolean }) => {
    const target = next === "ready" ? "documents" : next;
    const current = viewRef.current === "ready" ? "documents" : viewRef.current;
    if (target === current) {
      if (opts?.replace && !opts.fromPop) writeViewUrl(target, "replace");
      return;
    }
    if (current === "demo" && target === "documents") setFromDemoNav(true);

    const indexOf = (id: ViewId) => (id === "demo" ? -1 : Math.max(0, NAV_ITEMS.findIndex((item) => item.id === id)));
    const forward = opts?.fromPop
      ? false
      : target === "demo"
        ? true
        : current === "demo"
          ? false
          : indexOf(target) > indexOf(current);
    document.documentElement.dataset.navDir = forward ? "forward" : "back";

    const apply = () => {
      flushSync(() => setView(target));
      if (!opts?.fromPop) writeViewUrl(target, opts?.replace ? "replace" : "push");
      documentsScroller().scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    if (!prefersReducedMotion() && typeof document.startViewTransition === "function") {
      document.documentElement.classList.remove("nav-css");
      try {
        document.startViewTransition(apply);
        return;
      } catch {
        /* fall through to the CSS slide */
      }
    }
    document.documentElement.classList.add("nav-css");
    apply();
  };
  goToViewRef.current = goToView;

  const onNavClick = (event: MouseEvent<HTMLAnchorElement>, id: ViewId) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goToView(id);
  };

  useEffect(() => {
    if (!isAppPath(window.location.pathname)) writeViewUrl("documents", "replace");
    const onPop = () => {
      goToViewRef.current(viewFromPath(window.location.pathname), { fromPop: true });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openSearchHit = (doc: DocumentRecord) => {
    setDocQuery("");
    setSelectedId(doc.id);
    setExpandedTypeId(doc.typeId);
    setFocusDocId(doc.id);
    goToView("documents");
  };

  const openRealThing = () => {
    setDemoLanding(false);
    setFromDemoNav(false);
    goToView("documents");
    openAdd("camera");
  };

  const saveDemoScan = async (files: File[], savedTitle?: string) => {
    const pageFiles = files.filter(Boolean);
    const file = pageFiles[0];
    if (!file) return;
    const existing = documents.find((doc) => doc.id === DEMO_DOC_ID);
    const without = documents.filter((doc) => doc.id !== DEMO_DOC_ID);
    const nextDocs = without.map((doc) =>
      doc.typeId === "council_tax" && doc.isCurrent
        ? { ...doc, isCurrent: false, supersededBy: DEMO_DOC_ID }
        : doc,
    );
    const record: DocumentRecord = {
      id: DEMO_DOC_ID,
      title: savedTitle?.trim() ? `${savedTitle.trim()} (demo)` : "Council Tax 2026–27 (demo)",
      typeId: "council_tax",
      categoryId: "home",
      period: "2026–27",
      issuedOn: "2026-03-18",
      lastChecked: todayIso(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      storageKind: "stored",
      source: "camera",
      locationLabel: "Stored locally in ScannedOnArrival",
      locationProvider: "local",
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      pageCount: pageFiles.length,
      isCurrent: true,
      notes: "Added from the in-app demo.",
    };
    for (let index = 0; index < pageFiles.length; index += 1) {
      await saveFileBlob({ id: pageBlobId(DEMO_DOC_ID, index), documentId: DEMO_DOC_ID, blob: pageFiles[index] });
    }
    await persistDocs([record, ...nextDocs]);
    setSelectedId(DEMO_DOC_ID);
    setExpandedTypeId("council_tax");
    setDemoLanding(true);
    goToView("documents");
    setToast("Saved under Home → Council Tax");
  };

  const addDocument = async (draft: AddDraft, makeCurrent: boolean) => {
    const id = uid();
    const sameType = documents.filter((d) => d.typeId === draft.typeId && sameOwner(d, draft));
    const nextDocs = documents.map((d) =>
      makeCurrent && d.typeId === draft.typeId && d.isCurrent && sameOwner(d, draft)
        ? { ...d, isCurrent: false, supersededBy: id }
        : d,
    );
    const pageFiles = draft.files?.length ? draft.files : draft.file ? [draft.file] : [];
    const found = pendingFoundItem;
    const pending = pendingInboxItem;
    const record: DocumentRecord = {
      id,
      title: draft.title,
      typeId: draft.typeId,
      categoryId: draft.categoryId,
      personId: draft.personId || undefined,
      period: draft.period || undefined,
      issuedOn: draft.issuedOn || undefined,
      expiresOn: draft.expiresOn || undefined,
      lastChecked: todayIso(),
      createdAt: new Date().toISOString(),
      storageKind: draft.storageKind,
      source: draft.method,
      locationLabel: draft.locationLabel,
      locationProvider: draft.locationProvider,
      fileName: draft.fileName,
      mimeType: draft.mimeType,
      pageCount: pageFiles.length > 0 ? pageFiles.length : undefined,
      isCurrent: makeCurrent || sameType.every((d) => !d.isCurrent),
      mailboxRef: found ? mailboxRef(found) : undefined,
    };
    const saved = [record, ...nextDocs];
    if (draft.storageKind === "stored") {
      for (let index = 0; index < pageFiles.length; index += 1) {
        await saveFileBlob({ id: pageBlobId(id, index), documentId: id, blob: pageFiles[index] });
      }
    }
    await persistDocs(saved);
    setAddOpen(false);
    setIncomingFile(null);
    setIncomingMethod(null);
    setAddStart("choose");
    setSelectedId(id);
    setExpandedTypeId(record.typeId);
    goToView("documents");
    let toastMessage = `${record.title} added`;
    setPendingInboxItem(null);
    setPendingFoundItem(null);
    if (pending) {
      if (pending.emailId) {
        const dropped = await confirmInboxFile(pending, settings.inboxAddress);
        if (!dropped) toastMessage = "Saved locally. The server copy may still be waiting to drop.";
      }
      await persistInbox(inbox.map((row) => (row.id === pending.id ? { ...row, status: "added" } : row)));
    }
    if (found) {
      const ref = mailboxRef(found);
      setFoundEmail((rows) =>
        rows.map((row) => (row.id === found.id ? { ...row, added: true, skipped: false } : row)),
      );
      const stillSkipped = (settings.mailboxSkipped ?? []).filter((key) => key !== ref);
      if (stillSkipped.length !== (settings.mailboxSkipped ?? []).length) {
        await persistSettings({ ...settings, mailboxSkipped: stillSkipped });
      }
    }
    setToast(toastMessage);
  };

  const addFromInbox = async (item: InboxItem) => {
    if (inboxBusyId) return;
    setInboxBusyId(item.id);
    setInboxBusyKind("confirm");
    try {
      let file: File | null = null;
      if (item.emailId && item.attachmentId) {
        file = await downloadInboxFile(item, settings.inboxAddress);
        if (!file) {
          setToast("Could not download that PDF yet");
          return;
        }
      }
      if (!file) {
        setToast("That attachment is no longer available");
        return;
      }
      setPendingInboxItem(item);
      setIncomingFile(file);
      setIncomingMethod("email-forward");
      setIntendedTypeId(null);
      setAddStart("choose");
      setAddOpen(true);
    } finally {
      setInboxBusyId(null);
      setInboxBusyKind(null);
    }
  };

  const removeFromInbox = async (item: InboxItem) => {
    if (inboxBusyId) return;
    setInboxBusyId(item.id);
    setInboxBusyKind("remove");
    try {
      if (item.emailId) {
        const dropped = await confirmInboxFile(item, settings.inboxAddress);
        await persistInbox(inbox.map((row) => (row.id === item.id ? { ...row, status: "dismissed" } : row)));
        setToast(dropped ? "Removed without saving" : "Removed here. The server copy may still be waiting to drop.");
        return;
      }
      await persistInbox(inbox.map((row) => (row.id === item.id ? { ...row, status: "dismissed" } : row)));
      setToast("Removed without saving");
    } finally {
      setInboxBusyId(null);
      setInboxBusyKind(null);
    }
  };

  const connectMailbox = async (mailbox: "gmail" | "outlook") => {
    if (inboxBusyId) return;
    setInboxBusyId(mailbox);
    setInboxBusyKind("mailbox");
    try {
      const extra = rememberFoundEmail(
        mailbox === "gmail"
          ? await (async () => {
              await connectGmail();
              return listGmailDocuments();
            })()
          : await (async () => {
              await connectOutlook();
              return listOutlookDocuments();
            })(),
        documents,
        settings.mailboxSkipped ?? [],
      );
      setFoundEmail((current) => [...extra, ...current.filter((item) => item.mailbox !== mailbox)]);
      await persistSettings({
        ...settings,
        gmailConnected: mailbox === "gmail" ? true : settings.gmailConnected,
        outlookConnected: mailbox === "outlook" ? true : settings.outlookConnected,
      });
      const fresh = extra.filter((item) => !item.added && !item.skipped).length;
      const remembered = extra.filter((item) => item.added).length;
      const skippedCount = extra.filter((item) => item.skipped).length;
      const mailboxLabel = mailbox === "gmail" ? "Gmail" : "Outlook";
      setToast(
        fresh && remembered
          ? `Found ${fresh} new ${mailboxLabel} file${fresh === 1 ? "" : "s"} · ${remembered} already in your index`
          : fresh
            ? `Found ${fresh} new ${mailboxLabel} file${fresh === 1 ? "" : "s"}`
            : remembered
              ? `No new ${mailboxLabel} files. ${remembered} already in your index`
              : skippedCount
                ? `No new ${mailboxLabel} files. ${skippedCount} skipped`
                : `No recent PDF attachments in ${mailboxLabel}`,
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not connect that mailbox.");
    } finally {
      setInboxBusyId(null);
      setInboxBusyKind(null);
    }
  };

  const disconnectMailbox = async (mailbox: "gmail" | "outlook") => {
    if (mailbox === "gmail") await disconnectGmail();
    else await disconnectOutlook();
    setFoundEmail((current) =>
      current.filter((item) => item.mailbox !== mailbox || item.added || item.skipped),
    );
    await persistSettings({
      ...settings,
      gmailConnected: mailbox === "gmail" ? false : settings.gmailConnected,
      outlookConnected: mailbox === "outlook" ? false : settings.outlookConnected,
    });
    setToast(`${mailbox === "gmail" ? "Gmail" : "Outlook"} disconnected on this device`);
  };

  const skipFoundMailbox = async (item: FoundEmailDoc) => {
    const ref = mailboxRef(item);
    const skipped = [...new Set([...(settings.mailboxSkipped ?? []), ref])];
    setFoundEmail((rows) =>
      rows.map((row) => (mailboxRef(row) === ref ? { ...row, skipped: true, added: false } : row)),
    );
    await persistSettings({ ...settings, mailboxSkipped: skipped });
    setToast("Moved to Skipped");
  };

  const unskipFoundMailbox = async (item: FoundEmailDoc) => {
    const ref = mailboxRef(item);
    const skipped = (settings.mailboxSkipped ?? []).filter((key) => key !== ref);
    setFoundEmail((rows) =>
      rows.map((row) => (mailboxRef(row) === ref ? { ...row, skipped: false } : row)),
    );
    await persistSettings({ ...settings, mailboxSkipped: skipped });
    setToast("Back on Add");
  };

  const closeMailboxPreview = () => {
    setMailboxPreview((current) => {
      current?.pages.forEach((page) => URL.revokeObjectURL(page.url));
      return null;
    });
  };

  const loadMailboxFile = async (item: FoundEmailDoc): Promise<File | null> => {
    const key = mailboxRef(item);
    const cached = mailboxFiles.current.get(key);
    if (cached) return cached;
    const file =
      item.mailbox === "gmail" ? await downloadGmailAttachment(item) : await downloadOutlookAttachment(item);
    if (file) mailboxFiles.current.set(key, file);
    return file;
  };

  const pagesFromMailboxFile = async (file: File): Promise<Array<{ url: string; image: boolean }>> => {
    if (isImage(file) || isVisualImage(file.type, file.name)) {
      return [{ url: URL.createObjectURL(file), image: true }];
    }
    if (isPdf(file) || (await blobLooksLikePdf(file))) {
      const rendered = await renderPdfPages(file);
      return rendered.map((page) => ({ url: URL.createObjectURL(page), image: true }));
    }
    return [{ url: URL.createObjectURL(file), image: false }];
  };

  const viewFromMailbox = async (item: FoundEmailDoc) => {
    if (inboxBusyId) return;
    setInboxBusyId(item.id);
    setInboxBusyKind("mailbox");
    try {
      const file = await loadMailboxFile(item);
      if (!file) {
        setToast("Could not download that attachment yet");
        return;
      }
      const pages = await pagesFromMailboxFile(file);
      setMailboxPreview((current) => {
        current?.pages.forEach((page) => URL.revokeObjectURL(page.url));
        return { item, pages };
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not open that attachment.");
    } finally {
      setInboxBusyId(null);
      setInboxBusyKind(null);
    }
  };

  const addFromMailbox = async (item: FoundEmailDoc) => {
    if (inboxBusyId) return;
    setInboxBusyId(item.id);
    setInboxBusyKind("mailbox");
    try {
      const file = await loadMailboxFile(item);
      if (!file) {
        setToast("Could not download that attachment yet");
        return;
      }
      closeMailboxPreview();
      setPendingInboxItem(null);
      setPendingFoundItem(item);
      setIncomingFile(file);
      setIncomingMethod("email-connect");
      setIntendedTypeId(null);
      setAddStart("choose");
      setAddOpen(true);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not open that attachment.");
    } finally {
      setInboxBusyId(null);
      setInboxBusyKind(null);
    }
  };

  if (!hydrated) {
    return (
      <div className="onboarding">
        <div className="onboarding-card">
          <ProductBadge />
          <p className="kicker">ScannedOnArrival</p>
          <h1>Opening your document index…</h1>
        </div>
      </div>
    );
  }

  if (!settings.onboardingComplete) {
    return (
      <div className="onboarding">
        <div className="onboarding-card">
          <ProductBadge />
          <p className="kicker">Document readiness</p>
          <h1>ScannedOnArrival</h1>
          <p>
          This is a web app — open it in Safari or Chrome. It is not an App Store app; you can add it to
          your Home Screen if you want. When we say scan, we mean point your phone at the paper, in this
          browser tab.
        </p>
          <div className="fact-row">
            <div className="fact">
              <strong>Scan = your phone</strong>
              <span>Use this page’s camera to photograph a letter, bill or passport. Not a desktop scanner.</span>
            </div>
            <div className="fact">
              <strong>Runs in your browser</strong>
              <span>On a computer you can browse the index and upload PDFs. To scan paper, open this same site on your phone.</span>
            </div>
          </div>
          <div className="choice-grid">
            <button className="method" onClick={startEmpty}>
              <strong>Start private and empty</strong>
              <span>Scan with your phone, upload a PDF, or reference a file. Everything stays on this device.</span>
            </button>
            <button className="method" onClick={startDemo}>
              <strong>See a household example</strong>
              <span>Load sample Council Tax, insurance, passport and statements so you can explore the views.</span>
            </button>
            <button className="method featured" onClick={startTryDemo}>
              <strong>Try a 30-second demo</strong>
              <span>Watch a sample letter get scanned, then see it land under Council Tax. No paper needed.</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app${view === "demo" || demoLanding ? " demo-mode" : ""}`}>
      <AppNameplate onToast={setToast} />
      <aside className="sidebar">
        <div className="wordmark">
          <ProductBadge tone="dark" />
          <strong>ScannedOnArrival</strong>
          <span>What you have, how current it is, and where it lives.</span>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map(({ id, label }) => (
            <a
              key={id}
              href={pathForView(id)}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={(event) => onNavClick(event, id)}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="privacy-card">
          <small>Privacy</small>
          <strong>{settings.privacyMode === "local" ? "Private local mode" : "Convenience inbox mode"}</strong>
          <p>
            {settings.privacyMode === "local"
              ? "Documents stay on this device. Email PDFs are added after you download them."
              : "Forwarded attachments can pass through encrypted server processing, then be deleted."}
          </p>
        </div>
      </aside>

      <main className="main">
        <div className="page-stage">
        <header className="topbar">
          <div>
            <ProductBadge />
            <div className="topbar-heading">
              <h1>
                {view === "demo" && "Demo"}
                {(view === "documents" || view === "ready") && "Scan and Docs"}
                {view === "tree" && "Document tree"}
                {view === "inbox" && "Document inbox"}
                {view === "settings" && "Settings"}
              </h1>
              {(view === "documents" || view === "ready") && (
                <a
                  href={pathForView("demo")}
                  className="try-demo-btn"
                  onClick={(event) => onNavClick(event, "demo")}
                >
                  Try Demo
                </a>
              )}
            </div>
            <p>
              {view === "demo" && "Scan the letter, check the page, then save it under Council Tax."}
              {(view === "documents" || view === "ready") && "Scan a letter, then tap a category. What’s current, missing, or overdue sits with the file."}
              {view === "tree" && "A filing-cabinet view. Move a file, add a folder, or filter by person. The files can live anywhere."}
              {view === "inbox" && "Letterbox or inbox: both are ways documents arrive. Email stays optional."}
              {view === "settings" && "The index stays on this phone. Send it to another when you change phones."}
            </p>
          </div>
        </header>
        {(view === "demo" || demoLanding) && (
          <p className="demo-ribbon demo-ribbon-bar" aria-hidden="true">
            Demo
          </p>
        )}
        {view !== "demo" && (
          <div className="scan-hero">
            <ScanCta
              onScan={() => {
                if (demoLanding || fromDemoNav) {
                  openRealThing();
                  return;
                }
                openAdd("camera");
              }}
              onAdd={() => {
                setDemoLanding(false);
                setFromDemoNav(false);
                openAdd("choose");
              }}
            />
          </div>
        )}

        <div className="content">
          <InstallBanner
            prompt={installPrompt}
            onInstalled={() => setInstallPrompt(null)}
          />
          {view === "demo" && (
            <DemoView
              onSave={saveDemoScan}
              onTryReal={openRealThing}
            />
          )}
          {(view === "documents" || view === "ready" || view === "tree") && (
            <DocumentSearch
              value={docQuery}
              onChange={setDocQuery}
              resultCount={searching ? searchHits.length : undefined}
            />
          )}
          {(view === "documents" || view === "ready" || view === "tree") && people.length > 0 && (
            <PersonFilter people={people} value={personFilter} onChange={setPersonFilter} />
          )}
          {(view === "documents" || view === "ready") && (
            <>
              {searching ? (
                <SearchResults documents={searchHits} people={people} onOpen={openSearchHit} />
              ) : (
                <>
                  <HomeStatus
                    documents={visibleDocuments}
                    people={people}
                    personFilter={personFilter}
                    attention={attention}
                    onOpenAttention={(typeId, documentId) => {
                      setExpandedTypeId(typeId);
                      if (documentId) {
                        setSelectedId(documentId);
                        setFocusDocId(documentId);
                      }
                    }}
                  />
                  <DocumentsView
                    documents={currentDocs}
                    allDocuments={visibleDocuments}
                    people={people}
                    personFilter={personFilter}
                    expandedTypeId={expandedTypeId}
                    focusDocId={focusDocId}
                    onFocused={() => setFocusDocId(null)}
                    fromDemo={demoLanding}
                    onDismissDemo={() => setDemoLanding(false)}
                    onExpand={(typeId, documentId) => {
                      setExpandedTypeId(typeId);
                      if (documentId) setSelectedId(documentId);
                    }}
                    onAdd={(typeId) => openAdd("choose", typeId)}
                    onScan={(typeId) => openAdd("camera", typeId)}
                    onEdit={(id) => setEditingId(id)}
                    onChecked={(id) => void markChecked(id)}
                    onCopyLocation={async (label) => {
                      const ok = await copyText(label);
                      setToast(ok ? "Location copied" : "Could not copy the location.");
                    }}
                    onKeepLocal={(doc, file) => keepReferencedCopy(doc, file)}
                    onDeleted={async (id) => {
                      await deleteDocument(id);
                      setDocuments(documents.filter((d) => d.id !== id));
                      if (selectedId === id) setSelectedId(null);
                    }}
                  />
                </>
              )}
            </>
          )}
          {view === "tree" && (
            <TreeView
              documents={searching ? searchHits : visibleDocuments}
              allDocuments={documents}
              people={people}
              query={docQuery}
              onSelect={(id) => {
                const doc = documents.find((item) => item.id === id);
                setSelectedId(id);
                setExpandedTypeId(doc?.typeId ?? null);
                setFocusDocId(id);
                goToView("documents");
              }}
              onMove={moveDocument}
              onCreateCategory={createCategory}
              onCreateType={createType}
            />
          )}
          {view === "inbox" && (
            <InboxView
              settings={settings}
              inbox={inbox}
              inboxReady={inboxReady}
              foundEmail={foundEmail}
              documents={documents}
              onSettings={persistSettings}
              onConfirm={addFromInbox}
              onRemove={removeFromInbox}
              confirmingId={inboxBusyId}
              busyKind={inboxBusyKind}
              onAddMail={(file) => {
                setPendingInboxItem(null);
                setPendingFoundItem(null);
                setIntendedTypeId(null);
                setIncomingMethod("email-forward");
                setIncomingFile(file);
                setAddStart("choose");
                setAddOpen(true);
              }}
              onConnectGmail={() => void connectMailbox("gmail")}
              onConnectOutlook={() => void connectMailbox("outlook")}
              onDisconnectGmail={() => void disconnectMailbox("gmail")}
              onDisconnectOutlook={() => void disconnectMailbox("outlook")}
              onAddFound={addFromMailbox}
              onViewFound={(item) => void viewFromMailbox(item)}
              onSkipFound={(item) => void skipFoundMailbox(item)}
              onUnskipFound={(item) => void unskipFoundMailbox(item)}
              gmailReady={gmailConnectAvailable()}
              outlookReady={outlookConnectAvailable()}
              gmailConnected={gmailHasSession() || settings.gmailConnected}
              outlookConnected={outlookHasSession() || settings.outlookConnected}
              onToast={setToast}
            />
          )}
          {view === "settings" && (
            <SettingsView
              settings={settings}
              installPrompt={installPrompt}
              onInstalled={() => setInstallPrompt(null)}
              onSettings={persistSettings}
              onCreatePerson={createPerson}
              onRemovePerson={removePerson}
              onToast={setToast}
              receiveHint={receiveHint}
              onExport={async () => {
                try {
                  const backup = await buildBackup(settings);
                  downloadBackup(backup);
                  setToast("Backup saved on this device. On the other phone, Receive it.");
                } catch (err) {
                  setToast(err instanceof Error ? err.message : "Could not export the backup.");
                }
              }}
              onSend={async () => {
                try {
                  const backup = await buildBackup(settings);
                  const result = await sendBackupToAnotherPhone(backup);
                  if (result === "shared") {
                    setToast("Choose AirDrop, Messages, or Files. On the other phone, Receive that file.");
                  } else {
                    setToast("Backup saved on this device. On the other phone, Receive it.");
                  }
                } catch (err) {
                  if (err instanceof Error && err.name === "AbortError") return;
                  setToast(err instanceof Error ? err.message : "Could not send the index.");
                }
              }}
              onRestore={async (file) => {
                await restoreFromFile(file);
              }}
              onReset={async () => {
                await clearAllData();
                setDocuments([]);
                setInbox([]);
                setFoundEmail([]);
                await persistSettings({
                  ...DEFAULT_SETTINGS,
                  inboxAddress: mintInboxAddress(),
                  onboardingComplete: true,
                });
              }}
            />
          )}
        </div>
        </div>
      </main>

      <nav className="mobile-nav">
        {NAV_ITEMS.map(({ id, short }) => (
          <a
            key={id}
            href={pathForView(id)}
            className={view === id ? "active" : ""}
            aria-current={view === id ? "page" : undefined}
            onClick={(event) => onNavClick(event, id)}
          >
            {short}
          </a>
        ))}
      </nav>

      {addOpen && (
        <AddDocumentModal
          documents={documents}
          startAt={addStart}
          intendedTypeId={intendedTypeId}
          incomingFile={incomingFile}
          incomingMethod={incomingMethod}
          openaiApiKey={settings.openaiApiKey}
          people={people}
          defaultPersonId={personFilter !== "all" && personFilter !== "household" ? personFilter : ""}
          onCreatePerson={createPerson}
          onClose={() => {
            setAddOpen(false);
            setIncomingFile(null);
            setIncomingMethod(null);
            setPendingInboxItem(null);
            setPendingFoundItem(null);
            setIntendedTypeId(null);
            setAddStart("choose");
          }}
          onSave={addDocument}
          onCreateCategory={createCategory}
          onCreateType={createType}
        />
      )}
      {editingDoc && (
        <EditDocumentModal
          doc={editingDoc}
          onClose={() => setEditingId(null)}
          onSave={saveEditedDocument}
          onCreateCategory={createCategory}
          onCreateType={createType}
          people={people}
          onCreatePerson={createPerson}
        />
      )}
      {mailboxPreview && (
        <FileViewer
          title={mailboxPreview.item.title}
          pages={mailboxPreview.pages}
          startAt={0}
          onClose={closeMailboxPreview}
          primaryAction={{
            label: "Add this file",
            onClick: () => void addFromMailbox(mailboxPreview.item),
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function DemoView({
  onSave,
  onTryReal,
}: {
  onSave: (files: File[], title?: string) => Promise<void>;
  onTryReal: () => void;
}) {
  const [phase, setPhase] = useState<"intro" | "scanning" | "pages" | "form">("intro");
  const [deskUrl, setDeskUrl] = useState<string | null>(null);
  const [cleanUrl, setCleanUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<Array<{ id: string; file: File; url: string; selected: boolean }>>([]);
  const [activePage, setActivePage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Council Tax 2026–27");
  const [period, setPeriod] = useState("2026–27");
  const swipeStart = useRef<{ x: number; y: number; page: number } | null>(null);
  const swiped = useRef(false);
  const pagesRef = useRef(pages);
  const captureLock = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  pagesRef.current = pages;

  const currentPage = pages[activePage];
  const atPageLimit = pages.length >= DEMO_PAGE_LIMIT;

  useEffect(() => {
    return () => {
      if (deskUrl) URL.revokeObjectURL(deskUrl);
      if (cleanUrl) URL.revokeObjectURL(cleanUrl);
    };
  }, [deskUrl, cleanUrl]);

  const prepareScenes = async () => {
    if (deskUrl && cleanUrl && file) return;
    const scenes = await makeDemoLetterScenes();
    if (deskUrl) URL.revokeObjectURL(deskUrl);
    if (cleanUrl) URL.revokeObjectURL(cleanUrl);
    setDeskUrl(URL.createObjectURL(scenes.desk));
    setCleanUrl(URL.createObjectURL(scenes.clean));
    setFile(scenes.clean);
  };

  const startScan = async () => {
    setError(null);
    setLoading(true);
    try {
      await enableDemoMotion();
      await prepareScenes();
      if (pagesRef.current.length >= DEMO_PAGE_LIMIT) {
        setPhase("pages");
        return;
      }
      captureLock.current = false;
      setPhase("scanning");
    } catch {
      setError("The demo letter could not be drawn. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const addAnotherPage = () => {
    if (pagesRef.current.length >= DEMO_PAGE_LIMIT) return;
    captureLock.current = false;
    setPhase("scanning");
  };

  const keepCapture = () => {
    if (captureLock.current) {
      setPhase(pagesRef.current.length > 0 ? "pages" : "intro");
      return;
    }
    if (!file || !cleanUrl) {
      setPhase(pagesRef.current.length > 0 ? "pages" : "intro");
      return;
    }
    if (pagesRef.current.length >= DEMO_PAGE_LIMIT) {
      setPhase("pages");
      return;
    }
    captureLock.current = true;
    const next = [...pagesRef.current, { id: uid(), file, url: cleanUrl, selected: true }].slice(0, DEMO_PAGE_LIMIT);
    pagesRef.current = next;
    setPages(next);
    setActivePage(next.length - 1);
    setPhase("pages");
  };

  const goToPage = (next: number) => {
    setActivePage(Math.max(0, Math.min(pagesRef.current.length - 1, next)));
  };

  const endPageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    setDragging(false);
    setDragX(0);
    if (!start || pagesRef.current.length < 2) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const width = event.currentTarget.clientWidth || 1;
    if (Math.abs(dx) < Math.max(28, width * 0.12) || Math.abs(dx) <= Math.abs(dy)) return;
    swiped.current = true;
    goToPage(start.page + (dx < 0 ? 1 : -1));
  };

  const onPagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (pagesRef.current.length < 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    swipeStart.current = { x: event.clientX, y: event.clientY, page: activePage };
    swiped.current = false;
    setDragging(true);
    setDragX(0);
  };

  const onPagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    const atStart = start.page === 0 && dx > 0;
    const atEnd = start.page === pagesRef.current.length - 1 && dx < 0;
    setDragX(atStart || atEnd ? dx * 0.28 : dx);
  };

  const dropPage = () => {
    const remaining = pages.filter((_, index) => index !== activePage);
    pagesRef.current = remaining;
    setPages(remaining);
    setActivePage((index) => Math.max(0, Math.min(index, remaining.length - 1)));
    if (remaining.length === 0) {
      captureLock.current = false;
      setPhase("scanning");
      return;
    }
    setPhase("pages");
  };

  const saveResult = async () => {
    const chosen = pages.filter((page) => page.selected).map((page) => page.file);
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      await onSave(chosen, title);
    } finally {
      setSaving(false);
    }
  };

  const closeReview = () => {
    setPhase("intro");
    setPages([]);
    setActivePage(0);
  };

  return (
    <div className="demo-view">
      {phase === "intro" && (
        <>
          <p className="meta">
            No paper needed. A sample letter is already on the table. Scan it the same way as a real letter: find the
            page, tap the shutter, check the scan, then save it.
          </p>
          <ScanCta
            title={loading ? "Opening the camera…" : "Try the demo"}
            subtitle="A sample letter is already on the table — no paper needed"
            addLabel="Try the real thing now"
            busy={loading}
            onScan={() => void startScan()}
            onAdd={onTryReal}
          />
          {error && <p className="meta">{error}</p>}
          <ol className="demo-menu compact">
            <li>
              <strong>1. Find the page, then straighten it</strong>
              <span>White means searching, gold means found. Move the phone so the letter sits square.</span>
            </li>
            <li>
              <strong>2. Tap the shutter</strong>
              <span>Same button as the real camera in this tab. It turns green when it says Ready.</span>
            </li>
            <li>
              <strong>3. Check the scan</strong>
              <span>Add another page if the letter has a back, or save this file.</span>
            </li>
            <li>
              <strong>4. Confirm and file it</strong>
              <span>It lands under Home → Council Tax, on this device.</span>
            </li>
          </ol>
        </>
      )}

      {phase === "scanning" && deskUrl && (
        <DemoScanner
          deskUrl={deskUrl}
          pageCaption={`Page ${Math.min(pages.length + 1, DEMO_PAGE_LIMIT)} of ${DEMO_PAGE_LIMIT}`}
          onClose={() => setPhase(pagesRef.current.length > 0 ? "pages" : "intro")}
          onCaptured={keepCapture}
        />
      )}

      {phase === "pages" && currentPage && createPortal(
        <div className="demo-review">
          <p className="demo-ribbon demo-ribbon-bar" aria-hidden="true">
            Demo
          </p>
          <div className="demo-review-top">
            <button
              className="scanner-icon-btn"
              type="button"
              aria-label="Close"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={closeReview}
            >
              ×
            </button>
            <div>
              <p className="kicker">Your scans</p>
              <h2>Page {activePage + 1}</h2>
            </div>
            <span className="scanner-icon-btn ghost" aria-hidden="true" />
          </div>
          <p className="meta">
            {pages.length > 1
              ? `Swipe or drag sideways for page ${activePage + 1} of ${pages.length}. Demo mode keeps up to ${DEMO_PAGE_LIMIT} pages.`
              : `Add another page if the letter has a back, or save this file. Demo mode keeps up to ${DEMO_PAGE_LIMIT} pages.`}
          </p>
          {pages.length > 1 && (
            <div className="page-thumbs">
              {pages.map((page, index) => (
                <button
                  key={page.id}
                  className={`page-thumb ${index === activePage ? "active" : ""} ${page.selected ? "picked" : ""}`}
                  onClick={() => setActivePage(index)}
                >
                  <img src={page.url} alt={`Page ${index + 1}`} />
                  <span className="demo-ribbon demo-ribbon-corner" aria-hidden="true">
                    Demo
                  </span>
                </button>
              ))}
            </div>
          )}
          <div
            className={`demo-page-rail ${pages.length > 1 ? "swipeable" : ""}`}
            onPointerDown={onPagePointerDown}
            onPointerMove={onPagePointerMove}
            onPointerUp={endPageDrag}
            onPointerCancel={endPageDrag}
          >
            <div
              className={`demo-page-track${dragging ? " dragging" : ""}`}
              style={{ transform: `translateX(calc(-${activePage * 100}% + ${dragX}px))` }}
            >
              {pages.map((page, index) => (
                <div
                  key={page.id}
                  role="button"
                  tabIndex={0}
                  className="demo-review-page"
                  onClick={() => {
                    if (swiped.current) return;
                    setViewerOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setViewerOpen(true);
                  }}
                >
                  <img src={page.url} alt={`Scan ${index + 1}`} draggable={false} />
                  <span className="demo-ribbon demo-ribbon-corner" aria-hidden="true">
                    Demo
                  </span>
                  {pages.length > 1 && <span className="demo-page-index">Page {index + 1}</span>}
                </div>
              ))}
            </div>
            <PagePips count={pages.length} index={activePage} demo onSelect={goToPage} />
          </div>
          <label className="scan-select">
            <input
              type="checkbox"
              checked={currentPage.selected}
              onChange={(event) =>
                setPages((current) =>
                  current.map((page, index) =>
                    index === activePage ? { ...page, selected: event.target.checked } : page,
                  ),
                )
              }
            />
            Use this scan · tap the page to view the full file
          </label>
          <div className="scan-pages-actions">
            {!atPageLimit ? (
              <button className="primary" type="button" onClick={addAnotherPage}>
                Add another page
              </button>
            ) : (
              <p className="meta">Demo mode keeps up to {DEMO_PAGE_LIMIT} pages.</p>
            )}
            <button
              className="primary"
              type="button"
              disabled={pages.every((page) => !page.selected)}
              onClick={() => setPhase("form")}
            >
              Save selected scans
            </button>
            <button className="secondary" type="button" onClick={dropPage}>
              Don’t use this one
            </button>
          </div>
        </div>,
        document.body,
      )}

      {phase === "form" && createPortal(
        <div className="demo-review">
          <p className="demo-ribbon demo-ribbon-bar" aria-hidden="true">
            Demo
          </p>
          <div className="demo-review-top">
            <button
              className="scanner-icon-btn"
              type="button"
              aria-label="Back"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setPhase("pages")}
            >
              ×
            </button>
            <div>
              <p className="kicker">Save this file</p>
              <h2>Confirm what this is</h2>
            </div>
            <span className="scanner-icon-btn ghost" aria-hidden="true" />
          </div>
          {currentPage && (
            <button type="button" className="demo-review-page compact" onClick={() => setViewerOpen(true)}>
              <img src={currentPage.url} alt="Page to save" />
              <span className="demo-ribbon demo-ribbon-corner" aria-hidden="true">
                Demo
              </span>
            </button>
          )}
          <div className="notice ok">We think this belongs in {suggestedPath("council_tax", period)}. Save here, or change the title.</div>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field">
            <span>Category</span>
            <input value="Home" readOnly />
          </label>
          <label className="field">
            <span>Document type</span>
            <input value="Council Tax" readOnly />
          </label>
          <label className="field">
            <span>Period</span>
            <input value={period} onChange={(event) => setPeriod(event.target.value)} />
          </label>
          <div className="scan-pages-actions">
            <button className="primary" type="button" disabled={!title.trim() || saving} onClick={() => void saveResult()}>
              {saving ? "Saving…" : "Save this file"}
            </button>
            <button className="secondary" type="button" onClick={() => setPhase("pages")}>
              Back to pages
            </button>
          </div>
        </div>,
        document.body,
      )}

      {viewerOpen && pages.length > 0 && (
        <FileViewer
          title={title || "Council Tax 2026–27 (demo)"}
          demo
          pages={pages.map((page) => ({ url: page.url, image: true }))}
          startAt={activePage}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Remove",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="modal-back confirm-back" onClick={onCancel} role="presentation">
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-copy"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-copy" className="meta">
          {message}
        </p>
        <div className="row confirm-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function HomeStatus({
  documents,
  people,
  personFilter,
  attention,
  onOpenAttention,
}: {
  documents: DocumentRecord[];
  people: HouseholdPerson[];
  personFilter: PersonFilterId;
  attention: AttentionItem[];
  onOpenAttention: (typeId: string | null, documentId?: string) => void;
}) {
  type StatusTab = "current" | "attention" | "missing";
  const [tab, setTab] = useState<StatusTab>(attention.length > 0 ? "attention" : "current");
  const [panelOpen, setPanelOpen] = useState(false);
  const currentRows = documents
    .filter((doc) => !isSuperseded(doc) && computeStatus(doc) === "current")
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.createdAt.localeCompare(a.createdAt))
    .map((doc) => ({
      key: doc.id,
      typeId: doc.typeId,
      documentId: doc.id,
      title: doc.title,
      typeLabel: typeById(doc.typeId).label,
      detail: locationLine(doc),
      badge: doc.isCurrent ? "Current" : "Relevant",
      kind: "current" as const,
    }));
  const missingRows = missingTypeRows(documents, people, personFilter).map((row) => ({
    key: row.key,
    typeId: row.typeId,
    documentId: undefined as string | undefined,
    title: "Nothing saved here yet",
    typeLabel: row.typeLabel,
    detail: row.detail,
    badge: "Missing",
    kind: "missing" as const,
  }));
  const attentionRows = attention.map((item) => ({
    key: item.key,
    typeId: documents.find((doc) => doc.id === item.documentId)?.typeId ?? null,
    documentId: item.documentId,
    title: item.title,
    typeLabel: item.typeLabel,
    detail: item.detail,
    badge: item.kind === "expiring" ? "Expiring" : "Outdated",
    kind: item.kind,
  }));
  const ready = currentRows.length;
  const outdated = attentionRows.length;
  const missing = missingRows.length;
  const panels = {
    current: {
      title: "Current",
      count: ready === 1 ? "1 file" : `${ready} files`,
      lead: "These copies are in date — including extra copies that are still relevant.",
      empty: "No in-date copies yet.",
      rows: currentRows,
    },
    attention: {
      title: "Needs attention",
      count: outdated === 1 ? "1 action" : `${outdated} actions`,
      lead: "These copies are in your index but are outdated or about to expire.",
      empty: "Nothing needs attention.",
      rows: attentionRows,
    },
    missing: {
      title: "Missing",
      count: missing === 1 ? "1 missing" : `${missing} missing`,
      lead: "These types have no file in the index yet.",
      empty: "Every type has a file.",
      rows: missingRows,
    },
  } as const;
  const panel = panels[tab];
  const selectTab = (next: StatusTab) => {
    if (tab === next) {
      setPanelOpen((open) => !open);
      return;
    }
    setTab(next);
    setPanelOpen(true);
  };
  const tabClass = (id: StatusTab) =>
    `stat ${id}${tab === id ? " selected" : ""}${tab === id && panelOpen ? " open" : ""}`;

  return (
    <>
      <div className="how-strip">
        <strong>This is a phone scanner in your browser.</strong>
        <span>
          Point this tab at a letter — no App Store app. On a computer, add a PDF, or open the same site on
          your phone to scan paper.
        </span>
      </div>
      <PhoneHandoff />
      <div className={`status-sleeve ${tab}${panelOpen ? " open" : ""}`}>
        <div className="summary-strip" role="tablist" aria-label="Document status">
          <button
            type="button"
            role="tab"
            className={tabClass("current")}
            aria-selected={tab === "current"}
            aria-expanded={tab === "current" ? panelOpen : false}
            onClick={() => selectTab("current")}
          >
            <b>{ready}</b>
            <span className="stat-copy">Current</span>
            <span className="stat-chevron" aria-hidden="true" />
          </button>
          <button
            type="button"
            role="tab"
            className={tabClass("attention")}
            aria-selected={tab === "attention"}
            aria-expanded={tab === "attention" ? panelOpen : false}
            onClick={() => selectTab("attention")}
          >
            <b>{outdated}</b>
            <span className="stat-copy">Needs attention</span>
            <span className="stat-chevron" aria-hidden="true" />
          </button>
          <button
            type="button"
            role="tab"
            className={tabClass("missing")}
            aria-selected={tab === "missing"}
            aria-expanded={tab === "missing" ? panelOpen : false}
            onClick={() => selectTab("missing")}
          >
            <b>{missing}</b>
            <span className="stat-copy">Missing</span>
            <span className="stat-chevron" aria-hidden="true" />
          </button>
        </div>
        <div className={`attention-list ${tab}${panelOpen ? " open" : ""}`}>
          {panelOpen && (
            <>
              <p className="attention-lead">{panel.rows.length ? panel.lead : panel.empty}</p>
              {panel.rows.map((item) => (
                <button
                  key={item.key}
                  className="attention-row"
                  onClick={() => {
                    onOpenAttention(item.typeId, item.documentId);
                  }}
                >
                  <div>
                    <b>{item.typeLabel}</b>
                    <small>
                      {item.title} · {item.detail}
                    </small>
                  </div>
                  <span className={`badge ${item.kind}`}>{item.badge}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function statusBadgeText(status: "current" | "outdated" | "expiring" | "missing", doc?: DocumentRecord) {
  if (status === "current") return doc && !doc.isCurrent ? "Relevant" : "Current";
  if (status === "expiring") return "Expiring";
  if (status === "missing") return "Missing";
  return "Outdated";
}

function documentRoleLabel(doc: DocumentRecord) {
  if (doc.isCurrent) return "Latest document";
  if (isSuperseded(doc)) return "Earlier copy";
  return "Also relevant";
}

function copiesForType(documents: DocumentRecord[], typeId: string) {
  return documents
    .filter((doc) => doc.typeId === typeId)
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.createdAt.localeCompare(a.createdAt));
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function documentsScroller() {
  return document.scrollingElement ?? document.documentElement;
}

function syncNameplateOffset() {
  const plate = document.querySelector(".app-nameplate");
  const bottom = plate instanceof HTMLElement ? plate.getBoundingClientRect().bottom : 0;
  const offset = Math.max(16, Math.round(bottom) + 16);
  document.documentElement.style.setProperty("--nameplate-offset", `${offset}px`);
  return offset;
}

function categoryCards() {
  return [...document.querySelectorAll<HTMLElement>(".doc-category-card")];
}

function alignCategoryStack(categoryId: string, smooth = true) {
  const card = document.getElementById(`category-${categoryId}`);
  if (!card) return false;
  const offset = syncNameplateOffset();
  const cards = categoryCards();
  const index = cards.indexOf(card as HTMLElement);
  const target = index > 0 ? cards[index - 1] : card;
  const delta = target.getBoundingClientRect().top - offset;
  if (Math.abs(delta) <= 2) return true;
  const scroller = documentsScroller();
  const top = Math.max(0, scroller.scrollTop + delta);
  if (smooth && !prefersReducedMotion()) {
    scroller.scrollTo({ top, behavior: "smooth" });
  } else {
    scroller.scrollTop = top;
  }
  return true;
}

function revealCategoryTitle(categoryId: string, smooth = true) {
  alignCategoryStack(categoryId, smooth);
}

function focusOpenedCategory(categoryId: string, documentId?: string | null, smooth = true) {
  if (!alignCategoryStack(categoryId, smooth)) return false;
  if (documentId) {
    const slide = document.getElementById(`doc-${documentId}`);
    const rail = slide?.closest(".doc-rail");
    if (slide instanceof HTMLElement && rail instanceof HTMLElement) {
      rail.scrollTo({
        left: slide.offsetLeft,
        behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
      });
    }
  }
  return true;
}

function TypeTabStrip({
  types,
  documents,
  selectedId,
  onSelect,
}: {
  types: DocumentTypeDef[];
  documents: DocumentRecord[];
  selectedId: string;
  onSelect: (typeId: string) => void;
}) {
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  useEffect(() => {
    const tab = document.getElementById(`type-tab-${selectedId}`);
    const strip = tab?.closest(".doc-type-tabs");
    if (!tab || !(strip instanceof HTMLElement)) return;
    const left = tab.offsetLeft - strip.clientWidth / 2 + tab.offsetWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [selectedId]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swipeStart.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
    swiped.current = true;
    const index = types.findIndex((type) => type.id === selectedId);
    const next = types[index + (dx < 0 ? 1 : -1)];
    if (next) onSelect(next.id);
  };

  return (
    <div
      className="doc-type-tabs"
      role="tablist"
      aria-label="Document types"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        swipeStart.current = null;
      }}
    >
      {types.map((type) => {
        const copies = copiesForType(documents, type.id);
        const current = copies.find((doc) => doc.isCurrent) ?? copies[0];
        const status = current ? computeStatus(current) : "missing";
        const selected = type.id === selectedId;
        return (
          <button
            key={type.id}
            id={`type-tab-${type.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`doc-type-tab ${selected ? "selected" : ""} ${status}`}
            onClick={() => {
              if (swiped.current) return;
              onSelect(type.id);
            }}
          >
            <span className="doc-type-tab-label">{type.label}</span>
            <span className="doc-count">{copies.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function PersonFilter({
  people,
  value,
  onChange,
}: {
  people: HouseholdPerson[];
  value: PersonFilterId;
  onChange: (value: PersonFilterId) => void;
}) {
  return (
    <div className="person-filter" role="tablist" aria-label="Whose papers">
      <button type="button" role="tab" className={value === "all" ? "active" : ""} aria-selected={value === "all"} onClick={() => onChange("all")}>
        All
      </button>
      <button
        type="button"
        role="tab"
        className={value === "household" ? "active" : ""}
        aria-selected={value === "household"}
        onClick={() => onChange("household")}
      >
        Household
      </button>
      {people.map((person) => (
        <button
          key={person.id}
          type="button"
          role="tab"
          className={value === person.id ? "active" : ""}
          aria-selected={value === person.id}
          onClick={() => onChange(person.id)}
        >
          {person.name}
        </button>
      ))}
    </div>
  );
}

function WhoseField({
  people,
  personId,
  onChange,
  onCreatePerson,
}: {
  people: HouseholdPerson[];
  personId: string;
  onChange: (personId: string) => void;
  onCreatePerson: (name: string) => Promise<HouseholdPerson>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <label className="field">
        <span>Whose</span>
        <select
          value={creating ? "__new__" : personId}
          onChange={(event) => {
            if (event.target.value === "__new__") {
              setCreating(true);
              return;
            }
            setCreating(false);
            onChange(event.target.value);
          }}
        >
          <option value="">Household — shared</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
          <option value="__new__">Add a person…</option>
        </select>
      </label>
      {creating && (
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Alex, Sam…"
            />
          </label>
          <button
            className="primary"
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              void (async () => {
                try {
                  const created = await onCreatePerson(name);
                  setCreating(false);
                  setName("");
                  setError(null);
                  onChange(created.id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not add that person.");
                }
              })();
            }}
          >
            Add
          </button>
        </div>
      )}
      {error && (
        <div className="modal-status warn" role="status">
          {error}
        </div>
      )}
    </>
  );
}

function DocumentSearch({
  value,
  onChange,
  resultCount,
}: {
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
}) {
  return (
    <div className="doc-search">
      <label className="doc-search-field">
        <span className="visually-hidden">Search documents</span>
        <input
          type="search"
          placeholder="Search documents"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
        {value && (
          <button type="button" className="doc-search-clear" onClick={() => onChange("")} aria-label="Clear search">
            Clear
          </button>
        )}
      </label>
      {resultCount != null && (
        <p className="meta">
          {resultCount === 0 ? "No matches" : resultCount === 1 ? "1 match" : `${resultCount} matches`}
        </p>
      )}
    </div>
  );
}

function SearchResults({
  documents,
  people,
  onOpen,
}: {
  documents: DocumentRecord[];
  people: HouseholdPerson[];
  onOpen: (doc: DocumentRecord) => void;
}) {
  if (documents.length === 0) {
    return (
      <div className="card empty">
        <h2>No matches</h2>
        <p>Try a title, category, or folder name — like passport, council tax, or iCloud.</p>
      </div>
    );
  }
  return (
    <div className="search-results">
      {documents.map((doc) => {
        const status = computeStatus(doc);
        return (
          <button key={doc.id} type="button" className="search-result" onClick={() => onOpen(doc)}>
            <div className="search-result-top">
              <strong>{doc.title}</strong>
              <span className={`badge ${status === "current" && !doc.isCurrent ? "relevant" : status}`}>
                {statusBadgeText(status, doc)}
              </span>
            </div>
            <span className="meta">
              {people.length > 0 ? `${personLabel(people, doc.personId)} · ` : ""}
              {categoryLabel(doc.categoryId)} → {typeById(doc.typeId).label}
              {doc.period ? ` · ${doc.period}` : ""} · Checked {formatCheckedDate(doc.lastChecked)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DocumentsView({
  documents,
  allDocuments,
  people,
  personFilter,
  expandedTypeId,
  focusDocId,
  onFocused,
  fromDemo,
  onDismissDemo,
  onExpand,
  onAdd,
  onScan,
  onEdit,
  onChecked,
  onCopyLocation,
  onKeepLocal,
  onDeleted,
}: {
  documents: DocumentRecord[];
  allDocuments: DocumentRecord[];
  people: HouseholdPerson[];
  personFilter: PersonFilterId;
  expandedTypeId: string | null;
  focusDocId?: string | null;
  onFocused?: () => void;
  fromDemo?: boolean;
  onDismissDemo?: () => void;
  onExpand: (typeId: string | null, documentId?: string) => void;
  onAdd: (typeId: string) => void;
  onScan: (typeId: string) => void;
  onEdit: (id: string) => void;
  onChecked: (id: string) => void;
  onCopyLocation: (label: string) => void;
  onKeepLocal: (doc: DocumentRecord, file: File) => Promise<void>;
  onDeleted: (id: string) => void;
}) {
  const catalog = allCategories()
    .map((category) => {
      const types = allTypes().filter(
        (type) =>
          type.categoryId === category.id && (type.id !== "other" || allDocuments.some((doc) => doc.typeId === "other")),
      );
      const count = allDocuments.filter((doc) => doc.categoryId === category.id).length;
      const statuses = types.map((type) => {
        const copies = copiesForType(allDocuments, type.id);
        const current = copies.find((doc) => doc.isCurrent) ?? copies[0];
        return current ? computeStatus(current) : "missing";
      });
      const missingHere = missingTypeRows(allDocuments, people, personFilter).filter((row) =>
        types.some((type) => type.id === row.typeId),
      ).length;
      return {
        category,
        types,
        count,
        ready: statuses.filter((status) => status === "current").length,
        attention: statuses.filter((status) => status === "outdated" || status === "expiring").length,
        missing: missingHere,
      };
    })
    .filter((group) => group.types.length);

  const selectedType = expandedTypeId ? typeById(expandedTypeId) : null;
  const selectedCategoryId =
    catalog.find((group) => group.category.id === selectedType?.categoryId)?.category.id ?? null;
  const selectedCategoryIndex = catalog.findIndex((group) => group.category.id === selectedCategoryId);
  const categoryPeek =
    selectedCategoryIndex < 0
      ? "none"
      : selectedCategoryIndex > 0 && selectedCategoryIndex < catalog.length - 1
        ? "both"
        : selectedCategoryIndex > 0
          ? "prev"
          : selectedCategoryIndex < catalog.length - 1
            ? "next"
            : "none";
  const pendingPin = useRef<{ id: string; y: number } | null>(null);
  const stackSwipe = useRef<{ x: number; y: number; fromStack: boolean } | null>(null);
  const onFocusedRef = useRef(onFocused);
  onFocusedRef.current = onFocused;

  const selectType = (typeId: string, pinY?: number) => {
    const categoryId = typeById(typeId).categoryId;
    if (pinY != null && categoryId !== selectedCategoryId) {
      pendingPin.current = { id: categoryId, y: pinY };
    }
    const copies = copiesForType(allDocuments, typeId);
    const current = copies.find((doc) => doc.isCurrent) ?? copies[0];
    onExpand(typeId, current?.id);
  };

  const selectCategory = (categoryId: string, pinY?: number) => {
    const group = catalog.find((item) => item.category.id === categoryId);
    if (!group) return;
    if (selectedCategoryId === categoryId) {
      onExpand(null);
      return;
    }
    const preferred =
      group.types.find((type) => type.id === expandedTypeId) ??
      group.types.find((type) => copiesForType(allDocuments, type.id).length > 0) ??
      group.types[0];
    if (preferred) selectType(preferred.id, pinY);
  };

  const endStackSwipe = (event: PointerEvent<HTMLDivElement>) => {
    const start = stackSwipe.current;
    stackSwipe.current = null;
    if (!start?.fromStack || !selectedCategoryId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) < 64 || Math.abs(dy) <= Math.abs(dx)) return;
    const next = catalog[selectedCategoryIndex + (dy < 0 ? 1 : -1)];
    if (next) selectCategory(next.category.id);
  };

  useLayoutEffect(() => {
    if (!selectedCategoryId) return;
    const pin = pendingPin.current;
    pendingPin.current = null;
    const card = document.getElementById(`category-${selectedCategoryId}`);
    if (!card) return;
    const catalogEl = card.closest(".docs-catalog");
    const cards = categoryCards();
    const index = cards.indexOf(card as HTMLElement);
    const headHeight = (item?: HTMLElement) =>
      item?.querySelector<HTMLElement>(".doc-category-card-head")?.offsetHeight ?? 0;
    const peek = Math.max(headHeight(cards[index - 1]), headHeight(cards[index + 1]), 72);
    if (catalogEl instanceof HTMLElement) {
      catalogEl.style.setProperty("--category-peek", `${peek}px`);
    }

    if (pin && pin.id === selectedCategoryId) {
      const drift = card.getBoundingClientRect().top - pin.y;
      if (Math.abs(drift) > 1) {
        documentsScroller().scrollTop += drift;
      }
    }

    revealCategoryTitle(selectedCategoryId, false);
    const retry = window.setTimeout(() => revealCategoryTitle(selectedCategoryId, false), 340);
    const settle = window.setTimeout(() => revealCategoryTitle(selectedCategoryId, false), 700);
    return () => {
      window.clearTimeout(retry);
      window.clearTimeout(settle);
    };
  }, [selectedCategoryId]);

  useLayoutEffect(() => {
    if (!focusDocId || !selectedCategoryId) return;
    const categoryId = selectedCategoryId;
    const documentId = focusDocId;
    const run = (smooth: boolean) => focusOpenedCategory(categoryId, documentId, smooth);
    run(false);
    const frame = window.requestAnimationFrame(() => run(false));
    const retry = window.setTimeout(() => {
      run(!prefersReducedMotion());
      onFocusedRef.current?.();
    }, 360);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
    };
  }, [focusDocId, selectedCategoryId]);

  return (
    <>
      <h2 className="docs-section-label">Documents</h2>
      {documents.length === 0 && (
        <div className="card empty">
          <h2>Nothing indexed yet</h2>
          <p>Tap a category, pick a type tab, then Scan with your phone. That type is selected before the camera opens.</p>
        </div>
      )}
      <div
        className="docs-catalog"
        data-peeks={categoryPeek}
        onPointerDown={(event) => {
          if (!selectedCategoryId) return;
          const fromStack = Boolean(
            (event.target as HTMLElement | null)?.closest(
              ".doc-category-card-head, .doc-type-tabs, .preview, .page-rail, .doc-rail",
            ),
          );
          stackSwipe.current = { x: event.clientX, y: event.clientY, fromStack };
        }}
        onPointerUp={endStackSwipe}
        onPointerCancel={() => {
          stackSwipe.current = null;
        }}
      >
      {catalog.map((group, index) => {
        const selected = group.category.id === selectedCategoryId;
        const peekPrev = selectedCategoryIndex > 0 && index === selectedCategoryIndex - 1;
        const peekNext = selectedCategoryIndex >= 0 && index === selectedCategoryIndex + 1;
        const activeType =
          group.types.find((type) => type.id === expandedTypeId) ??
          group.types.find((type) => copiesForType(allDocuments, type.id).length > 0) ??
          group.types[0];
        const copies = activeType ? copiesForType(allDocuments, activeType.id) : [];
        const current = copies.find((doc) => doc.isCurrent) ?? copies[0];
        return (
          <section
            key={group.category.id}
            id={`category-${group.category.id}`}
            className={`doc-category-card ${selected ? "selected" : ""} ${peekPrev ? "peek-prev" : ""} ${peekNext ? "peek-next" : ""}`}
          >
            <div className="doc-category-card-head">
              <button
                type="button"
                className="doc-category-card-select"
                aria-expanded={selected}
                aria-pressed={selected}
                onClick={(event) => {
                  selectCategory(group.category.id, event.currentTarget.getBoundingClientRect().top);
                  event.currentTarget.blur();
                }}
              >
                <div className="doc-category-copy">
                  <div className="doc-category-title">
                    <h2>{group.category.label}</h2>
                    {selected && <span className="badge current">Selected</span>}
                  </div>
                  <p className="meta">
                    {group.count} {group.count === 1 ? "document" : "documents"}
                    {group.ready > 0 ? ` · ${group.ready} current` : ""}
                    {group.attention > 0 ? ` · ${group.attention} needs attention` : ""}
                    {group.missing > 0 ? ` · ${group.missing} missing` : ""}
                  </p>
                </div>
              </button>
              {selected && activeType && (
                <div className="doc-category-card-aside">
                  <button
                    type="button"
                    className="doc-category-scan"
                    aria-label={`Scan ${activeType.label} with your phone`}
                    onClick={() => onScan(activeType.id)}
                  >
                    <PhoneGlyph />
                    <span>Scan</span>
                  </button>
                  <button type="button" className="doc-category-add" onClick={() => onAdd(activeType.id)}>
                    Add a PDF
                  </button>
                </div>
              )}
              <button
                type="button"
                className="doc-category-chevron-btn"
                aria-expanded={selected}
                aria-label={selected ? `Collapse ${group.category.label}` : `Expand ${group.category.label}`}
                onClick={(event) => {
                  selectCategory(group.category.id, event.currentTarget.getBoundingClientRect().top);
                  event.currentTarget.blur();
                }}
              >
                <span className="doc-category-chevron" aria-hidden="true" />
              </button>
            </div>
            {activeType && (
              <div className={`doc-category-body${selected ? " open" : ""}`} inert={!selected || undefined}>
                <div className="doc-category-body-clip">
                  <div className="doc-category-body-inner">
                    {selected && fromDemo && (
                      <div className="demo-landing">
                        <div>
                          <strong>This is where it lives</strong>
                          <span>Home → Council Tax · on this device. Your scan is the latest copy below.</span>
                        </div>
                        {onDismissDemo && (
                          <button type="button" className="secondary" onClick={onDismissDemo}>
                            Got it
                          </button>
                        )}
                      </div>
                    )}
                    <TypeTabStrip
                      types={group.types}
                      documents={allDocuments}
                      selectedId={activeType.id}
                      onSelect={selectType}
                    />
                    {copies.length === 0 && <p className="meta doc-type-empty">Nothing saved here yet. Scan into this type.</p>}
                    {current && (
                      <div className="doc-rail" aria-label={`${activeType.label} copies`}>
                        {copies.map((doc) => (
                          <div key={doc.id} id={`doc-${doc.id}`} className="doc-slide">
                            <DocumentDetail
                              doc={doc}
                              previous={copies.filter((item) => item.id !== doc.id)}
                              ownerLabel={people.length > 0 ? personLabel(people, doc.personId) : undefined}
                              compact
                              onEdit={() => onEdit(doc.id)}
                              onChecked={() => onChecked(doc.id)}
                              onCopyLocation={() => onCopyLocation(doc.locationLabel)}
                              onKeepLocal={(file) => onKeepLocal(doc, file)}
                              onDeleted={() => onDeleted(doc.id)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        );
      })}
      </div>
    </>
  );
}

function isVisualImage(mimeType?: string, fileName?: string) {
  const type = (mimeType || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (type.includes("pdf")) return false;
  return /\.(jpe?g|png|gif|webp|heic)$/i.test(fileName || "");
}

type ViewerPoint = { x: number; y: number };
type ViewerPan = { scale: number; x: number; y: number };

const VIEWER_MIN_ZOOM = 1;
const VIEWER_MAX_ZOOM = 5;
const VIEWER_IDENTITY: ViewerPan = { scale: 1, x: 0, y: 0 };

function clampViewerPan(next: ViewerPan, frame: HTMLElement | null): ViewerPan {
  const scale = Math.min(VIEWER_MAX_ZOOM, Math.max(VIEWER_MIN_ZOOM, next.scale));
  if (!frame) return { scale, x: 0, y: 0 };
  const page = frame.querySelector(".file-viewer-page") as HTMLElement | null;
  const extraX = Math.max(0, (page?.offsetWidth ?? frame.clientWidth) * scale - frame.clientWidth);
  const extraY = Math.max(0, (page?.offsetHeight ?? frame.clientHeight) * scale - frame.clientHeight);
  return {
    scale,
    x: extraX === 0 ? 0 : Math.min(0, Math.max(-extraX, next.x)),
    y: extraY === 0 ? 0 : Math.min(0, Math.max(-extraY, next.y)),
  };
}

function zoomViewerAround(current: ViewerPan, nextScale: number, origin: ViewerPoint): ViewerPan {
  const scale = Math.min(VIEWER_MAX_ZOOM, Math.max(VIEWER_MIN_ZOOM, nextScale));
  return {
    scale,
    x: origin.x - ((origin.x - current.x) / current.scale) * scale,
    y: origin.y - ((origin.y - current.y) / current.scale) * scale,
  };
}

function FileViewer({
  title,
  pages,
  startAt,
  onClose,
  demo,
  primaryAction,
}: {
  title: string;
  pages: Array<{ url: string; image: boolean }>;
  startAt: number;
  onClose: () => void;
  demo?: boolean;
  primaryAction?: { label: string; onClick: () => void };
}) {
  const [index, setIndex] = useState(startAt);
  const [view, setView] = useState<ViewerPan>(VIEWER_IDENTITY);
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewerPan>(VIEWER_IDENTITY);
  const pointersRef = useRef(new Map<number, ViewerPoint>());
  const pinchRef = useRef<{ dist: number; view: ViewerPan; mid: ViewerPoint } | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const swipeStart = useRef<ViewerPoint | null>(null);
  const movedRef = useRef(false);
  const pinchedRef = useRef(false);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const page = pages[index];
  const zoomed = view.scale > 1.02;

  const applyView = (next: ViewerPan) => {
    const clamped = clampViewerPan(next, bodyRef.current);
    viewRef.current = clamped;
    setView(clamped);
  };

  const resetView = () => applyView(VIEWER_IDENTITY);

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, next));
    if (clamped === index) return;
    setIndex(clamped);
    viewRef.current = VIEWER_IDENTITY;
    setView(VIEWER_IDENTITY);
    pinchedRef.current = false;
  };

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") goTo(index + 1);
      if (event.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [index, onClose, pages.length]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !page?.image) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = viewRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        applyView(
          zoomViewerAround(
            current,
            current.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08),
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
          ),
        );
        return;
      }
      applyView({ ...current, y: current.y - event.deltaY, x: current.x - event.deltaX });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [page?.image]);

  const pointerList = () => [...pointersRef.current.values()];

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!page?.image) return;
    if ((event.target as HTMLElement | null)?.closest("button")) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is optional on some browsers */
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    movedRef.current = false;
    const points = pointerList();
    if (points.length === 2) {
      const rect = event.currentTarget.getBoundingClientRect();
      pinchRef.current = {
        dist: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        view: viewRef.current,
        mid: {
          x: (points[0].x + points[1].x) / 2 - rect.left,
          y: (points[0].y + points[1].y) / 2 - rect.top,
        },
      };
      dragRef.current = null;
      swipeStart.current = null;
      pinchedRef.current = true;
      return;
    }
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      vx: viewRef.current.x,
      vy: viewRef.current.y,
    };
    if (pages.length > 1 && viewRef.current.scale <= 1.02) {
      swipeStart.current = { x: event.clientX, y: event.clientY };
    } else {
      swipeStart.current = null;
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = pointerList();
    if (points.length >= 2 && pinchRef.current) {
      const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const ratio = dist / Math.max(40, pinchRef.current.dist);
      movedRef.current = true;
      applyView(zoomViewerAround(pinchRef.current.view, pinchRef.current.view.scale * ratio, pinchRef.current.mid));
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 8) movedRef.current = true;
    if (viewRef.current.scale > 1.02 || Math.abs(dy) > Math.abs(dx)) {
      applyView({ ...viewRef.current, x: drag.vx + dx, y: drag.vy + dy });
    }
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    pointersRef.current.delete(event.pointerId);
    if (dragRef.current?.id === event.pointerId) dragRef.current = null;
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size > 0) return;

    const shouldSwipe =
      Boolean(start) &&
      pages.length > 1 &&
      viewRef.current.scale <= 1.02 &&
      !pinchedRef.current &&
      movedRef.current;
    if (shouldSwipe && start) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy)) {
        swipeStart.current = null;
        goTo(index + (dx < 0 ? 1 : -1));
        return;
      }
    }
    swipeStart.current = null;
    pinchedRef.current = pointersRef.current.size >= 2;

    if (movedRef.current) return;
    const now = Date.now();
    const prev = lastTapRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    const tap = { t: now, x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (prev && now - prev.t < 280 && Math.hypot(tap.x - prev.x, tap.y - prev.y) < 36) {
      lastTapRef.current = null;
      if (viewRef.current.scale > 1.05) resetView();
      else applyView(zoomViewerAround(viewRef.current, 2.4, tap));
      return;
    }
    lastTapRef.current = tap;
  };

  if (!page) return null;

  return createPortal(
    <div className={`file-viewer${demo ? " demo" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      {demo && (
        <p className="demo-ribbon demo-ribbon-bar" aria-hidden="true">
          Demo
        </p>
      )}
      <div className="file-viewer-bar">
        <button className="secondary" type="button" onClick={onClose}>
          Close
        </button>
        <div className="file-viewer-heading">
          <strong>{title}</strong>
          <p className="meta">
            {pages.length > 1
              ? `Page ${index + 1} of ${pages.length} · pinch to enlarge · swipe for another page`
              : page.image
                ? "Pinch or double-tap to enlarge the text"
                : "Open the file, then pinch to enlarge"}
          </p>
        </div>
        {primaryAction && (
          <button className="primary" type="button" onClick={primaryAction.onClick}>
            {primaryAction.label}
          </button>
        )}
      </div>
      <div
        ref={bodyRef}
        className={`file-viewer-body${pages.length > 1 && !zoomed ? " swipeable" : ""}${page.image ? " zoomable" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        {page.image ? (
          <div
            className="file-viewer-page"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          >
            <img
              src={page.url}
              alt={`${title} page ${index + 1}`}
              draggable={false}
              onLoad={() => applyView(viewRef.current)}
            />
            {demo && (
              <span className="demo-ribbon demo-ribbon-corner" aria-hidden="true">
                Demo
              </span>
            )}
          </div>
        ) : (
          <iframe title={title} src={page.url} />
        )}
      </div>
      {pages.length > 1 && (
        <div className="file-viewer-nav">
          <button className="secondary" type="button" disabled={index === 0} onClick={() => goTo(index - 1)}>
            Previous page
          </button>
          <button
            className="secondary"
            type="button"
            disabled={index === pages.length - 1}
            onClick={() => goTo(index + 1)}
          >
            Next page
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

function PagePips({
  count,
  index,
  demo,
  onSelect,
}: {
  count: number;
  index: number;
  demo?: boolean;
  onSelect?: (index: number) => void;
}) {
  if (count < 2) return null;
  return (
    <div className={`page-pips${demo ? " demo" : ""}`} aria-hidden="true">
      {Array.from({ length: count }, (_, pip) =>
        onSelect ? (
          <button
            key={pip}
            type="button"
            className={`page-pip${pip === index ? " on" : ""}`}
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(pip);
            }}
          />
        ) : (
          <span key={pip} className={`page-pip${pip === index ? " on" : ""}`} />
        ),
      )}
    </div>
  );
}

function PageRail({
  pages,
  title,
  demo,
  onOpen,
}: {
  pages: Array<{ url: string; image: boolean }>;
  title: string;
  demo?: boolean;
  onOpen: (index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const swipeStart = useRef<{ x: number; y: number; page: number } | null>(null);
  const swipeAxis = useRef<"x" | "y" | null>(null);
  const swiped = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const goTo = (next: number) => {
    setIndex(Math.max(0, Math.min(pages.length - 1, next)));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    const axis = swipeAxis.current;
    swipeStart.current = null;
    swipeAxis.current = null;
    setDragging(false);
    setDragX(0);
    if (axis === "x") event.stopPropagation();
    if (!start || axis !== "x" || pages.length < 2) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const width = event.currentTarget.clientWidth || 1;
    if (Math.abs(dx) < Math.max(28, width * 0.12) || Math.abs(dx) <= Math.abs(dy)) return;
    swiped.current = true;
    goTo(start.page + (dx < 0 ? 1 : -1));
  };

  return (
    <div className={`page-rail-wrap${demo ? " demo" : ""}`}>
      <div
        className={`page-rail ${pages.length > 1 ? "swipeable" : ""}`}
        aria-label="Document pages"
        onPointerDown={(event) => {
          if (pages.length < 2) return;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* capture is optional if the browser already owns the touch */
          }
          swipeStart.current = { x: event.clientX, y: event.clientY, page: index };
          swipeAxis.current = null;
          swiped.current = false;
        }}
        onPointerMove={(event) => {
          const start = swipeStart.current;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (!swipeAxis.current) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            swipeAxis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (swipeAxis.current === "y") {
              try {
                event.currentTarget.releasePointerCapture(event.pointerId);
              } catch {
                /* capture may already be gone */
              }
              swipeStart.current = null;
              setDragging(false);
              setDragX(0);
              return;
            }
            setDragging(true);
          }
          if (swipeAxis.current !== "x") return;
          event.stopPropagation();
          const atStart = start.page === 0 && dx > 0;
          const atEnd = start.page === pages.length - 1 && dx < 0;
          setDragX(atStart || atEnd ? dx * 0.28 : dx);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={(event) => {
          if (pages.length > 1) event.stopPropagation();
        }}
        onTouchMove={(event) => {
          if (swipeAxis.current === "x") event.stopPropagation();
        }}
      >
        <div
          className={`page-rail-track${dragging ? " dragging" : ""}`}
          style={{ transform: `translateX(calc(-${index * 100}% + ${dragX}px))` }}
        >
          {pages.map((page, pageIndex) => (
            <figure key={`${title}-page-${pageIndex}`} className="page-slide">
              <div
                role="button"
                tabIndex={0}
                className="preview-open"
                onClick={() => {
                  if (swiped.current) return;
                  onOpen(pageIndex);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpen(pageIndex);
                }}
              >
                <img src={page.url} alt={`${title} page ${pageIndex + 1}`} draggable={false} />
                {demo && (
                  <span className="demo-ribbon demo-ribbon-corner" aria-hidden="true">
                    Demo
                  </span>
                )}
              </div>
            </figure>
          ))}
        </div>
        {pages.length > 1 && index > 0 && <span className="page-rail-edge prev" />}
        {pages.length > 1 && index < pages.length - 1 && <span className="page-rail-edge next" />}
        <PagePips count={pages.length} index={index} demo={demo} onSelect={goTo} />
      </div>
      {pages.length > 1 && (
        <p className="page-rail-caption">Page {index + 1} of {pages.length}</p>
      )}
    </div>
  );
}

function DocumentDetail({
  doc,
  previous,
  ownerLabel,
  compact,
  onEdit,
  onChecked,
  onCopyLocation,
  onKeepLocal,
  onDeleted,
}: {
  doc: DocumentRecord;
  previous: DocumentRecord[];
  ownerLabel?: string;
  compact?: boolean;
  onEdit: () => void;
  onChecked: () => void;
  onCopyLocation: () => void;
  onKeepLocal?: (file: File) => Promise<void>;
  onDeleted: () => void;
}) {
  const [pages, setPages] = useState<Array<{ url: string; image: boolean }>>([]);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [pagesLoading, setPagesLoading] = useState(doc.storageKind === "stored");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [openedFile, setOpenedFile] = useState<File | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [keeping, setKeeping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRevoke = useRef<(() => void) | null>(null);
  const status = computeStatus(doc);
  const link = locationUrl(doc.locationLabel);

  useEffect(() => {
    let urls: string[] = [];
    let alive = true;
    const expected = Math.max(1, doc.pageCount ?? 1);
    (async () => {
      if (doc.storageKind !== "stored") {
        setPagesLoading(false);
        return;
      }
      setPagesLoading(true);
      for (let attempt = 0; attempt < 8 && alive; attempt += 1) {
        const blobs = await loadDocumentPages(doc.id, expected);
        if (!alive) return;
        if (blobs.length >= expected) {
          const viewPages: Array<{ blob: Blob; image: boolean }> = [];
          for (const blob of blobs) {
            const treatAsPdf = isPdfBlob(blob, doc.mimeType, doc.fileName) || (await blobLooksLikePdf(blob));
            if (treatAsPdf) {
              try {
                const rendered = await renderPdfPages(blob);
                for (const page of rendered) viewPages.push({ blob: page, image: true });
              } catch {
                viewPages.push({ blob, image: false });
              }
              continue;
            }
            if (isVisualImage(blob.type || doc.mimeType, doc.fileName)) {
              viewPages.push({
                blob: doc.source === "camera" ? await bleachScanBlob(blob) : blob,
                image: true,
              });
              continue;
            }
            viewPages.push({ blob, image: false });
          }
          if (!alive) return;
          urls.forEach((url) => URL.revokeObjectURL(url));
          urls = viewPages.map((page) => URL.createObjectURL(page.blob));
          setPages(viewPages.map((page, index) => ({ url: urls[index], image: page.image })));
          setPagesLoading(false);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      if (alive) setPagesLoading(false);
    })();
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [doc.fileName, doc.id, doc.mimeType, doc.pageCount, doc.storageKind]);

  useEffect(() => {
    return () => previewRevoke.current?.();
  }, [doc.id]);

  const openReferencedFile = async (file: File) => {
    setOpenError(null);
    setPagesLoading(true);
    try {
      const preview = urlsFromPreviewPages(await previewPagesFromBlob(file, file.name));
      previewRevoke.current?.();
      previewRevoke.current = preview.revoke;
      setOpenedFile(file);
      setPages(preview.pages);
      setViewerAt(0);
    } catch {
      setOpenError("Could not open that file here.");
    } finally {
      setPagesLoading(false);
    }
  };

  return (
    <aside className={`card doc-detail${doc.id === DEMO_DOC_ID ? " demo-doc" : ""}`}>
      <div className="doc-detail-top">
        <p className="kicker">{documentRoleLabel(doc)}</p>
        <span className={`badge ${status === "current" && !doc.isCurrent ? "relevant" : status}`}>
          {statusBadgeText(status, doc)}
        </span>
      </div>
      <h2>{doc.title}</h2>
      <p className="meta">
        {ownerLabel ? `${ownerLabel} · ` : ""}
        {locationLine(doc)} · Checked {formatCheckedDate(doc.lastChecked)}
      </p>
      {doc.notes && <p className="meta">{doc.notes}</p>}
      {pagesLoading && pages.length === 0 && (
        <div className="preview preview-loading" role="status">
          Opening the document…
        </div>
      )}
      {pages.length > 0 && (
        <>
          <div className={`preview ${pages.length > 1 ? "preview-pages" : ""}`} style={{ marginBottom: 12 }}>
            {pages.length === 1 ? (
              <button type="button" className="preview-open" aria-label={`View full file: ${doc.title}`} onClick={() => setViewerAt(0)}>
                {pages[0].image ? (
                  <img src={pages[0].url} alt={doc.title} />
                ) : (
                  <span className="preview-file">Open the full PDF</span>
                )}
                {doc.id === DEMO_DOC_ID && (
                  <span className="demo-ribbon demo-ribbon-corner" aria-hidden="true">
                    Demo
                  </span>
                )}
              </button>
            ) : (
              <PageRail
                key={doc.id}
                pages={pages}
                title={doc.title}
                demo={doc.id === DEMO_DOC_ID}
                onOpen={setViewerAt}
              />
            )}
          </div>
          {!compact && (
            <button type="button" className="secondary preview-full-btn" onClick={() => setViewerAt(0)}>
              View full file
            </button>
          )}
        </>
      )}
      {viewerAt !== null && (
        <FileViewer
          title={doc.title}
          demo={doc.id === DEMO_DOC_ID}
          pages={pages}
          startAt={viewerAt}
          onClose={() => setViewerAt(null)}
          primaryAction={
            doc.storageKind === "referenced" && openedFile && onKeepLocal
              ? {
                  label: keeping ? "Keeping…" : "Keep a copy on this phone",
                  onClick: () => {
                    if (keeping || !openedFile) return;
                    void (async () => {
                      setKeeping(true);
                      try {
                        await onKeepLocal(openedFile);
                        setViewerAt(null);
                        setOpenedFile(null);
                      } catch {
                        setOpenError("Could not keep a copy on this phone.");
                        setKeeping(false);
                      }
                    })();
                  },
                }
              : undefined
          }
        />
      )}
      {doc.storageKind === "referenced" && (
        <div className="notice">
          {referencedOpenHint(doc)}
          {openError && (
            <div className="modal-status warn" role="status" style={{ marginTop: 10 }}>
              {openError}
            </div>
          )}
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp,.heic"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void openReferencedFile(file);
            }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="primary" onClick={() => fileInputRef.current?.click()}>
              View this file
            </button>
            {link && (
              <button type="button" className="secondary" onClick={() => window.open(link, "_blank", "noopener")}>
                Open link
              </button>
            )}
            <button type="button" className="secondary" onClick={onCopyLocation}>
              Copy location
            </button>
          </div>
        </div>
      )}
      {!compact && previous.filter(isSuperseded).length > 0 && (
        <>
          <h3 style={{ marginTop: 18 }}>Previous versions</h3>
          <div className="list">
            {previous.filter(isSuperseded).map((item) => (
              <div key={item.id} className="meta">
                {item.title} · {item.period ?? item.issuedOn ?? "earlier copy"}
              </div>
            ))}
          </div>
        </>
      )}
      {compact && previous.length > 0 && (
        <p className="meta">
          Swipe for {previous.length} other {previous.length === 1 ? "copy" : "copies"}.
        </p>
      )}
      <div className="doc-detail-actions">
        <button type="button" className="secondary" onClick={onChecked} disabled={isCheckedToday(doc.lastChecked)}>
          {isCheckedToday(doc.lastChecked) ? "Checked today" : "Mark as checked"}
        </button>
        <button type="button" className="secondary" onClick={onEdit}>
          Edit listing
        </button>
        <button type="button" className="danger" onClick={() => setConfirmRemove(true)}>
          Remove this listing
        </button>
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title="Remove this listing?"
          message={`Remove “${doc.title}” from your documents? A referenced file stays in its original folder. You can add the listing again later.`}
          confirmLabel="Remove this listing"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            onDeleted();
          }}
        />
      )}
    </aside>
  );
}

function TreeView({
  documents,
  allDocuments,
  people,
  query,
  onSelect,
  onMove,
  onCreateCategory,
  onCreateType,
}: {
  documents: DocumentRecord[];
  allDocuments: DocumentRecord[];
  people: HouseholdPerson[];
  query?: string;
  onSelect: (id: string) => void;
  onMove: (original: DocumentRecord, typeId: string, categoryId: string, makeCurrent: boolean) => Promise<DocumentRecord>;
  onCreateCategory: (label: string) => Promise<{ categoryId: string; typeId: string }>;
  onCreateType: (label: string, categoryId: string) => Promise<{ typeId: string; categoryId: string }>;
}) {
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [openTypes, setOpenTypes] = useState<string[]>([]);
  const [movingDoc, setMovingDoc] = useState<DocumentRecord | null>(null);
  const [creating, setCreating] = useState<null | { kind: "category" } | { kind: "type"; categoryId: string }>(null);
  const searching = Boolean(query?.trim());
  const grouped = useMemo(() => {
    return allCategories().map((category) => {
      const types = allTypes().filter((t) => t.categoryId === category.id);
      return {
        category,
        types: types
          .map((type) => ({
            type,
            docs: documents
              .filter((d) => d.typeId === type.id)
              .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)),
          }))
          .filter((t) => (searching ? t.docs.length > 0 : t.type.id !== "other" || t.docs.length)),
      };
    }).filter((g) => (searching ? g.types.some((t) => t.docs.length > 0) : g.types.some((t) => t.type.id !== "other" || t.docs.length)));
  }, [documents, searching, allDocuments.length, allCategories().length, allTypes().length]);

  useEffect(() => {
    if (!searching) return;
    setOpenCategories([...new Set(documents.map((doc) => doc.categoryId))]);
    setOpenTypes([...new Set(documents.map((doc) => doc.typeId))]);
  }, [searching, documents]);

  const toggleCategory = (id: string) => {
    setOpenCategories((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleType = (id: string) => {
    setOpenTypes((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div className="tree">
      <div className="tree-root">
        <span className="tree-dot static" aria-hidden="true" />
        <strong>My Documents</strong>
        {!searching && (
          <button type="button" className="tree-action" onClick={() => setCreating({ kind: "category" })}>
            New category
          </button>
        )}
      </div>
      {searching && grouped.length === 0 && (
        <div className="card empty">
          <h2>No matches</h2>
          <p>Try a title, category, or folder name — like passport, council tax, or iCloud.</p>
        </div>
      )}
      <ul className="tree-list">
        {grouped.map((group) => {
          const categoryOpen = openCategories.includes(group.category.id);
          const count = group.types.reduce((sum, entry) => sum + entry.docs.length, 0);
          return (
            <li key={group.category.id} className="tree-item">
              <div className="tree-line">
                <button
                  type="button"
                  className={`tree-dot${categoryOpen ? " open" : ""}`}
                  aria-expanded={categoryOpen}
                  aria-label={`${categoryOpen ? "Collapse" : "Expand"} ${group.category.label}`}
                  onClick={() => toggleCategory(group.category.id)}
                />
                <button type="button" className="tree-name" onClick={() => toggleCategory(group.category.id)}>
                  {group.category.label} ({count})
                </button>
                {!searching && (
                  <button
                    type="button"
                    className="tree-action"
                    onClick={() => setCreating({ kind: "type", categoryId: group.category.id })}
                  >
                    New folder
                  </button>
                )}
              </div>
              {categoryOpen && (
                <ul className="tree-list">
                  {group.types.map((entry) => {
                    const typeOpen = openTypes.includes(entry.type.id);
                    const hasDocs = entry.docs.length > 0;
                    return (
                      <li key={entry.type.id} className="tree-item">
                        <div className="tree-line">
                          {hasDocs ? (
                            <button
                              type="button"
                              className={`tree-dot${typeOpen ? " open" : ""}`}
                              aria-expanded={typeOpen}
                              aria-label={`${typeOpen ? "Collapse" : "Expand"} ${entry.type.folderName}`}
                              onClick={() => toggleType(entry.type.id)}
                            />
                          ) : (
                            <span className="tree-dot leaf" aria-hidden="true" />
                          )}
                          {hasDocs ? (
                            <button type="button" className="tree-name" onClick={() => toggleType(entry.type.id)}>
                              {entry.type.folderName} ({entry.docs.length})
                            </button>
                          ) : (
                            <span className="tree-name">
                              {entry.type.folderName} ({entry.docs.length})
                            </span>
                          )}
                        </div>
                        {typeOpen && (
                          <ul className="tree-list">
                            {entry.docs.map((doc) => (
                              <li key={doc.id} className="tree-item">
                                <div className="tree-line">
                                  <span className="tree-dot leaf" aria-hidden="true" />
                                  <button type="button" className="tree-name file" onClick={() => onSelect(doc.id)}>
                                    <span className="tree-label">
                                      {people.length > 0 ? `${personLabel(people, doc.personId)} · ` : ""}
                                      {doc.period ?? doc.title}{" "}
                                      {doc.isCurrent ? "✅ Current" : isSuperseded(doc) ? "" : "· Relevant"}
                                    </span>
                                    <span className="tree-loc">
                                      {doc.storageKind === "stored"
                                        ? "📍 Stored locally in ScannedOnArrival"
                                        : `📍 ${doc.locationLabel}`}
                                    </span>
                                  </button>
                                  <button type="button" className="tree-action" onClick={() => setMovingDoc(doc)}>
                                    Move
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {movingDoc && (
        <MoveDocumentSheet
          doc={movingDoc}
          documents={allDocuments}
          onClose={() => setMovingDoc(null)}
          onCreateCategory={onCreateCategory}
          onCreateType={onCreateType}
          onMove={async (typeId, categoryId, makeCurrent) => {
            const original = movingDoc;
            setMovingDoc(null);
            try {
              const moved = await onMove(original, typeId, categoryId, makeCurrent);
              setOpenCategories((current) => [...new Set([...current, moved.categoryId])]);
              setOpenTypes((current) => [...new Set([...current, moved.typeId])]);
            } catch (err) {
              setMovingDoc(original);
              throw err;
            }
          }}
        />
      )}
      {creating && (
        <NewFolderSheet
          kind={creating.kind}
          categoryLabel={creating.kind === "type" ? categoryLabel(creating.categoryId) : undefined}
          onClose={() => setCreating(null)}
          onCreate={async (label) => {
            const request = creating;
            setCreating(null);
            try {
              if (request.kind === "category") {
                const created = await onCreateCategory(label);
                setOpenCategories((current) => [...new Set([...current, created.categoryId])]);
                setOpenTypes((current) => [...new Set([...current, created.typeId])]);
                return;
              }
              const created = await onCreateType(label, request.categoryId);
              setOpenCategories((current) => [...new Set([...current, created.categoryId])]);
              setOpenTypes((current) => [...new Set([...current, created.typeId])]);
            } catch (err) {
              setCreating(request);
              throw err;
            }
          }}
        />
      )}
    </div>
  );
}

function MoveDocumentSheet({
  doc,
  documents,
  onClose,
  onMove,
  onCreateCategory,
  onCreateType,
}: {
  doc: DocumentRecord;
  documents: DocumentRecord[];
  onClose: () => void;
  onMove: (typeId: string, categoryId: string, makeCurrent: boolean) => Promise<void>;
  onCreateCategory: (label: string) => Promise<{ categoryId: string; typeId: string }>;
  onCreateType: (label: string, categoryId: string) => Promise<{ typeId: string; categoryId: string }>;
}) {
  const [categoryId, setCategoryId] = useState(doc.categoryId);
  const [typeId, setTypeId] = useState(doc.typeId);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [creatingType, setCreatingType] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newType, setNewType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const destHasCurrent = documents.some(
    (item) => item.id !== doc.id && item.typeId === typeId && item.isCurrent && sameOwner(item, doc),
  );
  const unchanged = typeId === doc.typeId && categoryId === doc.categoryId;
  const typesHere = allTypes().filter((type) => type.categoryId === categoryId);

  const submit = async (makeCurrent: boolean) => {
    if (unchanged || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onMove(typeId, categoryId, makeCurrent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move that listing.");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>Move listing</h2>
        <p className="meta">
          {doc.title} is in {categoryLabel(doc.categoryId)} → {typeById(doc.typeId).folderName}. Choose another folder.
          The file itself stays where it is.
        </p>
        {error && (
          <div className="modal-status warn" role="status">
            {error}
          </div>
        )}
        <label className="field">
          <span>Category</span>
          <select
            value={creatingCategory ? "__new__" : categoryId}
            onChange={(event) => {
              if (event.target.value === "__new__") {
                setCreatingCategory(true);
                setCreatingType(false);
                return;
              }
              setCreatingCategory(false);
              setCreatingType(false);
              const nextCategory = event.target.value;
              const types = allTypes().filter((type) => type.categoryId === nextCategory);
              const keep = types.some((type) => type.id === typeId);
              setCategoryId(nextCategory);
              setTypeId(keep ? typeId : (types[0]?.id ?? "other"));
            }}
          >
            {allCategories().map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
            <option value="__new__">Create a new category…</option>
          </select>
        </label>
        {creatingCategory && (
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>New category name</span>
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="School, Pets, Work…"
              />
            </label>
            <button
              className="primary"
              type="button"
              disabled={!newCategory.trim()}
              onClick={() => {
                void (async () => {
                  try {
                    const created = await onCreateCategory(newCategory);
                    setCreatingCategory(false);
                    setNewCategory("");
                    setCategoryId(created.categoryId);
                    setTypeId(created.typeId as DocumentTypeId);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not create that category.");
                  }
                })();
              }}
            >
              Create
            </button>
          </div>
        )}
        <label className="field">
          <span>Folder</span>
          <select
            value={creatingType ? "__new__" : typeId}
            onChange={(event) => {
              if (event.target.value === "__new__") {
                setCreatingType(true);
                return;
              }
              setCreatingType(false);
              const type = typeById(event.target.value);
              setTypeId(type.id);
              setCategoryId(type.categoryId);
            }}
          >
            {typesHere.map((type) => (
              <option key={type.id} value={type.id}>
                {type.folderName}
              </option>
            ))}
            <option value="__new__">Create a new folder…</option>
          </select>
        </label>
        {creatingType && (
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>New folder name</span>
              <input
                value={newType}
                onChange={(event) => setNewType(event.target.value)}
                placeholder="School letter, NHS letter…"
              />
            </label>
            <button
              className="primary"
              type="button"
              disabled={!newType.trim() || creatingCategory}
              onClick={() => {
                void (async () => {
                  try {
                    const created = await onCreateType(newType, categoryId);
                    setCreatingType(false);
                    setNewType("");
                    setTypeId(created.typeId as DocumentTypeId);
                    setCategoryId(created.categoryId);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not create that folder.");
                  }
                })();
              }}
            >
              Create
            </button>
          </div>
        )}
        {destHasCurrent && !unchanged && (
          <div className="notice">
            This folder already has a current version. Set this as current, or keep it as another relevant copy.
          </div>
        )}
        <div className="row">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          {destHasCurrent && !unchanged ? (
            <>
              <button className="secondary" type="button" disabled={busy} onClick={() => void submit(false)}>
                Keep as another relevant copy
              </button>
              <button className="primary" type="button" disabled={busy} onClick={() => void submit(true)}>
                Set as current version
              </button>
            </>
          ) : (
            <button className="primary" type="button" disabled={unchanged || busy} onClick={() => void submit(!destHasCurrent)}>
              Move here
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function NewFolderSheet({
  kind,
  categoryLabel: parentLabel,
  onClose,
  onCreate,
}: {
  kind: "category" | "type";
  categoryLabel?: string;
  onClose: () => void;
  onCreate: (label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that folder.");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{kind === "category" ? "New category" : "New folder"}</h2>
        <p className="meta">
          {kind === "category"
            ? "This adds a category and a folder inside it. You can move files into it from the tree."
            : `This folder will sit under ${parentLabel ?? "this category"}.`}
        </p>
        {error && (
          <div className="modal-status warn" role="status">
            {error}
          </div>
        )}
        <label className="field">
          <span>{kind === "category" ? "Category name" : "Folder name"}</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={kind === "category" ? "School, Pets, Work…" : "School letter, NHS letter…"}
            autoFocus
          />
        </label>
        <div className="row">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="button" disabled={!label.trim() || busy} onClick={() => void submit()}>
            Create
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InboxAddressCard({
  address,
  onCopied,
  onNewAddress,
}: {
  address: string;
  onCopied: (message: string) => void;
  onNewAddress?: () => void;
}) {
  return (
    <div className="inbox-address">
      <code>{address || "Issuing your address…"}</code>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={!address}
          onClick={() => {
            void (async () => {
              const ok = await copyText(address);
              onCopied(ok ? "Inbox address copied" : "Could not copy the address");
            })();
          }}
        >
          Copy address
        </button>
        {onNewAddress && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (
                window.confirm(
                  "Issue a new address? Mail sent to the old one will no longer reach this device.",
                )
              ) {
                onNewAddress();
              }
            }}
          >
            New address
          </button>
        )}
      </div>
    </div>
  );
}

function InboxView({
  settings,
  inbox,
  inboxReady,
  foundEmail,
  documents,
  onSettings,
  onConfirm,
  onRemove,
  confirmingId,
  busyKind,
  onAddFound,
  onViewFound,
  onSkipFound,
  onUnskipFound,
  onAddMail,
  onConnectGmail,
  onConnectOutlook,
  onDisconnectGmail,
  onDisconnectOutlook,
  gmailReady,
  outlookReady,
  gmailConnected,
  outlookConnected,
  onToast,
}: {
  settings: AppSettings;
  inbox: InboxItem[];
  inboxReady: boolean;
  foundEmail: FoundEmailDoc[];
  documents: DocumentRecord[];
  onSettings: (s: AppSettings) => Promise<void>;
  onConfirm: (item: InboxItem) => Promise<void>;
  onRemove: (item: InboxItem) => Promise<void>;
  confirmingId: string | null;
  busyKind: "confirm" | "remove" | "mailbox" | null;
  onAddFound: (item: FoundEmailDoc) => Promise<void>;
  onViewFound: (item: FoundEmailDoc) => void;
  onSkipFound: (item: FoundEmailDoc) => void;
  onUnskipFound: (item: FoundEmailDoc) => void;
  onAddMail: (file: File) => void;
  onConnectGmail: () => void;
  onConnectOutlook: () => void;
  onDisconnectGmail: () => void;
  onDisconnectOutlook: () => void;
  gmailReady: boolean;
  outlookReady: boolean;
  gmailConnected: boolean;
  outlookConnected: boolean;
  onToast: (msg: string) => void;
}) {
  const pending = inbox.filter((i) => i.status === "pending");
  const convenience = settings.privacyMode === "inbox";
  const [foundMailTab, setFoundMailTab] = useState<"add" | "added" | "skipped">("add");
  const foundToAdd = foundEmail.filter((item) => !item.added && !item.skipped);
  const foundAdded = foundEmail.filter((item) => item.added);
  const foundSkipped = foundEmail.filter((item) => item.skipped && !item.added);
  const foundShown =
    foundMailTab === "add" ? foundToAdd : foundMailTab === "added" ? foundAdded : foundSkipped;

  useEffect(() => {
    if (foundToAdd.length > 0) setFoundMailTab("add");
  }, [foundToAdd.length]);

  return (
    <div className="grid">
      <div className="card">
        <h2>Two ways to handle email</h2>
        <p className="meta">
          Private local stays the default. Convenience inbox is opt-in: you get a private address on
          inbox.scannedonarrival.com, unique to this device.
        </p>
        <div className="switch" style={{ marginTop: 14, width: "fit-content" }}>
          <button
            className={!convenience ? "active" : ""}
            onClick={() => onSettings({ ...settings, privacyMode: "local" })}
          >
            Private local
          </button>
          <button
            className={convenience ? "active" : ""}
            onClick={() => onSettings({ ...settings, privacyMode: "inbox" })}
          >
            Convenience inbox
          </button>
        </div>
      </div>

      {convenience ? (
        <div className="card">
          {inboxReady ? (
            <div className="notice">
              This address only receives PDFs you forward. ScannedOnArrival does not open your email for you. After
              you confirm, this device keeps the copy and we ask the receive server to drop its copy.
            </div>
          ) : (
            <div className="notice warn">
              This address is issued. Mail delivery is still finishing with the receive provider. Until then, add the
              PDF from Files on this phone.
            </div>
          )}
          <h3>Forward a bill from your email</h3>
          <p className="meta">
            You have to leave this screen, open the email app where the bill arrived, and forward that email to the
            address below.
          </p>
          <ol className="inbox-howto">
            <li>
              <div>
                <strong>Copy this address</strong>
                <span>It belongs only to this device.</span>
              </div>
            </li>
            <li>
              <div>
                <strong>Open your email app</strong>
                <span>Gmail, Outlook, Mail, or whichever app received the bill.</span>
              </div>
            </li>
            <li>
              <div>
                <strong>Forward the email with the PDF</strong>
                <span>Paste the address as the recipient, then send.</span>
              </div>
            </li>
            <li>
              <div>
                <strong>Come back here</strong>
                <span>The PDF appears below so you can Confirm or Remove it.</span>
              </div>
            </li>
          </ol>
          <InboxAddressCard address={settings.inboxAddress} onCopied={onToast} />
          <p className="meta" style={{ marginTop: 16 }}>
            Already have the PDF saved on this phone? Add it from Files — you do not need to forward.
          </p>
          <label className="secondary inbox-mail-add">
            Add a PDF from Files
            <input
              type="file"
              accept="application/pdf,image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAddMail(file);
                event.target.value = "";
              }}
            />
          </label>
          <div className="list" style={{ marginTop: 14 }}>
            {pending.length === 0 && (
              <p className="meta">
                {inboxReady
                  ? "Nothing is waiting yet. Open your email, forward the PDF to the address above, then return here."
                  : "Nothing is waiting yet. Forwarded mail will land here once delivery is ready."}
              </p>
            )}
            {pending.map((item) => {
              const existing = documents.find((d) => d.typeId === item.typeId && d.isCurrent);
              return (
                <div key={item.id} className="card inbox-item">
                  <div>
                    <strong>New {typeById(item.typeId).label} document received</strong>
                    <p className="meta">
                      {item.period ?? item.attachmentName}
                      <br />
                      {existing
                        ? `You already have a current ${typeById(item.typeId).label} on this device`
                        : "No previous copy indexed"}
                    </p>
                  </div>
                  <div className="row inbox-item-actions">
                    <button
                      type="button"
                      className="danger"
                      disabled={confirmingId !== null}
                      onClick={() => void onRemove(item)}
                    >
                      {confirmingId === item.id && busyKind === "remove" ? "Removing…" : "Remove"}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={confirmingId !== null}
                      onClick={() => void onConfirm(item)}
                    >
                      {confirmingId === item.id && busyKind === "confirm" ? "Opening…" : "Confirm"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card">
          <h3>Inbox forwarding is off</h3>
          <p className="meta">
            Stay in local mode and add email PDFs with the file picker. Your private address is already issued —
            turn on convenience inbox only if you want forwarding.
          </p>
          <InboxAddressCard address={settings.inboxAddress} onCopied={onToast} />
        </div>
      )}

      <div className="card">
        <h3>{outlookReady ? "Optional Gmail or Outlook" : "Optional Gmail"}</h3>
        <p className="meta">
          Never required. This stays on this device: you sign in with Google
          {outlookReady ? " or Microsoft" : ""} in this browser, we look for recent PDF attachments here, then you
          choose what to add. ScannedOnArrival does not receive your mailbox. Forwarding still works without this.
        </p>
        {!gmailReady && !outlookReady && (
          <p className="meta" style={{ marginTop: 10 }}>
            Mailbox connect is not configured on this site yet. Use forward-to-inbox until it is.
          </p>
        )}
        {gmailReady && (
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="secondary"
              type="button"
              disabled={confirmingId !== null}
              onClick={onConnectGmail}
            >
              {confirmingId === "gmail" && busyKind === "mailbox"
                ? "Looking…"
                : gmailConnected
                  ? "Look in Gmail again"
                  : "Connect Gmail"}
            </button>
            {gmailConnected && (
              <button className="danger" type="button" disabled={confirmingId !== null} onClick={onDisconnectGmail}>
                Disconnect Gmail
              </button>
            )}
          </div>
        )}
        {outlookReady && (
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="secondary"
              type="button"
              disabled={confirmingId !== null}
              onClick={onConnectOutlook}
            >
              {confirmingId === "outlook" && busyKind === "mailbox"
                ? "Looking…"
                : outlookConnected
                  ? "Look in Outlook again"
                  : "Connect Outlook"}
            </button>
            {outlookConnected && (
              <button className="danger" type="button" disabled={confirmingId !== null} onClick={onDisconnectOutlook}>
                Disconnect Outlook
              </button>
            )}
          </div>
        )}
        {foundEmail.length > 0 && (
          <div className="found-email-list">
            <h3>From this look</h3>
            <p className="meta">
              View a file before you file it. Add puts it in your index. Skip keeps it here, off the next look.
            </p>
            <div className="switch found-email-tabs" role="tablist" aria-label="Found email documents">
              <button
                type="button"
                role="tab"
                className={foundMailTab === "add" ? "active" : ""}
                aria-selected={foundMailTab === "add"}
                onClick={() => setFoundMailTab("add")}
              >
                Add {foundToAdd.length}
              </button>
              <button
                type="button"
                role="tab"
                className={foundMailTab === "added" ? "active" : ""}
                aria-selected={foundMailTab === "added"}
                onClick={() => setFoundMailTab("added")}
              >
                Added {foundAdded.length}
              </button>
              <button
                type="button"
                role="tab"
                className={foundMailTab === "skipped" ? "active" : ""}
                aria-selected={foundMailTab === "skipped"}
                onClick={() => setFoundMailTab("skipped")}
              >
                Skipped {foundSkipped.length}
              </button>
            </div>
            <div className="list" style={{ marginTop: 12 }}>
              {foundShown.length === 0 && (
                <p className="meta">
                  {foundMailTab === "add"
                    ? "Nothing new to add. Already-filed files are in Added. Skipped files are in Skipped."
                    : foundMailTab === "added"
                      ? "Nothing from this look is in your index yet."
                      : "Nothing skipped from this look."}
                </p>
              )}
              {foundShown.map((item) => (
                <div key={item.id} className="found-email-item">
                  <button
                    type="button"
                    className="found-email-copy"
                    disabled={confirmingId !== null}
                    onClick={() => onViewFound(item)}
                  >
                    <strong>{item.title}</strong>
                    <p className="meta">
                      {confirmingId === item.id && busyKind === "mailbox"
                        ? "Opening…"
                        : "Tap to view"}
                      {item.attachmentName ? ` · ${item.attachmentName}` : ""}
                      {item.period ? ` · ${item.period}` : ""}
                    </p>
                  </button>
                  {foundMailTab === "added" ? (
                    <span className="found-email-done">In your index</span>
                  ) : (
                    <div className="found-email-actions">
                      <button
                        className="secondary"
                        type="button"
                        disabled={confirmingId !== null}
                        onClick={() => onViewFound(item)}
                      >
                        {confirmingId === item.id && busyKind === "mailbox" ? "Opening…" : "View"}
                      </button>
                      <button
                        className="primary"
                        disabled={confirmingId !== null}
                        onClick={() => void onAddFound(item)}
                      >
                        Add
                      </button>
                      {foundMailTab === "add" ? (
                        <button
                          className="secondary"
                          type="button"
                          disabled={confirmingId !== null}
                          onClick={() => {
                            onSkipFound(item);
                            if (foundToAdd.length <= 1) setFoundMailTab("skipped");
                          }}
                        >
                          Skip
                        </button>
                      ) : (
                        <button
                          className="secondary"
                          type="button"
                          disabled={confirmingId !== null}
                          onClick={() => {
                            onUnskipFound(item);
                            setFoundMailTab("add");
                          }}
                        >
                          Unskip
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RestoreHandoff() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(() => isDesktopLayout());

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 861px)");
    const sync = () => setVisible(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const url = `${window.location.origin}/settings?restore=1`;
    void import("qrcode").then((mod) => {
      const QRCode = mod.default;
      return QRCode.toDataURL(url, {
        width: 140,
        margin: 1,
        color: { dark: "#1B3A2F", light: "#F3EEE4" },
      }).then(setDataUrl);
    });
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="sync-qr">
      {dataUrl ? <img src={dataUrl} alt="QR code that opens Receive on your phone" width={88} height={88} /> : null}
      <p className="meta">On the other phone, open this, then Receive the file you sent.</p>
    </div>
  );
}

function MenuGlyph({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg className="account-menu-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6.2 5.1 12 10.9l5.8-5.8 1.1 1.1L13.1 12l5.8 5.8-1.1 1.1L12 13.1l-5.8 5.8-1.1-1.1L10.9 12 5.1 6.2l1.1-1.1Z"
        />
      </svg>
    );
  }
  return (
    <svg className="account-menu-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 6h16v2.1H4V6Zm0 5h16v2.1H4V11Zm0 5h16v2.1H4V16Z" />
    </svg>
  );
}

function AppNameplate({ onToast }: { onToast: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState("");

  useEffect(() => {
    if (!authAvailable()) return;
    const supabase = getSupabase();
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(userEmail(data.session?.user ?? null));
    });
    return onAuthChange((user) => setSignedIn(userEmail(user)));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hello = helloNameFromEmail(signedIn);

  return (
    <>
      {open && (
        <button
          type="button"
          className="account-menu-back"
          aria-label="Close sign in"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="app-nameplate">
        <PhoneGlyph />
        <span className="app-nameplate-brand">ScannedOnArrival</span>
        <button
          type="button"
          className={`account-menu-btn${hello ? " with-hello" : ""}`}
          aria-expanded={open}
          aria-controls="account-menu"
          aria-label={hello ? `Hi ${hello}` : "Sign in"}
          onClick={() => setOpen((current) => !current)}
        >
          <MenuGlyph open={open} />
          {hello ? <span className="account-hello">Hi {hello}</span> : null}
        </button>
        <div className="account-menu" id="account-menu" hidden={!open}>
          <AccountCard onToast={onToast} />
        </div>
      </div>
    </>
  );
}

function AccountCard({ onToast }: { onToast: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [signedIn, setSignedIn] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<"link" | "code" | "out" | null>(null);

  useEffect(() => {
    if (!authAvailable()) return;
    const supabase = getSupabase();
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(userEmail(data.session?.user ?? null));
    });
    return onAuthChange((user) => setSignedIn(userEmail(user)));
  }, []);

  if (!authAvailable()) {
    return (
      <div className="card">
        <h2>Sign in</h2>
        <p className="meta">
          Magic-link sign-in is not wired on this build yet. The index still lives in this browser. Send and
          Receive still work without an account.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Sign in</h2>
      {signedIn ? (
        <>
          <p className="meta">
            Signed in as {signedIn}. This is so a phone and a laptop can share one index later. Papers still live
            on this device until sync is on.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => {
                void (async () => {
                  setBusy("out");
                  try {
                    await signOutUser();
                    setSent(false);
                    setCode("");
                    onToast("Signed out on this device");
                  } catch (err) {
                    onToast(err instanceof Error ? err.message : "Could not sign out.");
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
            >
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="meta">
            We email a sign-in link. No password. On a Home Screen app, type the code from that same email if the
            link opens in the wrong browser.
          </p>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={busy !== null || !email.includes("@")}
              onClick={() => {
                void (async () => {
                  setBusy("link");
                  try {
                    await sendMagicLink(email);
                    setSent(true);
                    onToast("Check your email for the sign-in link.");
                  } catch (err) {
                    onToast(err instanceof Error ? err.message : "Could not send the sign-in email.");
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
            >
              {busy === "link" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </div>
          {sent && (
            <>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Or type the code from the email</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy !== null || code.trim().length < 6}
                  onClick={() => {
                    void (async () => {
                      setBusy("code");
                      try {
                        await verifyEmailCode(email, code);
                        onToast("Signed in");
                      } catch (err) {
                        onToast(err instanceof Error ? err.message : "That code did not work.");
                      } finally {
                        setBusy(null);
                      }
                    })();
                  }}
                >
                  {busy === "code" ? "Checking…" : "Sign in with the code"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SettingsView({
  settings,
  installPrompt,
  onInstalled,
  onSettings,
  onCreatePerson,
  onRemovePerson,
  onExport,
  onSend,
  onRestore,
  onReset,
  onToast,
  receiveHint,
}: {
  settings: AppSettings;
  installPrompt: BeforeInstallPromptEvent | null;
  onInstalled: () => void;
  onSettings: (s: AppSettings) => Promise<void>;
  onCreatePerson: (name: string) => Promise<HouseholdPerson>;
  onRemovePerson: (id: string) => Promise<void>;
  onExport: () => Promise<void>;
  onSend: () => Promise<void>;
  onRestore: (file: File) => Promise<void>;
  onReset: () => Promise<void>;
  onToast: (msg: string) => void;
  receiveHint: boolean;
}) {
  const standalone = isStandalone();
  const ios = isIos();

  return (
    <div className="grid">
      <div className="card">
        <h2>A web app in your browser</h2>
        <p className="meta">
          ScannedOnArrival runs in Safari, Chrome or Edge. It is not an App Store app. When we say scan, we
          mean your phone’s camera in this page — not a hardware scanner. On a computer you can still upload
          PDFs; to photograph paper, open this same site on your phone, or scan the QR on Scan and Docs.
        </p>
      </div>
      <div className="card">
        <h2>Add to Home Screen</h2>
        <p className="meta">
          {standalone
            ? "This site is already running from your Home Screen."
            : ios
              ? "In Safari, tap Share, then Add to Home Screen. You get a camera-ready icon without the App Store."
              : "Install this site like an app. After that, Android Chrome can share PDFs from Mail or Files into it."}
        </p>
        {installPrompt && !standalone && (
          <button
            className="primary"
            style={{ marginTop: 12 }}
            onClick={() => {
              void (async () => {
                await installPrompt.prompt();
                const choice = await installPrompt.userChoice;
                if (choice.outcome === "accepted") onInstalled();
              })();
            }}
          >
            Add to Home Screen
          </button>
        )}
      </div>
      <div className="card">
        <h2>Share from Mail or Files</h2>
        <p className="meta">
          On Android, install this site first, then use Share and pick ScannedOnArrival. On iPhone, Share Target
          is not available — open this page and use Add from Files or the camera roll instead. Classification
          stays on this device; image scans use on-device OCR.
        </p>
      </div>
      <HouseholdPeopleCard
        people={settings.people ?? []}
        onCreatePerson={onCreatePerson}
        onRemovePerson={onRemovePerson}
        onToast={onToast}
      />
      <div className="card">
        <h2>Stored here vs referenced here</h2>
        <p className="meta">
          Stored here means the app has a local copy. Referenced here means the file remains in another location;
          the app only keeps its description and where to find it. This browser cannot open iCloud or Files for you —
          copy the path, open a link if there is one, or pick the file to view it here.
        </p>
      </div>
      <div className="card">
        <h3>Inbox address</h3>
        <p className="meta">
          Issued for this device. It is not a mailbox you type yourself. Convenience inbox stays off until you
          turn it on.
        </p>
        <InboxAddressCard
          address={settings.inboxAddress}
          onCopied={onToast}
          onNewAddress={() => void onSettings({ ...settings, inboxAddress: mintInboxAddress() })}
        />
      </div>
      <div className="card">
        <h2>Reminders</h2>
        <p className="meta">
          When something is outdated or about to expire, Scan and Docs lists it. If you allow notifications, this browser
          can also remind you once a day — best after Add to Home Screen, especially on iPhone.
        </p>
        <button
          className={settings.notificationsEnabled ? "secondary" : "primary"}
          style={{ marginTop: 12 }}
          onClick={() => {
            void (async () => {
              if (settings.notificationsEnabled) {
                await onSettings({ ...settings, notificationsEnabled: false });
                return;
              }
              const allowed = await enableNotifications();
              await onSettings({ ...settings, notificationsEnabled: allowed });
            })();
          }}
        >
          {settings.notificationsEnabled ? "Turn reminders off" : "Allow reminders on this device"}
        </button>
      </div>
      <div className="card">
        <h2>Identify with OpenAI</h2>
        <p className="meta">
          Optional. If you add an API key, a scan is sent to OpenAI so the title matches the paper — for example
          “Aviva Car Insurance 2026” — and it can save itself. The key stays on this phone. Leave blank to keep
          identification on-device only.
        </p>
        <label className="field" style={{ marginTop: 12 }}>
          <span>OpenAI API key</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-..."
            value={settings.openaiApiKey}
            onChange={(e) => onSettings({ ...settings, openaiApiKey: e.target.value.trim() })}
          />
        </label>
      </div>
      <div className="card">
        <h2>This phone and another</h2>
        <p className="meta">
          The index lives in this browser. Phones do not stay in sync on their own yet. Send this index to the other
          phone — AirDrop, Messages, or Files — then Receive it there. That replaces the index on that phone.
        </p>
        {receiveHint && <p className="sync-receive-note">Pick the backup you sent from the other phone.</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className={receiveHint ? "secondary" : "primary"} type="button" onClick={() => void onSend()}>
            Send this index
          </button>
          <label className={receiveHint ? "primary" : "secondary"} style={{ display: "inline-flex" }}>
            Receive on this phone
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onRestore(file);
              }}
            />
          </label>
        </div>
        {canShareBackup() && (
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="secondary" onClick={() => void onExport()}>
              Download a copy
            </button>
          </div>
        )}
        <RestoreHandoff />
      </div>
      <div className="card">
        <h3>This device</h3>
        <p className="meta">Clear local documents, files and settings from IndexedDB on this browser.</p>
        <button className="danger" onClick={onReset}>
          Clear local data
        </button>
      </div>
    </div>
  );
}

function HouseholdPeopleCard({
  people,
  onCreatePerson,
  onRemovePerson,
  onToast,
}: {
  people: HouseholdPerson[];
  onCreatePerson: (name: string) => Promise<HouseholdPerson>;
  onRemovePerson: (id: string) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="card">
      <h2>Household</h2>
      <p className="meta">
        Shared papers stay on Household — council tax, the house, the car. A passport or licence can belong to one
        person. Filter Scan & Docs and Tree once someone is added.
      </p>
      {people.length > 0 && (
        <ul className="household-people">
          {people.map((person) => (
            <li key={person.id}>
              <span>{person.name}</span>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void (async () => {
                    await onRemovePerson(person.id);
                    onToast(`${person.name} removed. Their listings went back to Household.`);
                  })();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Add a person</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex, Sam…" />
        </label>
        <button
          className="primary"
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            void (async () => {
              const created = await onCreatePerson(name);
              setName("");
              onToast(`${created.name} added`);
            })();
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function EditDocumentModal({
  doc,
  onClose,
  onSave,
  onCreateCategory,
  onCreateType,
  people,
  onCreatePerson,
}: {
  doc: DocumentRecord;
  onClose: () => void;
  onSave: (original: DocumentRecord, next: DocumentRecord, makeCurrent: boolean) => Promise<unknown>;
  onCreateCategory: (label: string) => Promise<{ categoryId: string; typeId: string }>;
  onCreateType: (label: string, categoryId: string) => Promise<{ typeId: string; categoryId: string }>;
  people: HouseholdPerson[];
  onCreatePerson: (name: string) => Promise<HouseholdPerson>;
}) {
  const [draft, setDraft] = useState({
    title: doc.title,
    typeId: doc.typeId,
    categoryId: doc.categoryId,
    personId: doc.personId ?? "",
    period: doc.period ?? "",
    issuedOn: doc.issuedOn ?? "",
    expiresOn: doc.expiresOn ?? "",
    storageKind: doc.storageKind,
    locationLabel: doc.locationLabel,
    locationProvider: doc.locationProvider,
    notes: doc.notes ?? "",
    isCurrent: doc.isCurrent,
  });
  const [expiryMode, setExpiryMode] = useState<"na" | "date">(doc.expiresOn ? "date" : "na");
  const [newCategory, setNewCategory] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newType, setNewType] = useState("");
  const [creatingType, setCreatingType] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!draft.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(
        doc,
        {
          ...doc,
          title: draft.title.trim(),
          typeId: draft.typeId,
          categoryId: draft.categoryId,
          personId: draft.personId || undefined,
          period: draft.period,
          issuedOn: draft.issuedOn,
          expiresOn: expiryMode === "na" ? "" : draft.expiresOn,
          storageKind: doc.storageKind === "stored" ? draft.storageKind : "referenced",
          locationLabel: draft.locationLabel,
          locationProvider: providerFromLabel(draft.locationLabel),
          notes: draft.notes,
        },
        draft.isCurrent,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that listing.");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>Edit listing</h2>
        <p className="meta">Change how this file is filed. The scan or PDF stays as it is.</p>
        {error && (
          <div className="modal-status warn" role="status">
            {error}
          </div>
        )}
        <label className="field">
          <span>Title</span>
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <WhoseField
          people={people}
          personId={draft.personId}
          onChange={(personId) => setDraft({ ...draft, personId })}
          onCreatePerson={onCreatePerson}
        />
        <label className="field">
          <span>Category</span>
          <select
            value={creatingCategory ? "__new__" : draft.categoryId}
            onChange={(event) => {
              if (event.target.value === "__new__") {
                setCreatingCategory(true);
                setCreatingType(false);
                return;
              }
              setCreatingCategory(false);
              setCreatingType(false);
              const categoryId = event.target.value;
              const types = allTypes().filter((type) => type.categoryId === categoryId);
              const keep = types.some((type) => type.id === draft.typeId);
              const nextType = keep ? typeById(draft.typeId) : types[0] ?? typeById("other");
              setDraft({
                ...draft,
                categoryId,
                typeId: nextType.id,
              });
            }}
          >
            {allCategories().map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
            <option value="__new__">Create a new category…</option>
          </select>
        </label>
        {creatingCategory && (
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>New category name</span>
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="School, Pets, Work…"
              />
            </label>
            <button
              className="primary"
              type="button"
              disabled={!newCategory.trim()}
              onClick={() => {
                void (async () => {
                  try {
                    const created = await onCreateCategory(newCategory);
                    setCreatingCategory(false);
                    setNewCategory("");
                    setDraft({
                      ...draft,
                      categoryId: created.categoryId,
                      typeId: created.typeId as DocumentTypeId,
                    });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not create that category.");
                  }
                })();
              }}
            >
              Create
            </button>
          </div>
        )}
        <label className="field">
          <span>Document type</span>
          <select
            value={creatingType ? "__new__" : draft.typeId}
            onChange={(event) => {
              if (event.target.value === "__new__") {
                setCreatingType(true);
                return;
              }
              setCreatingType(false);
              const type = typeById(event.target.value);
              setDraft({
                ...draft,
                typeId: type.id,
                categoryId: type.categoryId,
              });
            }}
          >
            {allTypes()
              .filter((type) => type.categoryId === draft.categoryId)
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            <option value="__new__">Create a new document type…</option>
          </select>
        </label>
        {creatingType && (
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>New document type</span>
              <input
                value={newType}
                onChange={(event) => setNewType(event.target.value)}
                placeholder="School letter, NHS letter…"
              />
            </label>
            <button
              className="primary"
              type="button"
              disabled={!newType.trim() || creatingCategory}
              onClick={() => {
                void (async () => {
                  try {
                    const created = await onCreateType(newType, draft.categoryId);
                    setCreatingType(false);
                    setNewType("");
                    setDraft({
                      ...draft,
                      typeId: created.typeId as DocumentTypeId,
                      categoryId: created.categoryId,
                    });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not create that document type.");
                  }
                })();
              }}
            >
              Create
            </button>
          </div>
        )}
        <label className="field">
          <span>Period</span>
          <input
            placeholder="2026–27"
            value={draft.period}
            onChange={(event) => setDraft({ ...draft, period: event.target.value })}
          />
        </label>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span>Issued</span>
            <input
              type="date"
              value={draft.issuedOn}
              onChange={(event) => setDraft({ ...draft, issuedOn: event.target.value })}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Expires</span>
            <div className="switch expiry-switch">
              <button
                type="button"
                className={expiryMode === "na" ? "active" : ""}
                onClick={() => {
                  setExpiryMode("na");
                  setDraft({ ...draft, expiresOn: "" });
                }}
              >
                N/A
              </button>
              <button type="button" className={expiryMode === "date" ? "active" : ""} onClick={() => setExpiryMode("date")}>
                Date
              </button>
            </div>
            {expiryMode === "date" && (
              <input
                type="date"
                value={draft.expiresOn}
                onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })}
              />
            )}
          </label>
        </div>
        {doc.storageKind === "stored" && (
          <label className="field">
            <span>Storage</span>
            <select
              value={draft.storageKind}
              onChange={(event) => {
                const storageKind = event.target.value as DocumentRecord["storageKind"];
                setDraft({
                  ...draft,
                  storageKind,
                  locationLabel:
                    storageKind === "stored"
                      ? "Stored locally in ScannedOnArrival"
                      : draft.locationLabel || "iCloud Drive → Documents",
                });
              }}
            >
              <option value="stored">Stored here — keep a local copy</option>
              <option value="referenced">Referenced here — leave the file where it is</option>
            </select>
          </label>
        )}
        <label className="field">
          <span>Location</span>
          <input
            value={draft.locationLabel}
            onChange={(event) => setDraft({ ...draft, locationLabel: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea
            rows={3}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            placeholder="Anything to remember about this copy"
          />
        </label>
        <label className="scan-select">
          <input
            type="checkbox"
            checked={draft.isCurrent}
            onChange={(event) => setDraft({ ...draft, isCurrent: event.target.checked })}
          />
          This is the current version
        </label>
        <div className="row">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="button" onClick={() => void submit()} disabled={!draft.title.trim() || busy}>
            Save changes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AddDocumentModal({
  documents,
  startAt,
  intendedTypeId,
  incomingFile,
  incomingMethod,
  openaiApiKey,
  people,
  defaultPersonId,
  onClose,
  onSave,
  onCreateCategory,
  onCreateType,
  onCreatePerson,
}: {
  documents: DocumentRecord[];
  startAt: "choose" | "camera";
  intendedTypeId: string | null;
  incomingFile: File | null;
  incomingMethod: SourceKind | null;
  openaiApiKey: string;
  people: HouseholdPerson[];
  defaultPersonId: string;
  onClose: () => void;
  onSave: (draft: AddDraft, makeCurrent: boolean) => Promise<void>;
  onCreateCategory: (label: string) => Promise<{ categoryId: string; typeId: string }>;
  onCreateType: (label: string, categoryId: string) => Promise<{ typeId: string; categoryId: string }>;
  onCreatePerson: (name: string) => Promise<HouseholdPerson>;
}) {
  const [step, setStep] = useState<"choose" | "camera" | "pages" | "crop" | "form" | "replace">(
    incomingFile ? "choose" : startAt,
  );
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Reading the document locally…");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AddDraft | null>(null);
  const [existing, setExisting] = useState<DocumentRecord | null>(null);
  const [pages, setPages] = useState<Array<{ id: string; file: File; url: string; selected: boolean }>>([]);
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [crop, setCrop] = useState<CropInsets>(DEFAULT_CROP);
  const [newCategory, setNewCategory] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newType, setNewType] = useState("");
  const [creatingType, setCreatingType] = useState(false);
  const [viewingPage, setViewingPage] = useState(false);
  const [expiryMode, setExpiryMode] = useState<"na" | "date">("na");
  const ingested = useRef(false);

  const intendedType = intendedTypeId ? typeById(intendedTypeId) : null;

  const beginMethod = (method: SourceKind) => {
    const storageKind = method === "reference" ? "referenced" : "stored";
    const type = intendedType ?? typeById("other");
    setDraft({
      method,
      title: intendedType && intendedType.id !== "other" ? intendedType.label : "",
      typeId: type.id,
      categoryId: type.categoryId,
      personId: defaultPersonId || undefined,
      period: "",
      issuedOn: "",
      expiresOn: "",
      storageKind,
      locationLabel: defaultLocation(method, storageKind),
      locationProvider: storageKind === "stored" ? "local" : "icloud",
    });
    setExpiryMode("na");
    if (method === "camera") setStep("camera");
    else if (method === "reference") setStep("form");
  };

  const applyClassification = (next: AddDraft) => {
    const classified = next.classified;
    if (intendedType) {
      return {
        ...next,
        title: classified?.title || intendedType.label,
        typeId: intendedType.id,
        categoryId: intendedType.categoryId,
        period: classified?.period ?? next.period,
        issuedOn: classified?.issuedOn ?? next.issuedOn,
        expiresOn: classified?.expiresOn ?? next.expiresOn,
      };
    }
    if (!classified) return next;
    const type = typeById(classified.typeId);
    return {
      ...next,
      title: classified.title,
      typeId: classified.typeId,
      categoryId: type.categoryId,
      period: classified.period ?? "",
      issuedOn: classified.issuedOn ?? "",
      expiresOn: classified.expiresOn ?? "",
    };
  };

  const handleFile = async (
    file: File,
    method: SourceKind,
    storageKind: AddDraft["storageKind"],
    preparedText?: string,
    pageFiles?: File[],
  ) => {
    setBusy(true);
    setBusyLabel(isImage(file) ? "Reading the page with on-device OCR…" : "Reading the document locally…");
    setError(null);
    try {
      let text = preparedText ?? "";
      const pdfFile = isPdf(file) || (await blobLooksLikePdf(file));
      if (!preparedText && pdfFile) {
        try {
          text = await extractPdfText(file);
        } catch {
          text = "";
        }
      } else if (!preparedText && isImage(file)) {
        try {
          text = await extractImageText(file);
        } catch {
          text = "";
        }
      }
      setBusyLabel(openaiApiKey ? "Identifying the document…" : "Reading the page with on-device OCR…");
      const classified = await classifySmart({
        file,
        fileName: file.name,
        text,
        apiKey: openaiApiKey || undefined,
      });
      let pagesToStore = pageFiles?.length ? pageFiles : [file];
      if (!pageFiles?.length && pdfFile) {
        setBusyLabel("Making page pictures…");
        try {
          pagesToStore = await rasterizePdfForStorage(file);
        } catch {
          pagesToStore = [file];
        }
      }
      const next = applyClassification({
        method,
        file: pagesToStore[0],
        files: pagesToStore,
        previewUrl: isImage(pagesToStore[0]) ? URL.createObjectURL(pagesToStore[0]) : undefined,
        classified,
        title: classified.title,
        typeId: classified.typeId,
        categoryId: typeById(classified.typeId).categoryId,
        personId: defaultPersonId || undefined,
        period: classified.period ?? "",
        issuedOn: classified.issuedOn ?? "",
        expiresOn: classified.expiresOn ?? "",
        storageKind,
        locationLabel:
          isMailboxAdd(method)
            ? method === "email-connect"
              ? "Stored locally from your mailbox"
              : "Stored locally after inbox processing"
            : storageKind === "stored"
              ? "Stored locally in ScannedOnArrival"
              : `${file.name} from Files`,
        locationProvider:
          isMailboxAdd(method) ? "email" : storageKind === "stored" ? "local" : "files",
        fileName: pdfFile ? file.name : pagesToStore[0].name,
        mimeType: pagesToStore[0].type,
      });
      setDraft(next);
      setExpiryMode(next.expiresOn ? "date" : "na");
      const reviewFirst = isMailboxAdd(method);
      const canAuto =
        !reviewFirst && method !== "camera" && classified.typeId !== "other" && classified.confidence !== "low" && !intendedType;
      if (canAuto) {
        const match = documents.find(
          (d) => d.typeId === next.typeId && d.isCurrent && d.typeId !== "other" && sameOwner(d, next),
        );
        if (match) {
          setExisting(match);
          setStep("replace");
        } else {
          await onSave(next, true);
        }
      } else {
        setStep("form");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file locally.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!incomingFile || ingested.current) return;
    ingested.current = true;
    const method: SourceKind =
      incomingMethod ?? (isImage(incomingFile) ? "camera" : "upload");
    void handleFile(incomingFile, method, "stored");
  }, [incomingFile, incomingMethod]);

  const addCapturedPage = async (raw: File) => {
    setBusy(true);
    setBusyLabel("Sharpening the page…");
    try {
      const file = await enhanceDocument(raw);
      const page = { id: uid(), file, url: URL.createObjectURL(file), selected: true };
      setPages((current) => {
        setActivePage(current.length);
        return [...current, page];
      });
      setPending(null);
      setStep("pages");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not keep that scan.");
    } finally {
      setBusy(false);
    }
  };

  const openPage = async (file: File) => {
    setBusy(true);
    setBusyLabel("Finding the page edges…");
    try {
      const flattened = await flattenImageFile(file);
      await addCapturedPage(flattened);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that photo.");
      setBusy(false);
    }
  };

  const finishScan = async (extra?: File) => {
    const files = [
      ...pages.filter((page) => page.selected).map((page) => page.file),
      ...(extra ? [extra] : []),
    ];
    if (files.length === 0) {
      setError("Select at least one scan to save.");
      return;
    }
    setBusy(true);
    setBusyLabel(files.length > 1 ? "Reading the pages…" : "Reading the page with on-device OCR…");
    try {
      const texts: string[] = [];
      for (const file of files) {
        try {
          texts.push(await extractImageText(file));
        } catch {
          texts.push("");
        }
      }
      await handleFile(files[0], "camera", "stored", texts.join("\n"), files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish that scan.");
      setBusy(false);
    }
  };

  const applyCrop = async () => {
    if (!pending) return;
    setBusy(true);
    setBusyLabel("Cropping the page…");
    try {
      const cropped = await cropImageFile(pending.file, crop);
      const file = await enhanceDocument(cropped);
      const url = URL.createObjectURL(file);
      setPages((current) =>
        current.map((page, index) => (index === activePage ? { ...page, file, url, selected: true } : page)),
      );
      setPending(null);
      setStep("pages");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop that page.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (makeCurrent: boolean) => {
    if (!draft) return;
    await onSave(expiryMode === "na" ? { ...draft, expiresOn: "" } : draft, makeCurrent);
  };

  const continueFromForm = () => {
    if (!draft) return;
    if (isMailboxAdd(draft.method)) {
      void submit(true);
      return;
    }
    const match = documents.find(
      (d) => d.typeId === draft.typeId && d.isCurrent && d.typeId !== "other" && sameOwner(d, draft),
    );
    if (match) {
      setExisting(match);
      setStep("replace");
      return;
    }
    void submit(true);
  };

  if (step === "camera") {
    return (
      <ScannerScreen
        pageCount={pages.length}
        busy={busy}
        busyLabel={busyLabel}
        onClose={() => {
          if (pages.length > 0) setStep("pages");
          else if (startAt === "camera") onClose();
          else setStep("choose");
        }}
        onCaptured={addCapturedPage}
        onPickFromLibrary={(file) => void openPage(file)}
      />
    );
  }

  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {(busy || error) && (
          <div className={`modal-status ${error && !busy ? "warn" : ""}`} role="status" aria-live="polite">
            {busy ? busyLabel : error}
          </div>
        )}
        {step === "choose" && (
          <>
            <h2>Add a document</h2>
            <p className="meta">
              This is a browser web app. Scan means using your phone’s camera in this tab. You can also upload a
              PDF, add from Files, or reference where a copy already lives.
            </p>
            <div className="method-grid">
              <button className="method" onClick={() => beginMethod("camera")}>
                <strong>Scan with your phone</strong>
                <span>Point this browser’s camera at a letter, bill or passport page.</span>
              </button>
              <label className="method">
                <strong>Upload PDF</strong>
                <span>Choose a file from Downloads or Files. Processed locally.</span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      beginMethod("upload");
                      void handleFile(file, "upload", "stored");
                    }
                  }}
                />
              </label>
              <label className="method">
                <strong>Add from Files</strong>
                <span>Keep a copy here, or remember the location only.</span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file, "files", "referenced");
                  }}
                />
              </label>
              <button className="method" onClick={() => beginMethod("reference")}>
                <strong>Reference a location</strong>
                <span>Don’t duplicate the file. Index where the current copy already is.</span>
              </button>
            </div>
          </>
        )}

        {step === "pages" && pages[activePage] && (
          <>
            <h2>Your scans</h2>
            <p className="meta">
              Tap a page to keep it or leave it out. Add another page if the letter has a back, then save the
              ones you selected.
            </p>
            <div className="page-thumbs">
              {pages.map((page, index) => (
                <button
                  key={page.id}
                  className={`page-thumb ${index === activePage ? "active" : ""} ${page.selected ? "picked" : ""}`}
                  onClick={() => setActivePage(index)}
                >
                  <img src={page.url} alt={`Page ${index + 1}`} />
                </button>
              ))}
            </div>
            <button type="button" className="camera-wrap preview-open" onClick={() => setViewingPage(true)}>
              <img src={pages[activePage].url} alt={`Scan ${activePage + 1}`} />
            </button>
            <button type="button" className="secondary preview-full-btn" onClick={() => setViewingPage(true)}>
              View full file
            </button>
            {viewingPage && (
              <FileViewer
                title={`Scan ${activePage + 1}`}
                pages={pages.map((page) => ({ url: page.url, image: true }))}
                startAt={activePage}
                onClose={() => setViewingPage(false)}
              />
            )}
            <label className="scan-select">
              <input
                type="checkbox"
                checked={pages[activePage].selected}
                onChange={(e) =>
                  setPages((current) =>
                    current.map((page, index) =>
                      index === activePage ? { ...page, selected: e.target.checked } : page,
                    ),
                  )
                }
              />
              Use this scan
            </label>
            <div className="scan-pages-actions">
              <button className="primary" onClick={() => setStep("camera")}>
                Add another page
              </button>
              <button
                className="primary"
                onClick={() => void finishScan()}
                disabled={busy || pages.every((page) => !page.selected)}
              >
                {openaiApiKey ? "Identify and save" : "Save selected scans"}
              </button>
              <div className="row">
                <button
                  className="secondary"
                  onClick={() => {
                    const remaining = pages.length - 1;
                    setPages((current) => current.filter((_, index) => index !== activePage));
                    setActivePage((index) => Math.max(0, index - 1));
                    setStep(remaining <= 0 ? "camera" : "pages");
                  }}
                >
                  Don’t use this one
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setPending({ file: pages[activePage].file, url: pages[activePage].url });
                    setCrop(DEFAULT_CROP);
                    setStep("crop");
                  }}
                >
                  Crop
                </button>
              </div>
            </div>
          </>
        )}

        {step === "crop" && pending && (
          <>
            <h2>Crop the page</h2>
            <p className="meta">Trim the edges so the letter fills the frame. This stays on your phone.</p>
            <div className="crop-stage">
              <img src={pending.url} alt="Page to crop" />
              <div
                className="crop-frame"
                style={{
                  top: `${crop.top}%`,
                  right: `${crop.right}%`,
                  bottom: `${crop.bottom}%`,
                  left: `${crop.left}%`,
                }}
              />
            </div>
            <div className="crop-sliders">
              {(
                [
                  ["top", "Top"],
                  ["bottom", "Bottom"],
                  ["left", "Left"],
                  ["right", "Right"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="field">
                  <span>{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={crop[key]}
                    onChange={(e) => setCrop({ ...crop, [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            <div className="row">
              <button className="secondary" onClick={() => setStep("pages")}>
                Cancel
              </button>
              <button className="primary" onClick={() => void applyCrop()} disabled={busy}>
                Apply crop
              </button>
            </div>
          </>
        )}

        {step === "form" && draft && (
          <>
            <h2>Confirm what this is</h2>
            {isMailboxAdd(draft.method) && (
              <p className="meta">
                Choose the category and document type, then whether this should be the current version or an extra
                copy.
              </p>
            )}
            {draft.previewUrl && (
              <div className="preview" style={{ marginBottom: 12 }}>
                <img src={draft.previewUrl} alt={draft.title || "Document page"} />
              </div>
            )}
            {isMailboxAdd(draft.method) && documents.find((d) => d.typeId === draft.typeId && d.isCurrent && d.typeId !== "other" && sameOwner(d, draft)) && (
              <div className="notice">
                Setting this as current moves your older {typeById(draft.typeId).label} copy into Previous versions. Keep
                as another relevant copy leaves that current version in place, and this one stays in date.
              </div>
            )}
            {draft.classified && (
              <div className="notice ok">
                We think this belongs in {suggestedPath(draft.typeId, draft.period || undefined)}. Classification is
                local ({draft.classified.confidence} confidence).
              </div>
            )}
            {!draft.classified && draft.typeId !== "other" && (
              <div className="notice ok">
                We think this belongs in {suggestedPath(draft.typeId, draft.period || undefined)}. Save here, or pick
                another folder by changing the document type.
              </div>
            )}
            <label className="field">
              <span>Title</span>
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <WhoseField
              people={people}
              personId={draft.personId ?? ""}
              onChange={(personId) => setDraft({ ...draft, personId: personId || undefined })}
              onCreatePerson={onCreatePerson}
            />
            <label className="field">
              <span>Category</span>
              <select
                value={creatingCategory ? "__new__" : draft.categoryId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setCreatingCategory(true);
                    setCreatingType(false);
                    return;
                  }
                  setCreatingCategory(false);
                  setCreatingType(false);
                  const categoryId = e.target.value;
                  const types = allTypes().filter((type) => type.categoryId === categoryId);
                  const keep = types.some((type) => type.id === draft.typeId);
                  const nextType = keep ? typeById(draft.typeId) : types[0] ?? typeById("other");
                  setDraft({
                    ...draft,
                    categoryId,
                    typeId: nextType.id,
                    title: draft.title || (draft.period ? `${nextType.label} ${draft.period}` : nextType.label),
                  });
                }}
              >
                {allCategories().map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
                <option value="__new__">Create a new category…</option>
              </select>
            </label>
            {creatingCategory && (
              <div className="row">
                <label className="field" style={{ flex: 1 }}>
                  <span>New category name</span>
                  <input
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="School, Pets, Work…"
                  />
                </label>
                <button
                  className="primary"
                  type="button"
                  disabled={!newCategory.trim()}
                  onClick={() => {
                    void (async () => {
                      try {
                        const created = await onCreateCategory(newCategory);
                        setCreatingCategory(false);
                        setNewCategory("");
                        setDraft({
                          ...draft,
                          categoryId: created.categoryId,
                          typeId: created.typeId as DocumentTypeId,
                          title: draft.title || newCategory.trim(),
                        });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not create that category.");
                      }
                    })();
                  }}
                >
                  Create
                </button>
              </div>
            )}
            <label className="field">
              <span>Document type</span>
              <select
                value={creatingType ? "__new__" : draft.typeId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setCreatingType(true);
                    return;
                  }
                  setCreatingType(false);
                  const type = typeById(e.target.value);
                  setDraft({
                    ...draft,
                    typeId: type.id,
                    categoryId: type.categoryId,
                    title: draft.period ? `${type.label} ${draft.period}` : type.label,
                  });
                }}
              >
                {allTypes()
                  .filter((type) => type.categoryId === draft.categoryId)
                  .map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                <option value="__new__">Create a new document type…</option>
              </select>
            </label>
            {creatingType && (
              <div className="row">
                <label className="field" style={{ flex: 1 }}>
                  <span>New document type</span>
                  <input
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    placeholder="School letter, NHS letter…"
                  />
                </label>
                <button
                  className="primary"
                  type="button"
                  disabled={!newType.trim() || creatingCategory}
                  onClick={() => {
                    void (async () => {
                      try {
                        const created = await onCreateType(newType, draft.categoryId);
                        setCreatingType(false);
                        setNewType("");
                        setDraft({
                          ...draft,
                          typeId: created.typeId as DocumentTypeId,
                          categoryId: created.categoryId,
                          title: draft.title || newType.trim(),
                        });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not create that document type.");
                      }
                    })();
                  }}
                >
                  Create
                </button>
              </div>
            )}
            <label className="field">
              <span>Period</span>
              <input
                placeholder="2026–27"
                value={draft.period}
                onChange={(e) => setDraft({ ...draft, period: e.target.value })}
              />
            </label>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                <span>Issued</span>
                <input type="date" value={draft.issuedOn} onChange={(e) => setDraft({ ...draft, issuedOn: e.target.value })} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>Expires</span>
                <div className="switch expiry-switch">
                  <button
                    type="button"
                    className={expiryMode === "na" ? "active" : ""}
                    onClick={() => {
                      setExpiryMode("na");
                      setDraft({ ...draft, expiresOn: "" });
                    }}
                  >
                    N/A
                  </button>
                  <button
                    type="button"
                    className={expiryMode === "date" ? "active" : ""}
                    onClick={() => setExpiryMode("date")}
                  >
                    Date
                  </button>
                </div>
                {expiryMode === "date" && (
                  <input
                    type="date"
                    value={draft.expiresOn}
                    onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })}
                  />
                )}
              </label>
            </div>
            <label className="field">
              <span>Storage</span>
              <select
                value={draft.storageKind}
                onChange={(e) => {
                  const storageKind = e.target.value as AddDraft["storageKind"];
                  setDraft({
                    ...draft,
                    storageKind,
                    locationLabel:
                      storageKind === "stored"
                        ? "Stored locally in ScannedOnArrival"
                        : draft.locationLabel || "iCloud Drive → Documents",
                    locationProvider: storageKind === "stored" ? "local" : draft.locationProvider,
                  });
                }}
              >
                <option value="stored">Stored here — keep a local copy</option>
                <option value="referenced">Referenced here — leave the file where it is</option>
              </select>
            </label>
            <label className="field">
              <span>Location</span>
              <input
                value={draft.locationLabel}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    locationLabel: e.target.value,
                    locationProvider: providerFromLabel(e.target.value),
                  })
                }
              />
            </label>
            <div className="row">
              <button className="secondary" onClick={onClose}>
                Cancel
              </button>
              {isMailboxAdd(draft.method) ? (
                <>
                  <button className="secondary" onClick={() => void submit(false)} disabled={!draft.title}>
                    Keep as another relevant copy
                  </button>
                  <button className="primary" onClick={continueFromForm} disabled={!draft.title}>
                    Set as current version
                  </button>
                </>
              ) : (
                <button className="primary" onClick={continueFromForm} disabled={!draft.title}>
                  Save here
                </button>
              )}
            </div>
          </>
        )}

        {step === "replace" && draft && existing && (
          <>
            <h2>Newer {typeById(draft.typeId).label} document detected</h2>
            <p>
              Your current copy is {existing.period ?? existing.title}. Set this as the current version, or keep it as
              another relevant copy so both stay in date. A replaced copy is not deleted — it moves into Previous
              versions.
            </p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="secondary" onClick={() => submit(false)}>
                Keep as another relevant copy
              </button>
              <button className="primary" onClick={() => submit(true)}>
                Set as current version
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
