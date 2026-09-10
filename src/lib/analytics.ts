import { currentSession } from "./auth";

const MEASUREMENT_ID = "G-2FS46KTY94";

type GtagFn = (...args: unknown[]) => void;

function gtag(): GtagFn | undefined {
  return typeof window !== "undefined" ? window.gtag : undefined;
}

export function analyticsId(): string {
  return MEASUREMENT_ID;
}

export function trackPage(path: string, title: string): void {
  const send = gtag();
  if (send) {
    send("event", "page_view", {
      page_path: path,
      page_title: title,
      page_location: `${window.location.origin}${path}`,
    });
  }
  void reportVisit(path, title);
}

async function reportVisit(path: string, title: string): Promise<void> {
  const payload = JSON.stringify({ path, title, referrer: document.referrer || "" });
  const blob = new Blob([payload], { type: "application/json" });
  try {
    const session = await Promise.race([
      currentSession(),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500)),
    ]);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const response = await fetch("/api/admin/visit", {
      method: "POST",
      headers,
      body: payload,
      keepalive: true,
      cache: "no-store",
    });
    if (!response.ok) navigator.sendBeacon?.("/api/admin/visit", blob);
  } catch {
    try {
      navigator.sendBeacon?.("/api/admin/visit", blob);
    } catch {
      /* keep the page usable if logging fails */
    }
  }
}

export function pageTitleForView(view: string): string {
  switch (view) {
    case "tree":
      return "Document tree";
    case "inbox":
      return "Document inbox";
    case "settings":
      return "Settings";
    case "demo":
      return "Demo";
    case "admin":
      return "Admin";
    default:
      return "Scan and Docs";
  }
}
