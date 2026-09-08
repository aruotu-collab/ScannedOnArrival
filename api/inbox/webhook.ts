import { createHmac, timingSafeEqual } from "node:crypto";
import { jsonResponse } from "../_lib.js";

function verifySvix(payload: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;
  const secretPart = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(secretPart, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  const candidates = signatureHeader.split(" ").map((part) => part.replace(/^v1,/, "").trim()).filter(Boolean);
  const expectedBuf = Buffer.from(expected);
  return candidates.some((candidate) => {
    const got = Buffer.from(candidate);
    return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf);
  });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const payload = await request.text();
  if (secret && !verifySvix(payload, request.headers, secret)) {
    return jsonResponse({ error: "Invalid webhook signature." }, 400);
  }
  return jsonResponse({ ok: true });
}
