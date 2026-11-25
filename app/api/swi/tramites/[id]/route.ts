import { eliminarTramite } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/swi/tramites/[id]?motivo=... → elimina el trámite en SWI (SWI registra TRAMITE_ELIMINADO). */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const motivo = (new URL(req.url).searchParams.get("motivo") ?? "").trim() || "Eliminado desde recepción";
    const result = await eliminarTramite(id, motivo);
    return Response.json({ ok: true, result });
  } catch (err) {
    return handleSwiError(err);
  }
}
