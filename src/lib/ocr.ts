export async function extractImageText(file: File): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return (data.text ?? "").trim();
  } finally {
    await worker.terminate();
  }
}
