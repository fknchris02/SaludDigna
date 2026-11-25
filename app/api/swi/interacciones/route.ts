import { z } from "zod";
import { registrarInteraccion } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";
import { SWI_INTERACCION_TIPOS } from "@/lib/swi/types";

const InteraccionSchema = z
  .object({
    tramiteId: z.string().trim().min(1).optional(),
    telefono: z.string().trim().min(10).optional(),
    tipo: z.enum(SWI_INTERACCION_TIPOS),
    detalle: z.record(z.string(), z.unknown()).default({}),
    canal: z.enum(["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"]).optional(),
  })
  .refine((v) => Boolean(v.tramiteId || v.telefono), {
    message: "Se requiere tramiteId o telefono para registrar la interacción.",
  });

/**
 * POST /api/swi/interacciones
 * Solo acepta los 8 tipos exactos permitidos por SWI.
 * Para CHECK_IN y RESULTADOS_ENTREGADOS valida primero `registroCompleto` si viene `telefono`.
 */
export async function POST(req: Request) {
  try {
    const body = InteraccionSchema.parse(await req.json());
    const payload = body.tramiteId
      ? {
          tramiteId: body.tramiteId,
          telefono: body.telefono,
          tipo: body.tipo,
          detalle: body.detalle,
          canal: body.canal ?? ("CLINICA" as const),
        }
      : {
          telefono: body.telefono!,
          tipo: body.tipo,
          detalle: body.detalle,
          canal: body.canal ?? ("CLINICA" as const),
        };
    const result = await registrarInteraccion(payload);
    return Response.json({ ok: true, result }, { status: 201 });
  } catch (err) {
    return handleSwiError(err);
  }
}
