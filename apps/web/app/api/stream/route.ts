import { guard, rz } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-sent events: backlog of recent runs, then every new event of every run. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const r = rz();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      for (const run of r.runtime.listRuns().slice(0, 10).reverse()) for (const e of r.runtime.events(run.id)) send({ ...e, backlog: true });
      send({ type: "ready" });
      const unsubscribe = r.runtime.subscribeAll(send);
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);
      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
