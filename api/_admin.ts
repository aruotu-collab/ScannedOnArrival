import { userFromBearer, serviceSupabase } from "./_stripe.js";
import { jsonResponse } from "./_lib.js";

export const ADMIN_EMAIL = "aruotu@gmail.com";

const ALLOWED_PATHS = new Set(["/", "/tree", "/inbox", "/settings", "/demo", "/admin"]);

export function isAdminEmail(email: string): boolean {
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}

export async function requireAdmin(request: Request): Promise<{ id: string; email: string } | null> {
  const user = await userFromBearer(request);
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  return (
    first ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export function clientCountry(request: Request): string | null {
  const country = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase() || "";
  return country || null;
}

export function cleanPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const path = value.split("?")[0].split("#")[0].trim() || "/";
  return ALLOWED_PATHS.has(path) ? path : "/";
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text || null;
}

export function cleanReferrer(value: unknown): string | null {
  const text = cleanText(value, 400);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (/scannedonarrival\.com$/i.test(url.hostname)) return null;
    return `${url.origin}${url.pathname}`.slice(0, 400);
  } catch {
    return null;
  }
}

export { jsonResponse };
