import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AddDraft,
  AppSettings,
  DocumentRecord,
  FoundEmailDoc,
  InboxItem,
  LocationProvider,
  SourceKind,
  ViewId,
} from "./types";
import { CATEGORIES, DOCUMENT_TYPES, suggestedPath, typeById } from "./data/taxonomy";
import { classifyDocument } from "./data/classify";
import { SAMPLE_DOCUMENTS, SAMPLE_INBOX } from "./data/sample";
import { computeStatus, freshnessLabel, locationShort, providerLabel, storageVerb } from "./data/status";
import { extractPdfText, isImage, isPdf } from "./lib/pdf";
import { extractImageText } from "./lib/ocr";
import { consumeSharedFile, isDesktopLayout, isIos, isStandalone } from "./lib/pwa";
import {
  clearAllData,
  deleteDocument,
  loadDocuments,
  loadFileBlob,
  loadInbox,
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
};

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
  const [addOpen, setAddOpen] = useState(false);
  const [addStart, setAddStart] = useState<"choose" | "camera">("choose");
  const [incomingFile, setIncomingFile] = useState<File | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
        if (storedSettings) setSettings(storedSettings);
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
    setSettings(next);
    await saveSettings(next);
  };

  const persistDocs = async (next: DocumentRecord[]) => {
    setDocuments(next);
    await saveDocuments(next);
  };

  const persistInbox = async (next: InboxItem[]) => {
    setInbox(next);
    await saveInbox(next);
  };

  const selected = documents.find((d) => d.id === selectedId) ?? null;
  const currentDocs = documents.filter((d) => d.isCurrent);

  const startEmpty = async () => {
    await persistSettings({ ...settings, onboardingComplete: true, showDemoHousehold: false });
  };

  const startDemo = async () => {
    await persistDocs(SAMPLE_DOCUMENTS);
    await persistInbox(SAMPLE_INBOX);
    await persistSettings({ ...settings, onboardingComplete: true, showDemoHousehold: true });
  };

  const addDocument = async (draft: AddDraft, makeCurrent: boolean) => {
    const id = uid();
    const sameType = documents.filter((d) => d.typeId === draft.typeId);
    const nextDocs = documents.map((d) =>
      makeCurrent && d.typeId === draft.typeId && d.isCurrent
        ? { ...d, isCurrent: false, supersededBy: id }
        : d,
    );
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
      isCurrent: makeCurrent || sameType.every((d) => !d.isCurrent),
    };
    const saved = [record, ...nextDocs];
    await persistDocs(saved);
    if (draft.file && draft.storageKind === "stored") {
      await saveFileBlob({ id, documentId: id, blob: draft.file });
    }
    setAddOpen(false);
    setIncomingFile(null);
    setAddStart("choose");
    setSelectedId(id);
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="wordmark">
          <ProductBadge tone="dark" />
          <strong>ScannedOnArrival</strong>
          <span>What you have, how current it is, and where it lives.</span>
        </div>
        <nav className="nav">
          {(
            [
              ["ready", "Ready"],
              ["documents", "Documents"],
              ["tree", "Tree"],
              ["inbox", "Inbox"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
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
            <h1>
              {view === "ready" && "Ready"}
              {view === "documents" && "Documents"}
              {view === "tree" && "Document tree"}
              {view === "inbox" && "Document inbox"}
              {view === "settings" && "Settings"}
            </h1>
            <p>
              {view === "ready" && "What’s current, missing, or overdue — organised by document type, not files."}
              {view === "documents" && "A simple list of everything in your index, stored or referenced."}
              {view === "tree" && "A filing-cabinet view. The folders are logical; the files can live anywhere."}
              {view === "inbox" && "Letterbox or inbox: both are ways documents arrive. Email stays optional."}
              {view === "settings" && "Keep the privacy story clear. Local by default, convenience only if you choose it."}
            </p>
          </div>
          <button
            className="primary"
            onClick={() => {
              setIncomingFile(null);
              setAddStart("choose");
              setAddOpen(true);
            }}
          >
            Scan or add
          </button>
        </header>

        <div className="content">
          <InstallBanner
            prompt={installPrompt}
            onInstalled={() => setInstallPrompt(null)}
          />
          {view === "ready" && (
            <ReadyView
              documents={documents}
              onOpen={(id) => {
                setSelectedId(id);
                setView("documents");
              }}
              onAdd={() => {
                setIncomingFile(null);
                setAddStart("choose");
                setAddOpen(true);
              }}
            />
          )}
          {view === "documents" && (
            <DocumentsView
              documents={currentDocs}
              selected={selected}
              allDocuments={documents}
              onSelect={setSelectedId}
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
                setSelectedId(id);
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
        {(["ready", "documents", "tree", "inbox", "settings"] as ViewId[]).map((id) => (
          <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
            {id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </nav>

      {addOpen && (
        <AddDocumentModal
          documents={documents}
          startAt={addStart}
          incomingFile={incomingFile}
          onClose={() => {
            setAddOpen(false);
            setIncomingFile(null);
            setAddStart("choose");
          }}
          onSave={addDocument}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ReadyView({
  documents,
  onOpen,
  onAdd,
}: {
  documents: DocumentRecord[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const current = documents.filter((d) => d.isCurrent);
  const rows = DOCUMENT_TYPES.filter((t) => t.id !== "other").map((type) => {
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
        <strong>A phone scanner in your browser.</strong>
        <span>
          Open this site in Safari or Chrome — not an App Store app. Scan means pointing your phone at the paper,
          in this tab. On a computer, upload a PDF or scan the code below with your phone.
        </span>
      </div>
      <PhoneHandoff />
      <div className="summary-strip">
        <div className="stat">
          <b>{ready}</b>
          Current
        </div>
        <div className="stat">
          <b>{outdated}</b>
          Needs attention
        </div>
        <div className="stat">
          <b>{missing}</b>
          Missing
        </div>
      </div>
      <div className="grid ready-grid">
        {rows.map(({ type, doc, status }) => (
          <button key={type.id} className="card" onClick={() => (doc ? onOpen(doc.id) : onAdd())}>
            <div className="kicker">{CATEGORIES.find((c) => c.id === type.categoryId)?.label}</div>
            <h3>{type.label}</h3>
            {doc ? (
              <>
                <p className="meta">
                  {doc.title}
                  <br />
                  {freshnessLabel(doc)} · {locationShort(doc)}
                </p>
                <span className={`badge ${status}`}>
                  {status === "current" ? "Current" : status === "expiring" ? "Expiring" : "Outdated"}
                </span>
              </>
            ) : (
              <>
                <p className="meta">No copy in your index yet. Scan with your phone, upload a PDF, or reference where it already lives.</p>
                <span className="badge missing">Missing</span>
              </>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

function DocumentsView({
  documents,
  allDocuments,
  selected,
  onSelect,
  onDeleted,
}: {
  documents: DocumentRecord[];
  allDocuments: DocumentRecord[];
  selected: DocumentRecord | null;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  if (!documents.length) {
    return (
      <div className="card empty">
        <h2>Nothing indexed yet</h2>
        <p>
          Scan a letter with your phone in this browser, upload a PDF, or reference a file you already keep in
          iCloud, Drive or Downloads.
        </p>
      </div>
    );
  }

  return (
    <div className="detail">
      <div className="grid docs-grid">
        {documents.map((doc) => {
          const status = computeStatus(doc);
          return (
            <button
              key={doc.id}
              className="card"
              onClick={() => onSelect(doc.id)}
              style={selected?.id === doc.id ? { outline: "2px solid var(--forest)" } : undefined}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="kicker">{typeById(doc.typeId).label}</span>
                <span className={`badge ${doc.storageKind}`}>{storageVerb(doc)}</span>
              </div>
              <h3>{doc.title}</h3>
              <p className="meta">
                {freshnessLabel(doc)} · {locationShort(doc)}
                <br />
                {doc.locationLabel}
              </p>
              <span className={`badge ${status}`}>{status === "current" ? "Current" : status}</span>
            </button>
          );
        })}
      </div>
      {selected && (
        <DocumentDetail
          doc={selected}
          previous={allDocuments.filter((d) => d.typeId === selected.typeId && !d.isCurrent)}
          onDeleted={() => onDeleted(selected.id)}
        />
      )}
    </div>
  );
}

function DocumentDetail({
  doc,
  previous,
  onDeleted,
}: {
  doc: DocumentRecord;
  previous: DocumentRecord[];
  onDeleted: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    (async () => {
      if (doc.storageKind !== "stored") return;
      const blob = await loadFileBlob(doc.id);
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.id, doc.storageKind]);

  return (
    <aside className="card">
      <p className="kicker">Latest document</p>
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
      {previewUrl && (
        <div className="preview" style={{ marginBottom: 12 }}>
          {doc.mimeType?.startsWith("image/") ? (
            <img src={previewUrl} alt={doc.title} />
          ) : (
            <iframe title={doc.title} src={previewUrl} />
          )}
        </div>
      )}
      {doc.storageKind === "referenced" && (
        <div className="notice">
          The file stays where you already keep it. ScannedOnArrival only remembers the description and location.
        </div>
      )}
      <p className="meta">Last checked {doc.lastChecked}</p>
      {previous.length > 0 && (
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
    return CATEGORIES.map((category) => {
      const types = DOCUMENT_TYPES.filter((t) => t.categoryId === category.id);
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
            <span>├── {group.category.label}</span>
          </div>
          {group.types.map((entry, index) => (
            <div key={entry.type.id} className="tree-node" style={{ paddingLeft: 28 }}>
              <div className="tree-row">
                <span>
                  {index === group.types.length - 1 ? "└── " : "├── "}
                  {entry.type.folderName}
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
          Download the PDF from email, then choose Scan or add → Upload PDF. ScannedOnArrival reads it locally,
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
  onReset,
}: {
  settings: AppSettings;
  installPrompt: BeforeInstallPromptEvent | null;
  onInstalled: () => void;
  onSettings: (s: AppSettings) => Promise<void>;
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
  incomingFile,
  onClose,
  onSave,
}: {
  documents: DocumentRecord[];
  startAt: "choose" | "camera";
  incomingFile: File | null;
  onClose: () => void;
  onSave: (draft: AddDraft, makeCurrent: boolean) => Promise<void>;
}) {
  const [step, setStep] = useState<"choose" | "camera" | "form" | "replace">(incomingFile ? "choose" : startAt);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Reading the document locally…");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AddDraft | null>(null);
  const [existing, setExisting] = useState<DocumentRecord | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ingested = useRef(false);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (step !== "camera") return;
    let cancelled = false;
    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        setStream(media);
      } catch {
        if (!cancelled) setError("Camera permission was declined. You can still upload a photo instead.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  const beginMethod = (method: SourceKind) => {
    const storageKind = method === "reference" ? "referenced" : "stored";
    setDraft({
      method,
      title: "",
      typeId: "other",
      categoryId: "other",
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

  const handleFile = async (file: File, method: SourceKind, storageKind: AddDraft["storageKind"]) => {
    setBusy(true);
    setBusyLabel(isImage(file) ? "Reading the page with on-device OCR…" : "Reading the document locally…");
    setError(null);
    try {
      let text = "";
      if (isPdf(file)) {
        text = await extractPdfText(file);
      } else if (isImage(file)) {
        try {
          text = await extractImageText(file);
        } catch {
          text = "";
        }
      }
      const classified = classifyDocument({ text, fileName: file.name });
      const next = applyClassification({
        method,
        file,
        previewUrl: isImage(file) ? URL.createObjectURL(file) : undefined,
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
        fileName: file.name,
        mimeType: file.type,
      });
      setDraft(next);
      setStep("form");
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

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;
    const file = new File([blob], `scan-${todayIso()}.jpg`, { type: "image/jpeg" });
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    await handleFile(file, "camera", "stored");
  };

  const startCamera = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      setStream(media);
    } catch {
      setError("Camera permission was declined. You can still upload a photo instead.");
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

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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

        {step === "camera" && (
          <>
            <h2>Scan with your phone</h2>
            <p className="meta">
              Allow camera access in this browser tab, then hold the paper in view. On a computer this may use a
              webcam — for a letter, open this same page on your phone instead.
            </p>
            <div className="camera-wrap">
              <video ref={videoRef} id="soa-camera" autoPlay playsInline muted />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="secondary" onClick={startCamera}>
                Allow camera
              </button>
              <button className="primary" onClick={capturePhoto}>
                Capture
              </button>
              <label className="secondary" style={{ display: "inline-flex" }}>
                Use the phone camera roll
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file, "camera", "stored");
                  }}
                />
              </label>
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
              <span>Document type</span>
              <select
                value={draft.typeId}
                onChange={(e) => {
                  const type = typeById(e.target.value as AddDraft["typeId"]);
                  setDraft({
                    ...draft,
                    typeId: type.id,
                    categoryId: type.categoryId,
                    title: draft.period ? `${type.label} ${draft.period}` : type.label,
                  });
                }}
              >
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
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

        {busy && <p className="meta">{busyLabel}</p>}
        {error && <div className="notice warn">{error}</div>}
      </div>
    </div>
  );
}
