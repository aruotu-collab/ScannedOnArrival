import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { isAppPath, pathForView, viewFromPath } from "./routes";

export function supabaseUrl(): string {
  return (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
}

export function supabaseAnonKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
}

export function authAvailable(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!authAvailable()) return null;
  if (!client) {
    client = createClient(supabaseUrl(), supabaseAnonKey(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return client;
}

export function authRedirectTo(): string {
  const path = isAppPath(window.location.pathname) ? pathForView(viewFromPath(window.location.pathname)) : "/";
  const invite = new URL(window.location.href).searchParams.get("invite")?.trim();
  const suffix = invite ? `?invite=${encodeURIComponent(invite)}` : "";
  return `${window.location.origin}${path}${suffix}`;
}

export async function sendMagicLink(email: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sign-in is not set up on this site yet.");
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: authRedirectTo(),
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sign-in is not set up on this site yet.");
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw error;
}

export async function signOutUser(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function currentSession(): Promise<Session | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

export function userEmail(user: User | null): string {
  return user?.email?.trim() || "";
}

export function helloNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? "";
  const token = local.split(/[._+\-]/)[0] ?? "";
  if (!token) return "";
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

export function stripAuthParamsFromUrl(): void {
  const url = new URL(window.location.href);
  const keys = ["code", "state", "error", "error_code", "error_description", "type", "token"];
  let changed = false;
  for (const key of keys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (url.hash.includes("access_token") || url.hash.includes("error")) {
    url.hash = "";
    changed = true;
  }
  if (changed) window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}
