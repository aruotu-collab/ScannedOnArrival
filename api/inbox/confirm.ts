import {
  deleteReceivedEmail,
  emailMatchesAddress,
  getReceivedEmail,
  inboxApiKey,
  isIssuedInboxAddress,
  jsonResponse,
} from "../_lib.js";

export async function POST(request: Request): Promise<Response> {
  if (!inboxApiKey()) {
    return jsonResponse({ error: "Receive server is not configured." }, 503);
  }
  let payload: { address?: string; emailId?: string } = {};
  try {
    payload = (await request.json()) as { address?: string; emailId?: string };
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }
  const address = payload.address ?? "";
  const emailId = payload.emailId ?? "";
  if (!isIssuedInboxAddress(address) || !emailId) {
    return jsonResponse({ error: "Missing inbox details." }, 400);
  }
  try {
    const email = await getReceivedEmail(emailId);
    if (!email || !emailMatchesAddress(email, address)) {
      return jsonResponse({ error: "That mail is not in this inbox." }, 404);
    }
    const result = await deleteReceivedEmail(emailId);
    return jsonResponse({
      ok: true,
      deleted: result.deleted,
      status: result.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not drop the server copy.";
    return jsonResponse({ error: message }, 502);
  }
}
