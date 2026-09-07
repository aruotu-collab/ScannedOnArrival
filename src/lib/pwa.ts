const SHARE_CACHE = "soa-share";
const SHARE_KEY = "/__shared_file__";

export async function consumeSharedFile(): Promise<File | null> {
  try {
    const cache = await caches.open(SHARE_CACHE);
    const response = await cache.match(SHARE_KEY);
    if (!response) return null;
    await cache.delete(SHARE_KEY);
    const blob = await response.blob();
    const name = decodeURIComponent(response.headers.get("X-Filename") || "shared-document");
    return new File([blob], name, { type: blob.type || "application/octet-stream" });
  } catch {
    return null;
  }
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isDesktopLayout(): boolean {
  return window.matchMedia("(min-width: 861px)").matches;
}
