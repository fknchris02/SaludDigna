import { getContextoPaciente, isSwiConfigured, registrarInteraccion } from "@/lib/server/swi";
import { normalizarTelefonoSwi, type SwiCanal, type SwiInteraccionTipo } from "@/lib/swi/types";

function shouldSync(): boolean {
  return process.env.NODE_ENV !== "test" && isSwiConfigured();
}

/**
 * Sincronización no bloqueante (best-effort) de eventos desde los canales locales de Salud Digna hacia SWI.
 * Nunca interrumpe el flujo local si SWI no responde o en pruebas automatizadas.
 */
export function emitSwiInteractionAsync(params: {
  telefono: string;
  tramiteId?: string;
  tipo: SwiInteraccionTipo;
  detalle: Record<string, unknown>;
  canal?: SwiCanal;
}): void {
  if (!shouldSync()) return;
  const tel = normalizarTelefonoSwi(params.telefono);
  if (!tel && !params.tramiteId) return;

  const payload = params.tramiteId
    ? {
        tramiteId: params.tramiteId,
        tipo: params.tipo,
        detalle: params.detalle,
        canal: params.canal ?? ("CLINICA" as const),
      }
    : {
        telefono: tel!,
        tipo: params.tipo,
        detalle: params.detalle,
        canal: params.canal ?? ("CLINICA" as const),
      };

  void registrarInteraccion(payload).catch(() => {
    // Best-effort: si SWI está offline o la paciente aún no existe en SWI, no rompemos el flujo local.
  });
}

/**
 * Registra `CONTEXTO_CONSULTADO` en SWI usando `GET /pacientes/{tel}/contexto?registrar=1&canal=CLINICA`
 * (SWI deduplica automáticamente una vez cada 30 min).
 */
export function emitSwiContextConsultedAsync(telefono: string, canal: SwiCanal = "CLINICA"): void {
  if (!shouldSync()) return;
  const tel = normalizarTelefonoSwi(telefono);
  if (!tel) return;
  void getContextoPaciente(tel, { registrar: true, canal }).catch(() => {
    // Best-effort
  });
}
