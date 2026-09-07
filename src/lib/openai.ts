import type { ClassifiedResult, DocumentTypeId } from "../types";
import { DOCUMENT_TYPES, typeById } from "../data/taxonomy";
import { classifyDocument } from "../data/classify";

const TYPE_IDS = DOCUMENT_TYPES.map((type) => type.id).join(", ");

async function fileToDataUrl(file: File): Promise<string> {
  const image = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the scan for identification.");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

function asTypeId(value: unknown): DocumentTypeId {
  const id = String(value ?? "");
  return DOCUMENT_TYPES.some((type) => type.id === id) ? (id as DocumentTypeId) : "other";
}

export async function identifyDocumentWithOpenAI(input: {
  apiKey: string;
  file: File;
  ocrText?: string;
}): Promise<ClassifiedResult> {
  const image = await fileToDataUrl(input.file);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You identify UK household documents from a scan. Reply with JSON only: ` +
            `{"typeId":"...","title":"...","period":"","issuedOn":"","expiresOn":"","confidence":"high|medium|low"}. ` +
            `typeId must be one of: ${TYPE_IDS}. title should name the actual document, e.g. "Aviva Car Insurance 2026" or "Council Tax 2026–27". ` +
            `Dates must be YYYY-MM-DD or empty.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Identify this document and give it a clear title. OCR text if any:\n${(input.ocrText ?? "").slice(0, 4000)}`,
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error("OpenAI could not identify that document. Check the API key.");
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}") as {
    typeId?: string;
    title?: string;
    period?: string;
    issuedOn?: string;
    expiresOn?: string;
    confidence?: ClassifiedResult["confidence"];
  };
  const typeId = asTypeId(parsed.typeId);
  const type = typeById(typeId);
  const title = (parsed.title || "").trim() || (parsed.period ? `${type.label} ${parsed.period}` : type.label);
  return {
    typeId,
    title,
    period: parsed.period || undefined,
    issuedOn: parsed.issuedOn || undefined,
    expiresOn: parsed.expiresOn || undefined,
    confidence: parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "medium",
  };
}

export async function classifySmart(input: {
  file: File;
  fileName?: string;
  text?: string;
  apiKey?: string;
}): Promise<ClassifiedResult> {
  if (input.apiKey) {
    try {
      return await identifyDocumentWithOpenAI({
        apiKey: input.apiKey,
        file: input.file,
        ocrText: input.text,
      });
    } catch {
      /* fall back to local keywords */
    }
  }
  return classifyDocument({ text: input.text, fileName: input.fileName ?? input.file.name });
}
