import type { ViewId } from "../types";

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

export function pathForView(view: ViewId): string {
  switch (view) {
    case "tree":
      return "/tree";
    case "inbox":
      return "/inbox";
    case "settings":
      return "/settings";
    case "demo":
      return "/demo";
    default:
      return "/";
  }
}

export function viewFromPath(pathname: string): ViewId {
  switch (normalizePath(pathname)) {
    case "/tree":
      return "tree";
    case "/inbox":
      return "inbox";
    case "/settings":
      return "settings";
    case "/demo":
      return "demo";
    default:
      return "documents";
  }
}

export function isAppPath(pathname: string): boolean {
  return ["/tree", "/inbox", "/settings", "/demo", "/"].includes(normalizePath(pathname));
}

export function hrefForView(view: ViewId, current = window.location.href): string {
  const url = new URL(current);
  url.pathname = pathForView(view);
  url.search = "";
  return `${url.pathname}${url.hash}`;
}

export function writeViewUrl(view: ViewId, mode: "push" | "replace"): void {
  const href = hrefForView(view);
  const next = new URL(href, window.location.origin);
  const same =
    window.location.pathname === next.pathname &&
    window.location.search === next.search;
  if (same && mode === "push") return;
  window.history[mode === "replace" ? "replaceState" : "pushState"]({ view }, "", href);
}
