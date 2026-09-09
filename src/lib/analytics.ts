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
  if (!send) return;
  send("event", "page_view", {
    page_path: path,
    page_title: title,
    page_location: `${window.location.origin}${path}`,
  });
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
    default:
      return "Scan and Docs";
  }
}
