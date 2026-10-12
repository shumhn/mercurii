import type { NextRequest } from "next/server";

// Browser clients use a same-origin path. The Mercury service address stays on
// the server, and a missing deployment configuration fails visibly.
async function forward(request: NextRequest, context: RouteContext<"/api/mercurii/[...path]">) {
  const backend = process.env.MERCURII_BACKEND_URL ??
    (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8787" : "");
  if (!backend) {
    return Response.json({ error: "Mercurii backend is not configured for this deployment" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }

  const { path } = await context.params;
  if (!path.length || path.some((part) => part === "." || part === ".." || part.includes("/")) ||
      (path[0] !== "v1" && !(path.length === 1 && path[0] === "health"))) {
    return Response.json({ error: "Unknown Mercurii route" }, { status: 404 });
  }

  try {
    const incoming = new URL(request.url);
    const target = new URL(`/${path.map(encodeURIComponent).join("/")}${incoming.search}`, backend);
    const headers = new Headers({ accept: "application/json" });
    for (const key of ["authorization", "content-type", "x-mercury-company"]) {
      const value = request.headers.get(key);
      if (value) headers.set(key, value);
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Mercurii backend is unavailable. Check the app connection." },
      { status: 502, headers: { "cache-control": "no-store" } });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
