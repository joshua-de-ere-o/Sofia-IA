/**
 * ocr.ts — Gemini Vision OCR helper for extracting payment amounts from receipts.
 *
 * Standalone, single-purpose module. Does NOT use model-adapter.ts (which is
 * for multi-provider conversational chat). This is a one-shot vision call.
 *
 * Usage:
 *   import { extractAmountFromReceipt } from "./ocr.ts";
 *   const result = await extractAmountFromReceipt(publicUrl);
 *
 * Returns OcrResult: { monto: number | null, es_comprobante: boolean, raw: string }
 *
 * fileData vs inlineData note:
 *   This implementation uses fileData.fileUri (public URL) first — supported by
 *   gemini-2.0-flash for public HTTP(S) images. If Gemini rejects external URLs
 *   at runtime (HTTP 4xx on the first attempt with fileData), SWITCH to inlineData:
 *   fetch the image bytes, base64-encode, and embed as:
 *     { inlineData: { mimeType: "image/jpeg", data: <base64> } }
 *   The fallback path is documented here but NOT auto-attempted (avoid double
 *   fetches in the normal case). Monitor ocr_fail logs for "http_4" patterns.
 *
 * ACTIVE PATH: fileData (public URL). If you switch to inlineData, update this comment.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Model resolution order:
 *   1. GEMINI_OCR_MODEL — explicit OCR-only override (lets us pin a vision-
 *      strong model independently from the chat model).
 *   2. GEMINI_MODEL — the chat model, reused if no OCR-specific override.
 *   3. Hardcoded fallback "gemini-2.5-flash" — a model that exists today.
 *
 * Reason this matters: production has historically been pinned to
 * `gemini-2.0-flash` which was deprecated by Google. The endpoint returned
 * HTTP 404 silently and payment-flow.ts routed every receipt to M3
 * (OCR-failed) regardless of image quality. Discovered 2026-05-26 during
 * end-to-end smoke test.
 */
function getGeminiOcrModel(): string {
  return (
    Deno.env.get("GEMINI_OCR_MODEL") ||
    Deno.env.get("GEMINI_MODEL") ||
    "gemini-2.5-flash"
  );
}

const OCR_TIMEOUT_MS = 8_000;

// Prompt in Spanish — receipts in Ecuador are Spanish; language match reduces
// hallucination on numeric formats specific to the Ecuadorian banking UI.
const PROMPT_OCR = `\
Eres un extractor de montos de comprobantes de pago (transferencias bancarias en Ecuador, USD).
Tu única tarea es leer la imagen y devolver el monto total pagado.

Reglas estrictas:
- Responde con UN SOLO JSON, sin texto fuera del JSON, sin markdown:
  {"monto": <number>, "es_comprobante": <boolean>}
- "monto" es el VALOR principal de la transacción en USD (number, dos decimales).
  Si hay varios números, devuelve el del campo etiquetado "Monto", "Total", "Valor" o "Valor enviado".
- Si la imagen NO es un comprobante de pago/transferencia (selfie, meme, foto de comida,
  captura de chat, etc.), devuelve:
  {"monto": null, "es_comprobante": false}
- Si es un comprobante pero no logras leer el monto con confianza (>=90%), devuelve:
  {"monto": null, "es_comprobante": true}
- NO inventes. NO uses montos del logo, del número de cuenta, ni de la fecha.
  SOLO el monto principal de la transacción.

Devuelve únicamente el JSON.`;

export interface OcrResult {
  monto: number | null;
  es_comprobante: boolean;
  raw: string;
}

/**
 * Parse a JSON object from a Gemini response string, tolerating ```json fences.
 * Same pattern as extractJson() in app/api/telegram/route.js.
 */
function parseLooseJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extract the payment amount from a receipt image using Gemini Vision.
 *
 * @param imageUrl Public HTTPS URL of the receipt image (Supabase Storage public bucket).
 * @returns OcrResult with monto (normalized float or null), es_comprobante flag, and raw text.
 */
export async function extractAmountFromReceipt(imageUrl: string): Promise<OcrResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[OCR] GEMINI_API_KEY not set — OCR unavailable, treating as failure");
    return { monto: null, es_comprobante: true, raw: "no_api_key" };
  }

  const model = getGeminiOcrModel();
  const endpoint = `${GEMINI_API_BASE}/${model}:generateContent`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OCR_TIMEOUT_MS);

  try {
    const res = await fetch(`${endpoint}?key=${apiKey}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: PROMPT_OCR },
              // fileData (public URL) — active path.
              // Fallback: inlineData with base64 if Gemini rejects external URLs.
              { fileData: { fileUri: imageUrl, mimeType: "image/jpeg" } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 100,
          // Disable thinking budget for speed/cost (gemini-2.0-flash supports this)
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) {
      const raw = `http_${res.status}`;
      console.error(`[OCR] Gemini HTTP error: ${res.status} (model=${model})`);
      return { monto: null, es_comprobante: true, raw };
    }

    const data = await res.json();
    const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const parsed = parseLooseJson(rawText);
    if (!parsed) {
      console.error("[OCR] Failed to parse Gemini response:", rawText.slice(0, 200));
      return { monto: null, es_comprobante: true, raw: rawText.slice(0, 200) };
    }

    const esComprobante = parsed.es_comprobante !== false;
    const montoRaw = parsed.monto;

    // Normalize the monto from Gemini: it should already be a number per the prompt,
    // but guard against string responses just in case.
    let monto: number | null = null;
    if (typeof montoRaw === "number" && isFinite(montoRaw) && montoRaw >= 0) {
      monto = Math.round(montoRaw * 100) / 100;
    } else if (typeof montoRaw === "string" && montoRaw !== "null") {
      const parsed_num = parseFloat(montoRaw);
      if (!isNaN(parsed_num) && isFinite(parsed_num) && parsed_num >= 0) {
        monto = Math.round(parsed_num * 100) / 100;
      }
    }

    return { monto, es_comprobante: esComprobante, raw: rawText };
  } catch (e) {
    const msg = (e instanceof Error) ? e.message : String(e);
    const isTimeout = msg.includes("aborted") || msg.includes("AbortError");
    console.error(`[OCR] ${isTimeout ? "Timeout (8s)" : "Error"}: ${msg}`);
    return {
      monto: null,
      es_comprobante: true,
      raw: isTimeout ? "timeout" : `err_${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
