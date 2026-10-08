
import { GoogleGenAI, Type } from "@google/genai";

// Direct-client Gemini path — HIDDEN CEO-testing fallback only.
// Production scans go through scanReceiptViaWorker (server-side key).
// A key pasted on-device in the past (localStorage 'gemini_api_key') still
// works here; there is intentionally NO UI to add one anymore.
const RUNTIME_KEY_STORAGE = 'gemini_api_key';

/** A real Gemini key is ~39 chars; anything short or placeholder-like is unusable. */
const isUsableKey = (k: string | null | undefined): boolean => {
  const t = (k || "").trim();
  if (t.length < 20 || t === "undefined") return false;
  const up = t.toUpperCase();
  return !up.includes("PLACEHOLDER") && !up.includes("REDACTED") && !up.includes("YOUR_KEY") && !up.includes("YOUR_API");
};

export const hasApiKey = (): boolean => {
  try {
    if (isUsableKey(localStorage.getItem(RUNTIME_KEY_STORAGE))) return true;
  } catch { /* storage unavailable */ }
  return isUsableKey(process.env.API_KEY);
};

export const setRuntimeApiKey = (key: string): void => {
  try { localStorage.setItem(RUNTIME_KEY_STORAGE, key.trim()); } catch { /* ignore */ }
};

export const clearRuntimeApiKey = (): void => {
  try { localStorage.removeItem(RUNTIME_KEY_STORAGE); } catch { /* ignore */ }
};

// Lazily create the client so a missing key produces a clear error at scan time
// instead of crashing the app on load.
const getClient = () => {
  let key = "";
  try { key = localStorage.getItem(RUNTIME_KEY_STORAGE)?.trim() || ""; } catch { /* ignore */ }
  if (!isUsableKey(key)) key = process.env.API_KEY || "";
  if (!isUsableKey(key)) {
    throw new Error("MISSING_GEMINI_API_KEY: Add your Gemini API key in the Scan tab (or set GEMINI_API_KEY in .env.local and rebuild).");
  }
  return new GoogleGenAI({ apiKey: key });
};

export interface ExtractedReceipt {
  warehouseName: string;
  zipCode: string;
  purchaseDate: string;
  total: number;
  items: {
    itemNumber: string;
    name: string;
    price: number;
    category: string;
  }[];
}

export const scanReceipt = async (base64Image: string): Promise<ExtractedReceipt> => {  const ai = getClient();
  // Fix: Use the correct object-based structure for contents and parts when calling generateContent.
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        { text: "Analyze this Costco receipt and extract the details. Categorize each item into common grocery/household categories. Return strictly JSON." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          warehouseName: { type: Type.STRING },
          zipCode: { type: Type.STRING },
          purchaseDate: { type: Type.STRING, description: "ISO format date" },
          total: { type: Type.NUMBER },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                itemNumber: { type: Type.STRING },
                name: { type: Type.STRING },
                price: { type: Type.NUMBER },
                category: { type: Type.STRING }
              },
              required: ["itemNumber", "name", "price", "category"]
            }
          }
        },
        required: ["warehouseName", "zipCode", "purchaseDate", "total", "items"]
      }
    }
  });

  // Fix: The text property directly returns the generated string. Do not use text() as a method.
  const jsonStr = response.text || '{}';
  return JSON.parse(jsonStr);
};

// ---------------------------------------------------------------------------
// Server-side receipt proxy (Cloudflare Worker).
// The Gemini API key lives ONLY on the worker (GEMINI_API_KEY secret).
// End users NEVER need a key — this is the production path.
//
// *** DEPLOY NOTE: Pages Function (same-origin). functions/parse-receipt.ts
// is deployed with the Pages project, so the API lives at /parse-receipt
// on whatever domain serves the app. Empty string = relative fetch. ***
// ---------------------------------------------------------------------------
export const RECEIPT_WORKER_URL = "";

/** Call the worker proxy. Throws WORKER_* on any failure (never key errors). */
export const scanReceiptViaWorker = async (base64Image: string): Promise<ExtractedReceipt> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(`${RECEIPT_WORKER_URL}/parse-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64Image, mimeType: "image/jpeg" }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`WORKER_HTTP_${resp.status}`);
    const data = await resp.json();
    if (!data || typeof data !== "object" || !Array.isArray((data as any).items)) {
      throw new Error("WORKER_BAD_RESPONSE");
    }
    return data as ExtractedReceipt;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("WORKER_")) throw e;
    throw new Error("WORKER_UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }
};
