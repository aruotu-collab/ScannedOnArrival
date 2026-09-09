import { copyText } from "./inbox";
import { getSupabase } from "./auth";

export type HouseholdRole = "solo" | "owner" | "member";

export type HouseholdMember = {
  userId: string;
  email: string;
  role: "owner" | "member";
};

export type HouseholdInvite = {
  code: string;
  expiresAt: string;
};

export type HouseholdState = {
  householdId: string;
  role: HouseholdRole;
  members: HouseholdMember[];
  invite: HouseholdInvite | null;
};

function rpcError(error: { message?: string } | null): Error {
  const message = error?.message?.replace(/^.*error: /i, "").trim() || "Could not update the household.";
  return new Error(message);
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}/?invite=${encodeURIComponent(code.trim().toUpperCase())}`;
}

export function pendingInviteCode(): string {
  const fromUrl = new URL(window.location.href).searchParams.get("invite")?.trim() ?? "";
  if (fromUrl) {
    sessionStorage.setItem("soa-invite", fromUrl.toUpperCase());
    return fromUrl.toUpperCase();
  }
  return (sessionStorage.getItem("soa-invite") ?? "").trim().toUpperCase();
}

export function clearPendingInvite(): void {
  sessionStorage.removeItem("soa-invite");
  const url = new URL(window.location.href);
  if (!url.searchParams.has("invite")) return;
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

export async function loadHousehold(): Promise<HouseholdState | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("household_snapshot");
  if (error) throw rpcError(error);
  if (!data) return null;
  const row = data as {
    householdId?: string;
    role?: HouseholdRole;
    members?: Array<{ userId?: string; email?: string; role?: string }>;
    invite?: { code?: string; expiresAt?: string } | null;
  };
  return {
    householdId: row.householdId ?? "",
    role: row.role === "owner" || row.role === "member" ? row.role : "solo",
    members: Array.isArray(row.members)
      ? row.members.map((member) => ({
          userId: member.userId ?? "",
          email: member.email ?? "",
          role: member.role === "owner" ? "owner" : "member",
        }))
      : [],
    invite: row.invite?.code
      ? { code: String(row.invite.code).toUpperCase(), expiresAt: String(row.invite.expiresAt ?? "") }
      : null,
  };
}

export async function createHouseholdInvite(): Promise<HouseholdInvite> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sign in first.");
  const { data, error } = await supabase.rpc("create_household_invite");
  if (error) throw rpcError(error);
  const row = data as { code?: string; expiresAt?: string } | null;
  if (!row?.code) throw new Error("Could not make an invite code.");
  return { code: String(row.code).toUpperCase(), expiresAt: String(row.expiresAt ?? "") };
}

export async function acceptHouseholdInvite(code: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sign in first.");
  const { error } = await supabase.rpc("accept_household_invite", { invite_code: code.trim().toUpperCase() });
  if (error) throw rpcError(error);
  clearPendingInvite();
}

export async function leaveHousehold(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sign in first.");
  const { error } = await supabase.rpc("leave_household");
  if (error) throw rpcError(error);
}

export async function removeHouseholdMember(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sign in first.");
  const { error } = await supabase.rpc("remove_household_member", { member_id: userId });
  if (error) throw rpcError(error);
}

export async function shareHouseholdInvite(code: string): Promise<"shared" | "copied"> {
  const url = inviteUrl(code);
  const text = `Join my ScannedOnArrival household with code ${code}. Sign in, then type that code. ${url}`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "ScannedOnArrival household", text, url });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
    }
  }
  const copied = await copyText(`${code}\n${url}`);
  if (!copied) throw new Error("Could not copy the invite.");
  return "copied";
}
