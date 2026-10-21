/**
 * Console access gate (Next 16 "proxy", formerly middleware). When
 * CONSOLE_PASSWORD is set, every page and API route except /api/health needs
 * HTTP Basic auth, so the browser prompts once on the first page load and
 * then sends the credentials with fetch and EventSource automatically.
 * API routes re-check in lib/server.ts (defence in depth).
 */
import { NextResponse, type NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const password = process.env.CONSOLE_PASSWORD;
  if (!password || req.nextUrl.pathname === "/api/health") return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    if (constantTimeEqual(decoded.slice(decoded.indexOf(":") + 1), password)) return NextResponse.next();
  }
  return new NextResponse("auth required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="rahandaz", charset="UTF-8"' } });
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg).*)"],
};
