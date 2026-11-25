import { getContextoPaciente } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";
import type { SwiCanal } from "@/lib/swi/types";

type Ctx = { params: Promise<{ telefono: string }> };

/**
 * GET /api/swi/pacientes/[telefono]/contexto?registrar=1&canal=CLINICA
 * Devuelve paciente (incluyendo registroCompleto, faltanDatos, preguntaSeguridad, adultoMayor, contactoParentesco),
 * trámites e interacciones desde SWI.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { telefono } = await params;
    const sp = new URL(req.url).searchParams;
    const registrar = sp.get("registrar") === "1" || sp.get("registrar") === "true";
    const canalParam = sp.get("canal");
    const canal: SwiCanal =
      canalParam === "APP" || canalParam === "WEB" || canalParam === "WHATSAPP" || canalParam === "CALL_CENTER"
        ? canalParam
        : "CLINICA";

    const ctx = await getContextoPaciente(telefono, { registrar, canal });
    return Response.json(ctx);
  } catch (err) {
    return handleSwiError(err);
  }
}
