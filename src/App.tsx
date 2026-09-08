import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type {
  AddDraft,
  AppSettings,
  DocumentRecord,
  DocumentTypeDef,
  DocumentTypeId,
  FoundEmailDoc,
  InboxItem,
  LocationProvider,
  SourceKind,
  ViewId,
} from "./types";
import {
  allCategories,
  allTypes,
  setCatalogExtras,
  suggestedPath,
  typeById,
} from "./data/taxonomy";
import { SAMPLE_DOCUMENTS, SAMPLE_INBOX } from "./data/sample";
import { computeStatus, freshnessLabel, providerLabel, storageVerb } from "./data/status";
import { extractPdfText, isImage, isPdf } from "./lib/pdf";
import { extractImageText } from "./lib/ocr";
import { consumeSharedFile, isDesktopLayout, isIos, isStandalone } from "./lib/pwa";
import { buildBackup, downloadBackup, parseBackupFile, restoreBackup } from "./lib/backup";
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
  inboxAddress: "you@inbox.scannedonarrival.app",
  gmailConnected: false,
  outlookConnected: false,
  showDemoHousehold: false,
  onboardingComplete: false,
  notificationsEnabled: false,
  openaiApiKey: "",
  customCategories: [],
  customTypes: [],
};

const DEFAULT_CROP: CropInsets = { top: 4, right: 4, bottom: 4, left: 4 };
const DEMO_DOC_ID = "demo-try-scan";
const DEMO_PAGE_LIMIT = 3;
const NAV_ITEMS: Array<{ id: ViewId; label: string; short: string }> = [
  { id: "ready", label: "Ready", short: "Ready" },
  { id: "documents", label: "Documents", short: "Docs" },
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
      <rect x="10.6" y="16" width="1.8" height="5.6" rx="0.9" fill="currentColor" />
      <rect x="10.6" y="23.4" width="1.8" height="3.6" rx="0.9" fill="currentColor" />
      <rect x="35.6" y="19.2" width="1.8" height="8.4" rx="0.9" fill="currentColor" />
      <rect x="13.8" y="3.4" width="20.4" height="41.2" rx="6" fill="currentColor" />
      <rect x="15.6" y="5.4" width="16.8" height="37.2" rx="4.2" fill="#1b3a2f" />
      <rect x="20.2" y="6.8" width="7.6" height="2.8" rx="1.4" fill="currentColor" />
      <circle cx="25.8" cy="8.2" r="0.72" fill="#1b3a2f" />
      <rect x="18.4" y="12.8" width="11.2" height="16.8" rx="1.1" fill="currentColor" />
      <path d="M26.2 12.8h3.4v3.4H27.4c-.66 0-1.2-.54-1.2-1.2Z" fill="#1b3a2f" opacity="0.22" />
      <path d="M26.2 12.8 29.6 16.2h-2.1c-.72 0-1.3-.58-1.3-1.3Z" fill="#1b3a2f" opacity="0.4" />
      <rect x="20.2" y="18.8" width="7.6" height="1.15" rx="0.55" fill="#1b3a2f" opacity="0.5" />
      <rect x="20.2" y="21.4" width="7.6" height="1.15" rx="0.55" fill="#1b3a2f" opacity="0.38" />
      <rect x="20.2" y="24" width="5.4" height="1.15" rx="0.55" fill="#1b3a2f" opacity="0.26" />
    </svg>
  );
}

function ScanCta({
  onScan,
  onAdd,
  compact,
}: {
  onScan: () => void;
  onAdd?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`scan-cta ${compact ? "compact" : ""}`}>
      <button type="button" className="scan-cta-btn" onClick={onScan}>
        <span className="scan-cta-icon">
          <PhoneGlyph />
        </span>
        <span className="scan-cta-copy">
          <strong>Scan with your phone</strong>
          <em>Point this browser at the paper — no app to install</em>
        </span>
      </button>
      {onAdd && (
        <button type="button" className="scan-cta-add" onClick={onAdd}>
          or add a PDF or file
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
  const [view, setView] = useState<ViewId>("ready");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addStart, setAddStart] = useState<"choose" | "camera">("choose");
  const [intendedTypeId, setIntendedTypeId] = useState<string | null>(null);
  const [incomingFile, setIncomingFile] = useState<File | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [demoLanding, setDemoLanding] = useState(false);
  const [fromDemoNav, setFromDemoNav] = useState(false);

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
        if (storedSettings) {
          const next = {
            ...DEFAULT_SETTINGS,
            ...storedSettings,
            customCategories: storedSettings.customCategories ?? [],
            customTypes: storedSettings.customTypes ?? [],
          };
          setCatalogExtras(next.customCategories, next.customTypes);
          setSettings(next);
        }
        setInbox(storedInbox.length ? storedInbox : SAMPLE_INBOX);
      } catch {
        if (!alive) return;
        setInbox(SAMPLE_INBOX);
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
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const openScan = params.get("scan") === "1";
    const shared = params.get("shared") === "1";

    const consumeLaunch = async () => {
      if (shared) {
        const file = await consumeSharedFile();
        if (file) {
          setIncomingFile(file);
          setAddStart("choose");
          setAddOpen(true);
        }
      } else if (openScan) {
        setAddStart("camera");
        setAddOpen(true);
      }
      if (openScan || shared) {
        const url = new URL(window.location.href);
        url.searchParams.delete("scan");
        url.searchParams.delete("shared");
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      }
    };

    void consumeLaunch();

    if (window.launchQueue) {
      window.launchQueue.setConsumer((params) => {
        void (async () => {
          const file = await params.files[0]?.getFile();
          if (!file) return;
          setIncomingFile(file);
          setAddOpen(true);
        })();
      });
    }
  }, [hydrated]);

  const persistSettings = async (next: AppSettings) => {
    const safe = {
      ...next,
      customCategories: next.customCategories ?? [],
      customTypes: next.customTypes ?? [],
    };
    setCatalogExtras(safe.customCategories, safe.customTypes);
    setSettings(safe);
    await saveSettings(safe);
  };

  const openAdd = (start: "choose" | "camera", typeId?: string | null) => {
    setIncomingFile(null);
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

  const persistDocs = async (next: DocumentRecord[]) => {
    setDocuments(next);
    await saveDocuments(next);
  };

  const persistInbox = async (next: InboxItem[]) => {
    setInbox(next);
    await saveInbox(next);
  };

  const currentDocs = documents.filter((d) => d.isCurrent);
  const attention = useMemo(() => listAttention(documents), [documents]);

  useEffect(() => {
    if (!hydrated || !settings.notificationsEnabled) return;
    maybeNotify(attention);
  }, [hydrated, settings.notificationsEnabled, attention]);

  const startEmpty = async () => {
    await persistSettings({ ...settings, onboardingComplete: true, showDemoHousehold: false });
  };

  const startDemo = async () => {
    await persistDocs(SAMPLE_DOCUMENTS);
    await persistInbox(SAMPLE_INBOX);
    await persistSettings({ ...settings, onboardingComplete: true, showDemoHousehold: true });
  };

  const startTryDemo = async () => {
    await persistSettings({ ...settings, onboardingComplete: true, showDemoHousehold: false });
    setView("demo");
  };

  const goToView = (next: ViewId) => {
    if (view === "demo" && next === "documents") setFromDemoNav(true);
    setView(next);
  };

  const openRealThing = () => {
    setDemoLanding(false);
    setFromDemoNav(false);
    setView("ready");
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
    setView("documents");
    setToast("Saved under Home → Council Tax");
  };

  const addDocument = async (draft: AddDraft, makeCurrent: boolean) => {
    const id = uid();
    const sameType = documents.filter((d) => d.typeId === draft.typeId);
    const nextDocs = documents.map((d) =>
      makeCurrent && d.typeId === draft.typeId && d.isCurrent
        ? { ...d, isCurrent: false, supersededBy: id }
        : d,
    );
    const pageFiles = draft.files?.length ? draft.files : draft.file ? [draft.file] : [];
    const record: DocumentRecord = {
      id,
      title: draft.title,
      typeId: draft.typeId,
      categoryId: draft.categoryId,
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
    setAddStart("choose");
    setSelectedId(id);
    setExpandedTypeId(record.typeId);
    setView("documents");
    setToast(`${record.title} added`);
  };

  const addFromInbox = async (item: InboxItem) => {
    const type = typeById(item.typeId);
    const draft: AddDraft = {
      method: "email-forward",
      title: item.period ? `${type.label} ${item.period}` : type.label,
      typeId: item.typeId,
      categoryId: type.categoryId,
      period: item.period ?? "",
      issuedOn: "",
      expiresOn: "",
      storageKind: settings.privacyMode === "inbox" ? "stored" : "referenced",
      locationLabel:
        settings.privacyMode === "inbox"
          ? "Stored locally after inbox processing"
          : "Email attachment — add locally to keep a private copy",
      locationProvider: "email",
      fileName: item.attachmentName,
    };
    await addDocument(draft, true);
    await persistInbox(inbox.map((row) => (row.id === item.id ? { ...row, status: "added" } : row)));
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
      <aside className="sidebar">
        <div className="wordmark">
          <ProductBadge tone="dark" />
          <strong>ScannedOnArrival</strong>
          <span>What you have, how current it is, and where it lives.</span>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map(({ id, label }) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => goToView(id)}>
              {label}
            </button>
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
        <header className="topbar">
          <div>
            <ProductBadge />
            <div className="topbar-heading">
              <h1>
                {view === "ready" && "Ready"}
                {view === "demo" && "Demo"}
                {view === "documents" && "Documents"}
                {view === "tree" && "Document tree"}
                {view === "inbox" && "Document inbox"}
                {view === "settings" && "Settings"}
              </h1>
              {view === "ready" && (
                <button type="button" className="try-demo-btn" onClick={() => setView("demo")}>
                  Try Demo
                </button>
              )}
            </div>
            <p>
              {view === "ready" && "What’s current, missing, or overdue — organised by document type, not files."}
              {view === "demo" && "Scan the letter, check the page, then save it under Council Tax."}
              {view === "documents" && "Tap a category, then a type. Swipe the tabs for other types; swipe the page for other copies."}
              {view === "tree" && "A filing-cabinet view. The folders are logical; the files can live anywhere."}
              {view === "inbox" && "Letterbox or inbox: both are ways documents arrive. Email stays optional."}
              {view === "settings" && "Keep the privacy story clear. Local by default, convenience only if you choose it."}
            </p>
          </div>
        </header>
        {(view === "demo" || demoLanding) && (
          <p className="demo-ribbon demo-ribbon-bar" aria-hidden="true">
            Demo
          </p>
        )}
        {view === "documents" && (demoLanding || fromDemoNav) && (
          <div className="scan-hero">
            <button type="button" className="primary ready demo-real demo-landing-real" onClick={openRealThing}>
              Try the real thing now
            </button>
          </div>
        )}
        {view !== "demo" && view !== "documents" && !demoLanding && (
          <div className="scan-hero">
            <ScanCta
              onScan={() => openAdd("camera")}
              onAdd={() => openAdd("choose")}
            />
          </div>
        )}
        {view === "documents" && !demoLanding && !fromDemoNav && (
          <div className="scan-hero">
            <ScanCta
              onScan={() => openAdd("camera")}
              onAdd={() => openAdd("choose")}
            />
          </div>
        )}

        <div className="content">
          <InstallBanner
            prompt={installPrompt}
            onInstalled={() => setInstallPrompt(null)}
          />
          {view === "ready" && (
            <ReadyView
              documents={documents}
              attention={attention}
              expandedTypeId={expandedTypeId}
              onExpand={(typeId, documentId) => {
                setExpandedTypeId(typeId);
                if (documentId) setSelectedId(documentId);
              }}
              onAdd={() => openAdd(isDesktopLayout() ? "choose" : "camera")}
              onScan={(typeId) => openAdd("camera", typeId)}
              onDeleted={async (id) => {
                await deleteDocument(id);
                setDocuments(documents.filter((d) => d.id !== id));
                if (selectedId === id) setSelectedId(null);
              }}
            />
          )}
          {view === "demo" && (
            <DemoView
              onSave={saveDemoScan}
              onTryReal={openRealThing}
            />
          )}
          {view === "documents" && (
            <DocumentsView
              documents={currentDocs}
              allDocuments={documents}
              expandedTypeId={expandedTypeId}
              fromDemo={demoLanding}
              showRealCta={demoLanding || fromDemoNav}
              onDismissDemo={() => setDemoLanding(false)}
              onExpand={(typeId, documentId) => {
                setExpandedTypeId(typeId);
                if (documentId) setSelectedId(documentId);
              }}
              onAdd={() => openAdd("choose")}
              onScan={(typeId) => openAdd("camera", typeId)}
              onDeleted={async (id) => {
                await deleteDocument(id);
                setDocuments(documents.filter((d) => d.id !== id));
                if (selectedId === id) setSelectedId(null);
              }}
            />
          )}
          {view === "tree" && (
            <TreeView
              documents={documents}
              onSelect={(id) => {
                const doc = documents.find((item) => item.id === id);
                setSelectedId(id);
                setExpandedTypeId(doc?.typeId ?? null);
                setView("documents");
              }}
            />
          )}
          {view === "inbox" && (
            <InboxView
              settings={settings}
              inbox={inbox}
              foundEmail={foundEmail}
              documents={documents}
              onSettings={persistSettings}
              onConfirm={addFromInbox}
              onFound={setFoundEmail}
              onAddFound={async (item) => {
                const type = typeById(item.typeId);
                await addDocument(
                  {
                    method: "email-connect",
                    title: item.title,
                    typeId: item.typeId,
                    categoryId: type.categoryId,
                    period: item.period ?? "",
                    issuedOn: "",
                    expiresOn: "",
                    storageKind: "referenced",
                    locationLabel: `${item.mailbox === "gmail" ? "Gmail" : "Outlook"} attachment`,
                    locationProvider: "email",
                  },
                  true,
                );
                setFoundEmail(foundEmail.map((row) => (row.id === item.id ? { ...row, added: true } : row)));
              }}
              onToast={setToast}
            />
          )}
          {view === "settings" && (
            <SettingsView
              settings={settings}
              installPrompt={installPrompt}
              onInstalled={() => setInstallPrompt(null)}
              onSettings={persistSettings}
              onExport={async () => {
                try {
                  const backup = await buildBackup(settings);
                  downloadBackup(backup);
                  setToast("Backup downloaded to this device");
                } catch (err) {
                  setToast(err instanceof Error ? err.message : "Could not export the backup.");
                }
              }}
              onRestore={async (file) => {
                if (!window.confirm("Restore this backup? It replaces the index on this browser.")) return;
                try {
                  const backup = await parseBackupFile(file);
                  const restored = await restoreBackup(backup, DEFAULT_SETTINGS);
                  const nextSettings = {
                    ...DEFAULT_SETTINGS,
                    ...restored.settings,
                    customCategories: restored.settings.customCategories ?? [],
                    customTypes: restored.settings.customTypes ?? [],
                  };
                  setCatalogExtras(nextSettings.customCategories, nextSettings.customTypes);
                  setDocuments(restored.documents);
                  setSettings(nextSettings);
                  setInbox(restored.inbox.length ? restored.inbox : SAMPLE_INBOX);
                  setFoundEmail([]);
                  setToast(`Restored ${restored.documents.length} documents`);
                } catch (err) {
                  setToast(err instanceof Error ? err.message : "Could not restore that backup.");
                }
              }}
              onReset={async () => {
                await clearAllData();
                setDocuments([]);
                setInbox(SAMPLE_INBOX);
                setFoundEmail([]);
                await persistSettings({ ...DEFAULT_SETTINGS });
              }}
            />
          )}
        </div>
      </main>

      <nav className="mobile-nav">
        {NAV_ITEMS.map(({ id, short }) => (
          <button key={id} className={view === id ? "active" : ""} onClick={() => goToView(id)}>
            {short}
          </button>
        ))}
      </nav>

      {addOpen && (
        <AddDocumentModal
          documents={documents}
          startAt={addStart}
          intendedTypeId={intendedTypeId}
          incomingFile={incomingFile}
          openaiApiKey={settings.openaiApiKey}
          onClose={() => {
            setAddOpen(false);
            setIncomingFile(null);
            setIntendedTypeId(null);
            setAddStart("choose");
          }}
          onSave={addDocument}
          onCreateCategory={createCategory}
          onCreateType={createType}
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
          <div className="demo-cta">
            <button type="button" className="primary demo-try" disabled={loading} onClick={() => void startScan()}>
              {loading ? "Opening the camera…" : "Try the demo"}
            </button>
            <button type="button" className="primary ready demo-real" onClick={onTryReal}>
              Try the real thing now
            </button>
          </div>
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

      {phase === "pages" && currentPage && (
        <div className="demo-review">
          <p className="demo-ribbon demo-ribbon-bar" aria-hidden="true">
            Demo
          </p>
          <div className="demo-review-top">
            <button className="scanner-icon-btn" type="button" onClick={closeReview} aria-label="Close">
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
        </div>
      )}

      {phase === "form" && (
        <div className="demo-review">
          <p className="demo-ribbon demo-ribbon-bar" aria-hidden="true">
            Demo
          </p>
          <div className="demo-review-top">
            <button className="scanner-icon-btn" type="button" onClick={() => setPhase("pages")} aria-label="Back">
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
        </div>
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

function ReadyView({
  documents,
  attention,
  expandedTypeId,
  onExpand,
  onAdd,
  onScan,
  onDeleted,
}: {
  documents: DocumentRecord[];
  attention: AttentionItem[];
  expandedTypeId: string | null;
  onExpand: (typeId: string | null, documentId?: string) => void;
  onAdd: () => void;
  onScan: (typeId: string) => void;
  onDeleted: (id: string) => void;
}) {
  const current = documents.filter((d) => d.isCurrent);
  const rows = allTypes().filter((t) => t.id !== "other").map((type) => {
    const doc = current.find((d) => d.typeId === type.id);
    const status = doc ? computeStatus(doc) : "missing";
    return { type, doc, status };
  });
  const missing = rows.filter((r) => r.status === "missing").length;
  const outdated = rows.filter((r) => r.status === "outdated" || r.status === "expiring").length;
  const ready = rows.filter((r) => r.status === "current").length;

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
      <div className="summary-strip">
        <div className="stat current">
          <b>{ready}</b>
          Current
        </div>
        <div className="stat attention">
          <b>{outdated}</b>
          Needs attention
        </div>
        <div className="stat missing">
          <b>{missing}</b>
          Missing
        </div>
      </div>
      {attention.length > 0 && (
        <div className="attention-list">
          <strong>Needs attention</strong>
          <span>These copies are in your index but are outdated or about to expire.</span>
          {attention.map((item) => (
            <button
              key={item.key}
              className="attention-row"
              onClick={() => {
                const doc = documents.find((row) => row.id === item.documentId);
                onExpand(doc?.typeId ?? null, item.documentId);
              }}
            >
              <div>
                <b>{item.typeLabel}</b>
                <small>
                  {item.title} · {item.detail}
                </small>
              </div>
              <span className={`badge ${item.kind}`}>{item.kind === "expiring" ? "Expiring" : "Outdated"}</span>
            </button>
          ))}
        </div>
      )}
      <TypeAccordion
        types={allTypes().filter((type) => type.id !== "other")}
        documents={documents}
        expandedTypeId={expandedTypeId}
        includeEmpty
        onExpand={onExpand}
        onAdd={onAdd}
        onScan={onScan}
        onDeleted={onDeleted}
      />
    </>
  );
}

function statusBadgeText(status: "current" | "outdated" | "expiring" | "missing") {
  if (status === "current") return "Current";
  if (status === "expiring") return "Expiring";
  if (status === "missing") return "Missing";
  return "Outdated";
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

function scrollCategoryToTop(categoryId: string, behavior: ScrollBehavior) {
  const card = document.getElementById(`category-${categoryId}`);
  if (!card) return;
  const scroller = documentsScroller();
  const top = Math.max(0, scroller.scrollTop + card.getBoundingClientRect().top - 12);
  if (behavior === "auto" || prefersReducedMotion()) {
    scroller.scrollTop = top;
    return;
  }
  const start = scroller.scrollTop;
  const delta = top - start;
  if (Math.abs(delta) < 2) return;
  const duration = 340;
  const began = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - began) / duration);
    const eased = 1 - (1 - t) ** 3;
    scroller.scrollTop = start + delta * eased;
    if (t < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
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

function TypeAccordion({
  types,
  documents,
  expandedTypeId,
  includeEmpty,
  onExpand,
  onAdd,
  onScan,
  onDeleted,
}: {
  types: DocumentTypeDef[];
  documents: DocumentRecord[];
  expandedTypeId: string | null;
  includeEmpty?: boolean;
  onExpand: (typeId: string | null, documentId?: string) => void;
  onAdd?: () => void;
  onScan?: (typeId: string) => void;
  onDeleted: (id: string) => void;
}) {
  const groups = types
    .map((type) => {
      const copies = copiesForType(documents, type.id);
      const current = copies.find((doc) => doc.isCurrent) ?? copies[0];
      return { type, copies, current };
    })
    .filter((group) => includeEmpty || group.copies.length);

  return (
    <div className="doc-stack">
      {groups.map(({ type, copies, current }) => {
        const open = expandedTypeId === type.id;
        const status = current ? computeStatus(current) : "missing";
        return (
          <section
            key={type.id}
            id={`type-${type.id}`}
            className={`doc-type-card ${open ? "open" : ""}`}
          >
            <button
              className="doc-type-head"
              onClick={() => {
                onExpand(open ? null : type.id, current?.id);
                window.requestAnimationFrame(() => {
                  document.getElementById(`type-${type.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            >
              <div>
                <div className="kicker">{allCategories().find((category) => category.id === type.categoryId)?.label}</div>
                <h3>
                  {type.label} <span className="doc-count">{copies.length}</span>
                </h3>
                <p className="meta">
                  {copies.length === 0
                    ? "No documents yet. Open to scan into this type."
                    : current
                      ? `${copies.length} ${copies.length === 1 ? "document" : "documents"} · ${freshnessLabel(current)}`
                      : `${copies.length} ${copies.length === 1 ? "document" : "documents"}`}
                </p>
              </div>
              <span className={`badge ${status}`}>{statusBadgeText(status)}</span>
            </button>
            {open && (
              <>
                <div className="doc-type-toolbar">
                  {onScan && <ScanCta compact onScan={() => onScan(type.id)} onAdd={onAdd} />}
                </div>
                {copies.length === 0 && <p className="meta doc-type-empty">Nothing saved here yet.</p>}
                {current && (
                  <div className="doc-rail" aria-label={`${type.label} copies`}>
                    {copies.map((doc) => (
                      <div key={doc.id} className="doc-slide">
                        <DocumentDetail
                          doc={doc}
                          previous={copies.filter((item) => item.id !== doc.id && !item.isCurrent)}
                          compact
                          onDeleted={() => onDeleted(doc.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DocumentsView({
  documents,
  allDocuments,
  expandedTypeId,
  fromDemo,
  showRealCta,
  onDismissDemo,
  onExpand,
  onAdd,
  onScan,
  onDeleted,
}: {
  documents: DocumentRecord[];
  allDocuments: DocumentRecord[];
  expandedTypeId: string | null;
  fromDemo?: boolean;
  showRealCta?: boolean;
  onDismissDemo?: () => void;
  onExpand: (typeId: string | null, documentId?: string) => void;
  onAdd: () => void;
  onScan: (typeId: string) => void;
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
      return {
        category,
        types,
        count,
        ready: statuses.filter((status) => status === "current").length,
        attention: statuses.filter((status) => status === "outdated" || status === "expiring").length,
        missing: statuses.filter((status) => status === "missing").length,
      };
    })
    .filter((group) => group.types.length);

  const selectedType = expandedTypeId ? typeById(expandedTypeId) : null;
  const selectedCategoryId =
    catalog.find((group) => group.category.id === selectedType?.categoryId)?.category.id ??
    catalog.find((group) => group.count > 0)?.category.id ??
    catalog[0]?.category.id ??
    null;
  const pendingPin = useRef<{ id: string; y: number } | null>(null);

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
    if (selectedCategoryId === categoryId && expandedTypeId) {
      scrollCategoryToTop(categoryId, prefersReducedMotion() ? "auto" : "smooth");
      return;
    }
    const preferred =
      group.types.find((type) => type.id === expandedTypeId) ??
      group.types.find((type) => copiesForType(allDocuments, type.id).length > 0) ??
      group.types[0];
    if (preferred) selectType(preferred.id, pinY);
  };

  useLayoutEffect(() => {
    if (!selectedCategoryId) return;
    const pin = pendingPin.current;
    pendingPin.current = null;
    const card = document.getElementById(`category-${selectedCategoryId}`);
    if (!card) return;

    if (pin && pin.id === selectedCategoryId) {
      const drift = card.getBoundingClientRect().top - pin.y;
      if (Math.abs(drift) > 1) {
        documentsScroller().scrollTop += drift;
      }
    }

    const rise = () => scrollCategoryToTop(selectedCategoryId, prefersReducedMotion() ? "auto" : "smooth");
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(rise));
    const retry = window.setTimeout(rise, 360);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
    };
  }, [selectedCategoryId]);

  return (
    <>
      {documents.length === 0 && (
        <div className="card empty">
          <h2>Nothing indexed yet</h2>
          <p>Tap a category, pick a type tab, then Scan with your phone. That type is selected before the camera opens.</p>
        </div>
      )}
      {catalog.map((group) => {
        const selected = group.category.id === selectedCategoryId;
        const activeType =
          group.types.find((type) => type.id === expandedTypeId) ??
          group.types.find((type) => copiesForType(allDocuments, type.id).length > 0) ??
          group.types[0];
        const copies = activeType ? copiesForType(allDocuments, activeType.id) : [];
        const current = copies.find((doc) => doc.isCurrent) ?? copies[0];
        const status = current ? computeStatus(current) : "missing";
        return (
          <section
            key={group.category.id}
            id={`category-${group.category.id}`}
            className={`doc-category-card ${selected ? "selected" : ""}`}
          >
            <button
              type="button"
              className="doc-category-card-head"
              aria-pressed={selected}
              onClick={(event) => selectCategory(group.category.id, event.currentTarget.getBoundingClientRect().top)}
            >
              <div>
                <h2>{group.category.label}</h2>
                <p className="meta">
                  {group.count} {group.count === 1 ? "document" : "documents"}
                  {group.ready > 0 ? ` · ${group.ready} current` : ""}
                  {group.attention > 0 ? ` · ${group.attention} needs attention` : ""}
                  {group.missing > 0 ? ` · ${group.missing} missing` : ""}
                </p>
              </div>
              {selected && <span className="badge current">Selected</span>}
            </button>
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
            {selected && activeType && (
              <div className="doc-category-body">
                <div className="doc-category-body-inner">
                  <TypeTabStrip
                    types={group.types}
                    documents={allDocuments}
                    selectedId={activeType.id}
                    onSelect={selectType}
                  />
                  <div className="doc-type-toolbar">
                    <div className="doc-type-selected">
                      <div>
                        <h3>
                          {activeType.label} <span className="doc-count">{copies.length}</span>
                        </h3>
                        <p className="meta">
                          {copies.length === 0
                            ? "Nothing saved here yet. Scan into this type."
                            : current
                              ? `${copies.length} ${copies.length === 1 ? "document" : "documents"} · ${freshnessLabel(current)}`
                              : `${copies.length} ${copies.length === 1 ? "document" : "documents"}`}
                        </p>
                      </div>
                      <span className={`badge ${status}`}>{statusBadgeText(status)}</span>
                    </div>
                    {!showRealCta && <ScanCta compact onScan={() => onScan(activeType.id)} onAdd={onAdd} />}
                  </div>
                  {copies.length === 0 && <p className="meta doc-type-empty">Nothing saved here yet.</p>}
                  {current && (
                    <div className="doc-rail" aria-label={`${activeType.label} copies`}>
                      {copies.map((doc) => (
                        <div key={doc.id} className="doc-slide">
                          <DocumentDetail
                            doc={doc}
                            previous={copies.filter((item) => item.id !== doc.id && !item.isCurrent)}
                            compact
                            onDeleted={() => onDeleted(doc.id)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function isVisualImage(mimeType?: string, fileName?: string) {
  const type = (mimeType || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (type.includes("pdf")) return false;
  return /\.(jpe?g|png|gif|webp|heic)$/i.test(fileName || "");
}

function FileViewer({
  title,
  pages,
  startAt,
  onClose,
  demo,
}: {
  title: string;
  pages: Array<{ url: string; image: boolean }>;
  startAt: number;
  onClose: () => void;
  demo?: boolean;
}) {
  const [index, setIndex] = useState(startAt);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const page = pages[index];

  const goTo = (next: number) => {
    setIndex(Math.max(0, Math.min(pages.length - 1, next)));
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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (pages.length < 2) return;
    swipeStart.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || pages.length < 2) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
    goTo(index + (dx < 0 ? 1 : -1));
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
        <div>
          <strong>{title}</strong>
          {pages.length > 1 && (
            <p className="meta">
              Page {index + 1} of {pages.length} · swipe or drag sideways
            </p>
          )}
        </div>
      </div>
      <div
        className={`file-viewer-body ${pages.length > 1 ? "swipeable" : ""}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
      >
        {page.image ? (
          <div className="file-viewer-page">
            <img src={page.url} alt={`${title} page ${index + 1}`} draggable={false} />
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

function DocumentDetail({
  doc,
  previous,
  compact,
  onDeleted,
}: {
  doc: DocumentRecord;
  previous: DocumentRecord[];
  compact?: boolean;
  onDeleted: () => void;
}) {
  const [pages, setPages] = useState<Array<{ url: string; image: boolean }>>([]);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [pagesLoading, setPagesLoading] = useState(doc.storageKind === "stored");

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
          const cleaned = await Promise.all(
            blobs.map((blob) =>
              isVisualImage(blob.type || doc.mimeType, doc.fileName) ? bleachScanBlob(blob) : Promise.resolve(blob),
            ),
          );
          if (!alive) return;
          urls.forEach((url) => URL.revokeObjectURL(url));
          urls = cleaned.map((blob) => URL.createObjectURL(blob));
          setPages(
            cleaned.map((blob, index) => ({
              url: urls[index],
              image: isVisualImage(blob.type || doc.mimeType, doc.fileName),
            })),
          );
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

  return (
    <aside className={`card doc-detail${doc.id === DEMO_DOC_ID ? " demo-doc" : ""}`}>
      <p className="kicker">{doc.isCurrent ? "Latest document" : "Earlier copy"}</p>
      <h2>{doc.title}</h2>
      <p className="meta">
        {providerLabel(doc.locationProvider)}
        <br />
        {doc.locationLabel}
      </p>
      <div className="row" style={{ margin: "12px 0" }}>
        <span className={`badge ${computeStatus(doc)}`}>{computeStatus(doc)}</span>
        <span className={`badge ${doc.storageKind}`}>{storageVerb(doc)}</span>
      </div>
      {pagesLoading && pages.length === 0 && (
        <div className="preview preview-loading" role="status">
          Opening the scan…
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
              <div className="page-rail" aria-label="Document pages">
                {pages.map((page, index) => (
                  <figure key={`${doc.id}-page-${index}`} className="page-slide">
                    <button type="button" className="preview-open" onClick={() => setViewerAt(index)}>
                      <img src={page.url} alt={`${doc.title} page ${index + 1}`} />
                      {doc.id === DEMO_DOC_ID && (
                        <span className="demo-ribbon demo-ribbon-corner" aria-hidden="true">
                          Demo
                        </span>
                      )}
                    </button>
                    <figcaption>Page {index + 1} of {pages.length}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="secondary preview-full-btn" onClick={() => setViewerAt(0)}>
            View full file
          </button>
          {pages.length > 1 && (
            <p className="meta">Swipe to see the other {pages.length === 2 ? "page" : `${pages.length - 1} pages`}.</p>
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
        />
      )}
      {doc.storageKind === "referenced" && (
        <div className="notice">
          The file stays where you already keep it. ScannedOnArrival only remembers the description and location.
        </div>
      )}
      <p className="meta">Last checked {doc.lastChecked}</p>
      {!compact && previous.length > 0 && (
        <>
          <h3 style={{ marginTop: 18 }}>Previous versions</h3>
          <div className="list">
            {previous.map((item) => (
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
      <div className="row" style={{ marginTop: 16 }}>
        <button className="danger" onClick={onDeleted}>
          Remove from index
        </button>
      </div>
    </aside>
  );
}

function TreeView({
  documents,
  onSelect,
}: {
  documents: DocumentRecord[];
  onSelect: (id: string) => void;
}) {
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
          .filter((t) => t.type.id !== "other" || t.docs.length),
      };
    }).filter((g) => g.types.some((t) => t.type.id !== "other" || t.docs.length));
  }, [documents]);

  return (
    <div className="tree">
      <div className="tree-node">
        <strong>My Documents</strong>
      </div>
      {grouped.map((group) => (
        <div key={group.category.id} className="tree-node">
          <div className="tree-row">
            <span>
              ├── {group.category.label} (
              {group.types.reduce((sum, entry) => sum + entry.docs.length, 0)})
            </span>
          </div>
          {group.types.map((entry, index) => (
            <div key={entry.type.id} className="tree-node" style={{ paddingLeft: 28 }}>
              <div className="tree-row">
                <span>
                  {index === group.types.length - 1 ? "└── " : "├── "}
                  {entry.type.folderName} ({entry.docs.length})
                </span>
              </div>
              {entry.docs.map((doc, docIndex) => (
                <div key={doc.id} className="tree-node" style={{ paddingLeft: 48 }}>
                  <button className="tree-row" onClick={() => onSelect(doc.id)}>
                    <span className="tree-label">
                      {docIndex === entry.docs.length - 1 ? "└── " : "├── "}
                      {doc.period ?? doc.title} {doc.isCurrent ? "✅ Current" : ""}
                    </span>
                    <span className="tree-loc">
                      {doc.storageKind === "stored" ? "📍 Stored locally in ScannedOnArrival" : `📍 ${doc.locationLabel}`}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function InboxView({
  settings,
  inbox,
  foundEmail,
  documents,
  onSettings,
  onConfirm,
  onFound,
  onAddFound,
  onToast,
}: {
  settings: AppSettings;
  inbox: InboxItem[];
  foundEmail: FoundEmailDoc[];
  documents: DocumentRecord[];
  onSettings: (s: AppSettings) => Promise<void>;
  onConfirm: (item: InboxItem) => Promise<void>;
  onFound: (items: FoundEmailDoc[]) => void;
  onAddFound: (item: FoundEmailDoc) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const pending = inbox.filter((i) => i.status === "pending");

  const simulateSearch = () => {
    onFound([
      { id: "g1", typeId: "council_tax", title: "Council Tax 2026–27", period: "2026–27", mailbox: "gmail", added: false },
      { id: "g2", typeId: "car_insurance", title: "Car Insurance Renewal", mailbox: "gmail", added: false },
      { id: "g3", typeId: "bank_statement", title: "Bank Statement", period: "August 2026", mailbox: "gmail", added: false },
    ]);
    onToast("Found 3 recent documents in the connected mailbox (demo)");
  };

  return (
    <div className="grid">
      <div className="card">
        <h2>Two ways to handle email</h2>
        <p className="meta">
          Important documents arrive through the letterbox or the inbox. Version one never needs mailbox access.
        </p>
        <div className="switch" style={{ marginTop: 14, width: "fit-content" }}>
          <button
            className={settings.privacyMode === "local" ? "active" : ""}
            onClick={() => onSettings({ ...settings, privacyMode: "local" })}
          >
            Private local
          </button>
          <button
            className={settings.privacyMode === "inbox" ? "active" : ""}
            onClick={() => onSettings({ ...settings, privacyMode: "inbox" })}
          >
            Convenience inbox
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Privacy-first MVP</h3>
        <p className="meta">
          Download the PDF from email, then choose Scan with Phone or Add → Upload PDF. ScannedOnArrival reads it locally,
          identifies the type and date, and adds it to your index. The file never reaches a server.
        </p>
      </div>

      {settings.privacyMode === "inbox" ? (
        <div className="card">
          <div className="notice warn">
            Convenience inbox mode means a forwarded PDF can pass through ScannedOnArrival servers. Be explicit with
            people: this is optional, encrypted in transit, and should be deleted after processing.
          </div>
          <h3>Forward to your document inbox</h3>
          <p className="meta">
            {settings.inboxAddress}
            <br />
            Forward a council tax PDF and confirm before it replaces an older copy.
          </p>
          <div className="list" style={{ marginTop: 14 }}>
            {pending.map((item) => {
              const existing = documents.find((d) => d.typeId === item.typeId && d.isCurrent);
              return (
                <div key={item.id} className="card inbox-item">
                  <div>
                    <strong>
                      New {typeById(item.typeId).label} document received
                    </strong>
                    <p className="meta">
                      {item.period ?? item.attachmentName}
                      <br />
                      {existing ? `Replaces your older ${existing.period ?? existing.title} copy` : "No previous copy indexed"}
                    </p>
                  </div>
                  <button className="primary" onClick={() => onConfirm(item)}>
                    Confirm
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card">
          <h3>Inbox forwarding is off</h3>
          <p className="meta">Stay in local mode and add email PDFs with the file picker. Turn on convenience inbox only if you want forwarding.</p>
        </div>
      )}

      <div className="card">
        <h3>Optional Gmail or Outlook</h3>
        <p className="meta">
          The app can search for likely attachments such as “council tax”, “insurance renewal”, or “statement”. You
          choose what to add. This needs careful permissions and is never required.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="secondary"
            onClick={() => onSettings({ ...settings, gmailConnected: !settings.gmailConnected })}
          >
            {settings.gmailConnected ? "Disconnect Gmail" : "Connect Gmail"}
          </button>
          <button
            className="secondary"
            onClick={() => onSettings({ ...settings, outlookConnected: !settings.outlookConnected })}
          >
            {settings.outlookConnected ? "Disconnect Outlook" : "Connect Outlook"}
          </button>
          {(settings.gmailConnected || settings.outlookConnected) && (
            <button className="primary" onClick={simulateSearch}>
              Search recent documents
            </button>
          )}
        </div>
        {foundEmail.length > 0 && (
          <div className="list" style={{ marginTop: 16 }}>
            <h3>We found {foundEmail.length} recent documents</h3>
            {foundEmail.map((item) => (
              <div key={item.id} className="inbox-item">
                <div className="meta">{item.title}{item.period ? ` · ${item.period}` : ""}</div>
                <button className="secondary" disabled={item.added} onClick={() => onAddFound(item)}>
                  {item.added ? "Added" : "Add"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsView({
  settings,
  installPrompt,
  onInstalled,
  onSettings,
  onExport,
  onRestore,
  onReset,
}: {
  settings: AppSettings;
  installPrompt: BeforeInstallPromptEvent | null;
  onInstalled: () => void;
  onSettings: (s: AppSettings) => Promise<void>;
  onExport: () => Promise<void>;
  onRestore: (file: File) => Promise<void>;
  onReset: () => Promise<void>;
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
          PDFs; to photograph paper, open this same site on your phone, or scan the QR on Ready.
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
      <div className="card">
        <h2>Stored here vs referenced here</h2>
        <p className="meta">
          Stored here means the app has a local copy. Referenced here means the file remains in another location;
          the app only keeps its description and where to find it.
        </p>
      </div>
      <div className="card">
        <h3>Inbox address</h3>
        <label className="field">
          <span>Forwarding address</span>
          <input
            value={settings.inboxAddress}
            onChange={(e) => onSettings({ ...settings, inboxAddress: e.target.value })}
          />
        </label>
      </div>
      <div className="card">
        <h2>Reminders</h2>
        <p className="meta">
          When something is outdated or about to expire, Ready lists it. If you allow notifications, this browser
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
        <h2>Backup and restore</h2>
        <p className="meta">
          The index lives in this browser. Download a backup before you change phones or clear site data, then
          restore it here. The file stays on your device.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => void onExport()}>
            Download backup
          </button>
          <label className="secondary" style={{ display: "inline-flex" }}>
            Restore backup
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

function AddDocumentModal({
  documents,
  startAt,
  intendedTypeId,
  incomingFile,
  openaiApiKey,
  onClose,
  onSave,
  onCreateCategory,
  onCreateType,
}: {
  documents: DocumentRecord[];
  startAt: "choose" | "camera";
  intendedTypeId: string | null;
  incomingFile: File | null;
  openaiApiKey: string;
  onClose: () => void;
  onSave: (draft: AddDraft, makeCurrent: boolean) => Promise<void>;
  onCreateCategory: (label: string) => Promise<{ categoryId: string; typeId: string }>;
  onCreateType: (label: string, categoryId: string) => Promise<{ typeId: string; categoryId: string }>;
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
      period: "",
      issuedOn: "",
      expiresOn: "",
      storageKind,
      locationLabel: defaultLocation(method, storageKind),
      locationProvider: storageKind === "stored" ? "local" : "icloud",
    });
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
      if (!preparedText && isPdf(file)) {
        text = await extractPdfText(file);
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
      const pagesToStore = pageFiles?.length ? pageFiles : [file];
      const next = applyClassification({
        method,
        file: pagesToStore[0],
        files: pagesToStore,
        previewUrl: isImage(pagesToStore[0]) ? URL.createObjectURL(pagesToStore[0]) : undefined,
        classified,
        title: classified.title,
        typeId: classified.typeId,
        categoryId: typeById(classified.typeId).categoryId,
        period: classified.period ?? "",
        issuedOn: classified.issuedOn ?? "",
        expiresOn: classified.expiresOn ?? "",
        storageKind,
        locationLabel:
          storageKind === "stored"
            ? "Stored locally in ScannedOnArrival"
            : `${file.name} from Files`,
        locationProvider: storageKind === "stored" ? "local" : providerFromLabel(file.name) === "local" ? "files" : "files",
        fileName: pagesToStore[0].name,
        mimeType: pagesToStore[0].type,
      });
      setDraft(next);
      const canAuto = method !== "camera" && classified.typeId !== "other" && classified.confidence !== "low" && !intendedType;
      if (canAuto) {
        const match = documents.find((d) => d.typeId === next.typeId && d.isCurrent && d.typeId !== "other");
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
    const method: SourceKind = isImage(incomingFile) ? "camera" : "upload";
    void handleFile(incomingFile, method, "stored");
  }, [incomingFile]);

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
    await onSave(draft, makeCurrent);
  };

  const continueFromForm = () => {
    if (!draft) return;
    const match = documents.find((d) => d.typeId === draft.typeId && d.isCurrent && d.typeId !== "other");
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

  return (
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
                <input type="date" value={draft.expiresOn} onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })} />
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
              <button className="primary" onClick={continueFromForm} disabled={!draft.title}>
                Save here
              </button>
            </div>
          </>
        )}

        {step === "replace" && draft && existing && (
          <>
            <h2>Newer {typeById(draft.typeId).label} document detected</h2>
            <p>
              Your previous copy is {existing.period ?? existing.title}. Set this as the current version? The older
              document is not deleted — it moves into Previous versions.
            </p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="secondary" onClick={() => submit(false)}>
                Keep as extra copy
              </button>
              <button className="primary" onClick={() => submit(true)}>
                Set as current version
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
