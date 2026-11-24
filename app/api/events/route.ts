import type { Event } from "@prisma/client";
import { assertStaffCanSee, canAccessCase, requireActor, type Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EngineError } from "@/lib/engine/case";
import { bus, eventsSince, matches, toJson, type EventFilter } from "@/lib/engine/events";
import { handleError } from "@/lib/http";

/**
 * Qué puede escuchar cada quien:
 * admin = todo · asesor = un caso o paciente concreto · paciente = solo lo suyo (o su trámite anónimo).
 */
async function authorizedFilter(actor: Actor, url: URL): Promise<EventFilter> {
  const caseId = url.searchParams.get("caseId") ?? undefined;
  const patientId = url.searchParams.get("patientId") ?? undefined;
  if (actor.channel === "CALL_CENTER") {
    if (actor.session.role === "ADMIN") return { caseId, patientId };
    if (!caseId && !patientId) throw new EngineError("FORBIDDEN", "El asesor debe indicar caseId o patientId");
    // El asesor solo escucha a pacientes que validó; si filtra por caso, se valida el paciente de ese caso.
    const owner = patientId ?? (await db.case.findUnique({ where: { id: caseId! } }))?.patientId ?? null;
    await assertStaffCanSee(actor.session, owner);
    return { caseId, patientId: owner ?? undefined };
  }
  if (actor.session.patientId) return { caseId, patientId: actor.session.patientId };
  const c = caseId ? await db.case.findUnique({ where: { id: caseId } }) : null;
  if (!c || !canAccessCase(actor, c)) throw new EngineError("FORBIDDEN", "Sin acceso a estos eventos");
  return { caseId };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  let filter: EventFilter;
  try {
    filter = await authorizedFilter(await requireActor(req), url);
  } catch (err) {
    return handleError(err);
  }
  // El navegador manda Last-Event-ID solo al reconectar: reenviamos lo que se perdió durante el corte.
  const since = req.headers.get("last-event-id") ?? url.searchParams.get("since") ?? "0";
  let lastSent = /^\d+$/.test(since) ? BigInt(since) : 0n;

  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Event) => {
        if (e.seq <= lastSent) return; // evita duplicados entre replay y vivo
        lastSent = e.seq;
        controller.enqueue(enc.encode(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(toJson(e))}\n\n`));
      };

      // Suscribirse ANTES del replay y encolar, para no perder eventos que lleguen mientras se consulta la BD.
      let queue: Event[] | null = [];
      const onEvent = (e: Event) => {
        if (!matches(e, filter)) return;
        if (queue) queue.push(e);
        else send(e);
      };
      bus.on("event", onEvent);
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 15_000);
      cleanup = () => {
        bus.off("event", onEvent);
        clearInterval(ping);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });

      controller.enqueue(enc.encode("retry: 2000\n\n"));
      for (let batch; (batch = await eventsSince(filter, lastSent)).length > 0; ) batch.forEach(send);
      for (const e of queue.sort((a, b) => (a.seq < b.seq ? -1 : 1))) send(e);
      queue = null;
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
