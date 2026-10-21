import { rz } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Liveness for Liara's health check. Public, reveals nothing sensitive. */
export async function GET() {
  const r = rz();
  return Response.json({ ok: true, liara: r.config.liaraMode, docs: r.docs.info().chunks, audit: r.audit.verify().ok });
}
