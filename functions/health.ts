/** Health check for the C-Shopper Pages Functions. GET /health -> { ok: true } */
export async function onRequestGet(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
