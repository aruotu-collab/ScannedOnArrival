import {
  emailMatchesAddress,
  inboxApiKey,
  isDocumentAttachment,
  isIssuedInboxAddress,
  jsonResponse,
  listReceivedEmails,
} from "../_lib.js";

export async function GET(request: Request): Promise<Response> {
  if (!inboxApiKey()) {
    return jsonResponse({ ready: false, items: [] });
  }
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!isIssuedInboxAddress(address)) {
    return jsonResponse({ ready: false, error: "Unknown inbox address." }, 400);
  }
  try {
    const emails = await listReceivedEmails();
    const items = emails
      .filter((email) => emailMatchesAddress(email, address))
      .flatMap((email) => {
        const attachments = (email.attachments ?? []).filter(isDocumentAttachment);
        return attachments.map((attachment) => ({
          id: `${email.id}:${attachment.id}`,
          emailId: email.id,
          attachmentId: attachment.id,
          from: email.from ?? "",
          subject: email.subject ?? "",
          receivedAt: email.created_at,
          attachmentName: attachment.filename || "document.pdf",
          contentType: attachment.content_type || "application/octet-stream",
        }));
      });
    return jsonResponse({ ready: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the inbox.";
    return jsonResponse({ ready: false, error: message, items: [] }, 502);
  }
}
