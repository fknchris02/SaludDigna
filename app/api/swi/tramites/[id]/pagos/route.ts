import { z } from "zod";
import { pagarConTarjetaApp, registrarPagoEnClinica, SwiError } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";

type Ctx = { params: Promise<{ id: string }> };

const TarjetaSchema = z.object({
  numero: z.string().trim().min(12, "Número de tarjeta inválido"),
  titular: z.string().trim().min(2, "Escribe el nombre del titular"),
  vencimiento: z.string().regex(/^\d{2}\/\d{2}$/, "Vencimiento debe ser MM/AA"),
  cvc: z.string().regex(/^\d{3,4}$/, "CVC inválido"),
});

const PagoSchema = z.discriminatedUnion("metodo", [
  z.object({
    metodo: z.literal("CLINICA"),
    telefonoParaValidar: z.string().trim().optional(),
    canal: z.enum(["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"]).optional(),
  }),
  z.object({
    metodo: z.literal("TARJETA"),
    modo: z.enum(["MOSTRADOR", "APP"]).default("APP"),
    tarjeta: TarjetaSchema,
  }),
]);

/**
 * POST /api/swi/tramites/[id]/pagos
 * - Con `metodo: "TARJETA"`: solo permitido en modo paciente (`APP`), y envía `"canal": "APP"` SOLO en esa petición.
 *   En modo mostrador (`MOSTRADOR`) se rechaza con 403.
 * - Con `metodo: "CLINICA"`: valida `registroCompleto` (si se pasa teléfono) y envía `"canal": "CLINICA"`.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = PagoSchema.parse(await req.json());

    if (body.metodo === "TARJETA") {
      if (body.modo === "MOSTRADOR") {
        throw new SwiError(
          403,
          "El pago con tarjeta no está permitido en modo mostrador (canal CLINICA). Usa «Pagará en clínica».",
        );
      }
      const res = await pagarConTarjetaApp(id, body.tarjeta);
      return Response.json(res);
    }

    const res = await registrarPagoEnClinica(id, {
      canal: body.canal ?? "CLINICA",
      telefonoParaValidar: body.telefonoParaValidar,
    });
    return Response.json(res);
  } catch (err) {
    return handleSwiError(err);
  }
}
