import { currentSession } from "./auth";

export async function sendContactMessage(input: {
  email: string;
  name: string;
  message: string;
}): Promise<void> {
  const session = await currentSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch("/api/contact", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, website: "" }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Could not send that message.");
}
