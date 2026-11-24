import { z } from "zod";
import { catchUp, handleInboundMessage } from "@/lib/channels/whatsapp";
import { db } from "@/lib/db";
import { EventType } from "@/lib/engine/events";
import { normalizePhone } from "@/lib/engine/identity";
import { handleError } from "@/lib/http";

// shortcut: el simulador confía en el número que se escribe (en WhatsApp real lo garantiza Meta/Twilio).
// Se apaga con WHATSAPP_SIMULATOR=0 cuando exista el canal real.
const enabled = () => process.env.WHATSAPP_SIMULATOR !== "0";

const Body = z.object({
  from: z.string().min(8).max(30),
  text: z.string().trim().min(1).max(1000),
  messageId: z.string().max(100).optional(),
});

export async function POST(req: Request) {
  if (!enabled()) return new Response(null, { status: 404 });
  try {
    return Response.json(await handleInboundMessage(Body.parse(await req.json())));
  } catch (err) {
    return handleError(err);
  }
}

/** Historial de la conversación de un número (para que el simulador sobreviva a una recarga). */
export async function GET(req: Request) {
  if (!enabled()) return new Response(null, { status: 404 });
  try {
    const from = normalizePhone(z.string().parse(new URL(req.url).searchParams.get("from")));
    await catchUp(from);
    const identity = await db.channelIdentity.findUnique({ where: { channel_externalId: { channel: "WHATSAPP", externalId: from } } });
    if (!identity) return Response.json({ messages: [] });
    const events = await db.event.findMany({
      where: { type: { in: [EventType.MESSAGE_IN, EventType.MESSAGE_OUT] }, payload: { path: ["identityId"], equals: identity.id } },
      orderBy: { seq: "desc" },
      take: 100,
    });
    const messages = events.reverse().map((e) => {
      const p = e.payload as { text: string; options?: string[] };
      return { id: e.seq.toString(), dir: e.type === EventType.MESSAGE_IN ? "in" : "out", text: p.text, options: p.options ?? [], at: e.createdAt };
    });
    return Response.json({ messages });
  } catch (err) {
    return handleError(err);
  }
}
