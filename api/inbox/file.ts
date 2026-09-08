import {
  emailMatchesAddress,
  getAttachment,
  getReceivedEmail,
  inboxApiKey,
  inferAttachmentContentType,
  isIssuedInboxAddress,
  jsonResponse,
  pdfHeaderOffset,
} from "../_lib.js";

export async function GET(request: Request): Promise<Response> {
  if (!inboxApiKey()) {
    return jsonResponse({ error: "Receive server is not configured." }, 503);
  }
  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";
  const emailId = url.searchParams.get("emailId") ?? "";
  const attachmentId = url.searchParams.get("attachmentId") ?? "";
  if (!isIssuedInboxAddress(address) || !emailId || !attachmentId) {
    return jsonResponse({ error: "Missing inbox details." }, 400);
  }
  try {
    const email = await getReceivedEmail(emailId);
    if (!email || !emailMatchesAddress(email, address)) {
      return jsonResponse({ error: "That mail is not in this inbox." }, 404);
    }
    const attachment = await getAttachment(emailId, attachmentId);
    if (!attachment?.download_url) {
      return jsonResponse({ error: "That attachment is no longer available." }, 404);
    }
    const fileRes = await fetch(attachment.download_url);
    if (!fileRes.ok) {
      return jsonResponse({ error: "Could not download the PDF." }, 502);
    }
    const buffer = await fileRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const pdfAt = pdfHeaderOffset(bytes);
    const body = pdfAt > 0 ? bytes.subarray(pdfAt) : bytes;
    const filename = attachment.filename || (pdfAt >= 0 ? "document.pdf" : "document");
    const contentType = inferAttachmentContentType(body, filename, attachment.content_type);
    const safeName = (contentType === "application/pdf" && !filename.toLowerCase().endsWith(".pdf")
      ? `${filename.replace(/\.[^.]+$/, "") || "document"}.pdf`
      : filename
    ).replace(/"/g, "");
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not download the file.";
    return jsonResponse({ error: message }, 502);
  }
}
