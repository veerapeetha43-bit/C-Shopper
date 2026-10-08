/**
 * C-Shopper receipt-parsing API — Cloudflare Pages Function.
 * Served same-origin at /parse-receipt (no CORS needed).
 *
 * POST /parse-receipt  { image: base64, mimeType } -> parsed receipt JSON
 *
 * The Gemini API key lives ONLY here as the GEMINI_API_KEY Pages secret
 * (dashboard: Pages -> c-shopper -> Settings -> Environment variables).
 * It is never sent to clients, never logged, and never echoed in errors.
 * Dependency-free: plain fetch, no npm packages.
 */

interface PagesEnv {
  GEMINI_API_KEY: string;
}

// Mirrors the prompt + response schema in the app's services/gemini.ts
// (client used model 'gemini-3-flash-preview'; keep in sync if it changes).
const MODEL = "gemini-3-flash-preview";
const PROMPT =
  "Analyze this Costco receipt and extract the details. Categorize each item into common grocery/household categories. Return strictly JSON.";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    warehouseName: { type: "STRING" },
    zipCode: { type: "STRING" },
    purchaseDate: { type: "STRING", description: "ISO format date" },
    total: { type: "NUMBER" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          itemNumber: { type: "STRING" },
          name: { type: "STRING" },
          price: { type: "NUMBER" },
          category: { type: "STRING" },
        },
        required: ["itemNumber", "name", "price", "category"],
      },
    },
  },
  required: ["warehouseName", "zipCode", "purchaseDate", "total", "items"],
};

// ~7MB base64 ≈ 5MB image — generous cap against abuse, fine for receipts.
const MAX_IMAGE_CHARS = 7_000_000;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context: {
  request: Request;
  env: PagesEnv;
}): Promise<Response> {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return json({ error: "service_unavailable" }, 503);
  }

  let body: { image?: unknown; mimeType?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const image = typeof body.image === "string" ? body.image : "";
  const mimeType =
    typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
  if (!image || image.length > MAX_IMAGE_CHARS) {
    return json({ error: "invalid_image" }, 400);
  }

  let geminiResp: Response;
  try {
    geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: {
            parts: [
              { inlineData: { mimeType, data: image } },
              { text: PROMPT },
            ],
          },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      }
    );
  } catch (e) {
    return json({ error: "upstream_unreachable" }, 502);
  }

  if (!geminiResp.ok) {
    // Never forward the upstream body — it can contain key-adjacent details.
    return json({ error: "upstream_error" }, 502);
  }

  let parsed: unknown;
  try {
    const raw = await geminiResp.json();
    const text =
      (raw as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    parsed = JSON.parse(text);
  } catch {
    return json({ error: "parse_failed" }, 502);
  }

  const items = (parsed as any)?.items;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(items)) {
    return json({ error: "bad_shape" }, 502);
  }

  return json(parsed, 200);
}
