"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SwiPatientForm } from "@/app/_components/SwiPatientForm";
import { SwiPaymentModal } from "@/app/_components/SwiPaymentModal";
import { SwiSecurityCard } from "@/app/_components/SwiSecurityCard";
import { SwiSurveyModal } from "@/app/_components/SwiSurveyModal";
import {
  aFechaCDMX,
  espaciosDisponiblesClinica,
  fechaLocalIso,
  formatMoneyPesos,
} from "@/lib/swi/helpers";
import {
  esRegistroCompleto,
  etiquetaParentesco,
  mensajeRegistroIncompleto,
  normalizarTelefonoSwi,
  type SwiClinica,
  type SwiContexto,
  type SwiEstudio,
  type SwiInteraccionTipo,
  type SwiTramite,
} from "@/lib/swi/types";

const EN_CURSO = new Set(["COTIZANDO", "CLINICA_SELECCIONADA", "DATOS_CAPTURADOS", "ABANDONADO"]);

export default function ClinicaSwiPage() {
  const [estudios, setEstudios] = useState<SwiEstudio[]>([]);
  const [clinicas, setClinicas] = useState<SwiClinica[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [recepcion, setRecepcion] = useState("Recepción Clínica");
  const [modoOperacion, setModoOperacion] = useState<"MOSTRADOR" | "APP">("MOSTRADOR");
  const [telefonoInput, setTelefonoInput] = useState("");
  const [telefonoActivo, setTelefonoActivo] = useState<string | null>(null);

  const [ctx, setCtx] = useState<SwiContexto | null>(null);
  const [noEncontradoTel, setNoEncontradoTel] = useState<string | null>(null);
  const [editandoPaciente, setEditandoPaciente] = useState(false);
  const [alertaRegistro, setAlertaRegistro] = useState<string | null>(null);

  const [banner, setBanner] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Detalle / modales
  const [citaDetalle, setCitaDetalle] = useState<SwiTramite | null>(null);
  const [pagandoTramite, setPagandoTramite] = useState<SwiTramite | null>(null);
  const [encuestaTramiteId, setEncuestaTramiteId] = useState<string | undefined>(undefined);
  const [showEncuesta, setShowEncuesta] = useState(false);

  // Selección de horario paso a paso
  const [diaElegido, setDiaElegido] = useState<string>("");
  const [hoyIso, setHoyIso] = useState<string>("");

  // Eventos 8b (nota / mensaje / transferencia)
  const [notaTexto, setNotaTexto] = useState("");
  const [mensajeTexto, setMensajeTexto] = useState("");
  const [transferMotivo, setTransferMotivo] = useState("");

  useEffect(() => {
    fetch("/api/swi/catalog")
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          estudios?: SwiEstudio[];
          clinicas?: SwiClinica[];
          error?: string;
        };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setEstudios(j.estudios ?? []);
        setClinicas(j.clinicas ?? []);
        setCatalogError(null);
      })
      .catch((err) => {
        setCatalogError(err instanceof Error ? err.message : "No se pudo cargar el catálogo de SWI.");
      })
      .finally(() => {
        setHoyIso(fechaLocalIso(new Date()));
      });
  }, []);

  const cargarContexto = useCallback(
    async (tel: string, registrarConsulta = false): Promise<SwiContexto | null> => {
      const qs = registrarConsulta ? "?registrar=1&canal=CLINICA" : "";
      const r = await fetch(`/api/swi/pacientes/${encodeURIComponent(tel)}/contexto${qs}`);
      const json = (await r.json().catch(() => ({}))) as SwiContexto & { error?: string };
      if (r.status === 404) {
        setCtx(null);
        setNoEncontradoTel(tel);
        setEditandoPaciente(true);
        setAlertaRegistro("Paciente no encontrada en SWI. Completa su registro para comenzar.");
        return null;
      }
      if (!r.ok) {
        throw new Error(json.error ?? `Error al consultar contexto (HTTP ${r.status}).`);
      }
      setNoEncontradoTel(null);
      setCtx(json);
      return json;
    },
    [],
  );

  async function buscarPaciente(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    setAlertaRegistro(null);
    setEditandoPaciente(false);
    setCitaDetalle(null);

    const tel = normalizarTelefonoSwi(telefonoInput);
    if (!tel) {
      setBanner({ kind: "error", text: "Escribe un teléfono celular válido de 10 dígitos." });
      return;
    }

    setBusy(true);
    setTelefonoActivo(tel);
    try {
      // 1) Consulta búsqueda básica (GET /pacientes/buscar?metodo=telefono&telefono={tel})
      const searchRes = await fetch(`/api/swi/pacientes?telefono=${encodeURIComponent(tel)}`);
      const searchJson = (await searchRes.json().catch(() => ({}))) as {
        encontrado?: boolean;
        error?: string;
      };
      if (!searchRes.ok && searchRes.status !== 404) {
        throw new Error(searchJson.error ?? `Error en búsqueda (HTTP ${searchRes.status}).`);
      }
      if (searchRes.status === 404 || searchJson.encontrado === false) {
        setCtx(null);
        setNoEncontradoTel(tel);
        setEditandoPaciente(true);
        setAlertaRegistro("Paciente no encontrada en SWI. Completa su registro para continuar.");
        return;
      }
      // 2) Carga contexto y registra CONTEXTO_CONSULTADO (SWI deduplica 1 vez cada 30 min)
      await cargarContexto(tel, true);
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "No se pudo consultar SWI.",
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Regla 2: antes de AGENDAR, CONFIRMAR, cobrar (CLINICA), CHECK_IN o RESULTADOS_ENTREGADOS,
   * consulta GET /pacientes/{tel}/contexto y valida `registroCompleto`.
   */
  async function asegurarRegistroCompleto(tel: string): Promise<SwiContexto | null> {
    const fresh = await cargarContexto(tel, false);
    if (!fresh) return null;
    if (!esRegistroCompleto(fresh.paciente)) {
      const msg = mensajeRegistroIncompleto(fresh.paciente);
      setAlertaRegistro(msg);
      setBanner({ kind: "warn", text: msg });
      setEditandoPaciente(true);
      return null;
    }
    return fresh;
  }

  async function callApi<T>(url: string, init: RequestInit): Promise<T> {
    const r = await fetch(url, init);
    const json = (await r.json().catch(() => ({}))) as T & {
      error?: string;
      registroCompleto?: boolean;
    };
    if (!r.ok) {
      const msg = json.error ?? `Error HTTP ${r.status}`;
      if (r.status === 400 && (json.registroCompleto === false || msg.toLowerCase().includes("completa su registro"))) {
        setAlertaRegistro(msg);
        setEditandoPaciente(true);
      }
      throw new Error(msg);
    }
    return json;
  }

  const tramiteActivo = useMemo(() => {
    if (!ctx) return null;
    if (ctx.tramiteActivo && EN_CURSO.has(ctx.tramiteActivo.estado)) return ctx.tramiteActivo;
    return ctx.tramites.find((t) => EN_CURSO.has(t.estado)) ?? null;
  }, [ctx]);

  const clinicaIdActiva = tramiteActivo?.clinica?.id ?? null;
  const clinicaSeleccionada = useMemo(() => {
    if (!clinicaIdActiva) return null;
    return clinicas.find((c) => c.id === clinicaIdActiva) ?? null;
  }, [clinicas, clinicaIdActiva]);

  const diasDisponibles = useMemo(
    () => (clinicaSeleccionada ? espaciosDisponiblesClinica(clinicaSeleccionada.horarios, 6) : []),
    [clinicaSeleccionada],
  );

  const diaActivo = useMemo(() => {
    if (diasDisponibles.length === 0) return null;
    return diasDisponibles.find((d) => d.fecha === diaElegido) ?? diasDisponibles[0];
  }, [diasDisponibles, diaElegido]);

  async function elegirEstudio(estudioId: string) {
    if (!ctx) return;
    setBusy(true);
    setBanner(null);
    try {
      if (!tramiteActivo) {
        await callApi("/api/swi/tramites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ telefono: ctx.paciente.telefono, estudioId, canal: "CLINICA" }),
        });
      } else {
        if (tramiteActivo.estado === "ABANDONADO") {
          await callApi(`/api/swi/tramites/${encodeURIComponent(tramiteActivo.id)}/avanzar`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accion: "RETOMAR", canal: "CLINICA" }),
          });
        }
        await callApi(`/api/swi/tramites/${encodeURIComponent(tramiteActivo.id)}/avanzar`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accion: "ESTUDIO", datos: { estudioId }, canal: "CLINICA" }),
        });
      }
      await cargarContexto(ctx.paciente.telefono, false);
      setBanner({ kind: "ok", text: "Estudio registrado en SWI." });
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error al elegir estudio." });
    } finally {
      setBusy(false);
    }
  }

  async function avanzarPaso(
    tramite: SwiTramite,
    accion: "CLINICA" | "FECHA" | "DATOS" | "AGENDAR" | "CONFIRMAR" | "CANCELAR" | "RETOMAR",
    datos?: Record<string, unknown>,
  ) {
    if (!ctx) return;
    setBusy(true);
    setBanner(null);
    try {
      if (accion === "AGENDAR" || accion === "CONFIRMAR") {
        const ok = await asegurarRegistroCompleto(ctx.paciente.telefono);
        if (!ok) return;
      }

      if (tramite.estado === "ABANDONADO" && accion !== "RETOMAR" && accion !== "CANCELAR") {
        await callApi(`/api/swi/tramites/${encodeURIComponent(tramite.id)}/avanzar`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accion: "RETOMAR", canal: "CLINICA" }),
        });
      }

      await callApi(`/api/swi/tramites/${encodeURIComponent(tramite.id)}/avanzar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accion,
          ...(datos ? { datos } : {}),
          canal: "CLINICA",
          ...(accion === "AGENDAR" || accion === "CONFIRMAR"
            ? { telefonoParaValidar: ctx.paciente.telefono }
            : {}),
        }),
      });
      await cargarContexto(ctx.paciente.telefono, false);
      setBanner({ kind: "ok", text: `Acción ${accion} registrada en SWI.` });
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error al avanzar el trámite." });
    } finally {
      setBusy(false);
    }
  }

  async function borrarTramite(tramite: SwiTramite) {
    if (!ctx) return;
    const motivo = window.prompt("Motivo para eliminar el trámite:", "Registro duplicado");
    if (!motivo) return;
    setBusy(true);
    setBanner(null);
    try {
      await callApi(
        `/api/swi/tramites/${encodeURIComponent(tramite.id)}?motivo=${encodeURIComponent(motivo)}`,
        { method: "DELETE" },
      );
      await cargarContexto(ctx.paciente.telefono, false);
      setBanner({ kind: "ok", text: "Trámite eliminado en SWI." });
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error al eliminar trámite." });
    } finally {
      setBusy(false);
    }
  }

  async function enviarInteraccion(params: {
    tramiteId?: string;
    tipo: SwiInteraccionTipo;
    detalle: Record<string, unknown>;
    requiereRegistroCompleto?: boolean;
    okMsg?: string;
  }) {
    if (!ctx) return;
    setBusy(true);
    setBanner(null);
    try {
      if (params.requiereRegistroCompleto) {
        const ok = await asegurarRegistroCompleto(ctx.paciente.telefono);
        if (!ok) return;
      }
      await callApi("/api/swi/interacciones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(params.tramiteId ? { tramiteId: params.tramiteId } : {}),
          telefono: ctx.paciente.telefono,
          tipo: params.tipo,
          detalle: params.detalle,
          canal: "CLINICA",
        }),
      });
      await cargarContexto(ctx.paciente.telefono, false);
      if (params.okMsg) setBanner({ kind: "ok", text: params.okMsg });
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error al registrar evento en SWI." });
    } finally {
      setBusy(false);
    }
  }

  async function abrirDetalleCita(t: SwiTramite) {
    setCitaDetalle(t);
    if (!ctx) return;
    // Regla 8b: Ver el detalle de una cita -> CITA_VISUALIZADA { folio }
    void fetch("/api/swi/interacciones", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tramiteId: t.id,
        tipo: "CITA_VISUALIZADA",
        detalle: { folio: t.folio },
        canal: "CLINICA",
      }),
    })
      .then(() => cargarContexto(ctx.paciente.telefono, false))
      .catch(() => {});
  }

  async function abrirPago(t: SwiTramite) {
    if (!ctx) return;
    setBanner(null);
    if (modoOperacion === "MOSTRADOR") {
      setBusy(true);
      try {
        const ok = await asegurarRegistroCompleto(ctx.paciente.telefono);
        if (!ok) return;
      } finally {
        setBusy(false);
      }
    }
    setPagandoTramite(t);
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex flex-wrap items-center gap-3">
        <div>
          <p className="font-semibold text-slate-900">
            <span className="text-teal-700">Salud Digna</span> · Clínica / Recepción (SWI)
          </p>
          <p className="text-xs text-slate-500">
            Proxy <code className="font-mono">lib/server/swi.ts</code> · canal{" "}
            <code className="font-mono">CLINICA</code> (tarjeta solo en modo celular <code className="font-mono">APP</code>)
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
            <span className="text-slate-500">Atiende:</span>
            <input
              value={recepcion}
              onChange={(e) => setRecepcion(e.target.value)}
              className="w-36 bg-transparent font-medium text-slate-800 focus:outline-none"
            />
          </label>

          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setModoOperacion("MOSTRADOR")}
              className={`rounded-md px-2.5 py-1 font-medium ${
                modoOperacion === "MOSTRADOR" ? "bg-teal-700 text-white" : "text-slate-600"
              }`}
            >
              Mostrador (CLINICA)
            </button>
            <button
              type="button"
              onClick={() => setModoOperacion("APP")}
              className={`rounded-md px-2.5 py-1 font-medium ${
                modoOperacion === "APP" ? "bg-teal-700 text-white" : "text-slate-600"
              }`}
            >
              Celular paciente (APP)
            </button>
          </div>

          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            Inicio
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4 md:p-6 space-y-5">
        {catalogError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <strong>Sin conexión con SWI:</strong> {catalogError}
          </div>
        )}

        {/* Buscador de paciente */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <form onSubmit={buscarPaciente} className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[220px] text-sm">
              <span className="font-medium text-slate-700">Buscar paciente por teléfono (10 dígitos)</span>
              <input
                value={telefonoInput}
                onChange={(e) => setTelefonoInput(e.target.value)}
                placeholder="Ej. 667 000 0001"
                inputMode="tel"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/40"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {busy ? "Buscando…" : "Buscar en SWI"}
            </button>
          </form>
        </section>

        {banner && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm ${
              banner.kind === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : banner.kind === "warn"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* Formulario de registro / edición */}
        {(editandoPaciente || noEncontradoTel) && telefonoActivo && (
          <section className="rounded-2xl border border-teal-200 bg-white p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              {ctx ? "Completar / editar datos de la paciente" : "Registrar nueva paciente en SWI"}
            </h2>
            <SwiPatientForm
              key={ctx?.paciente.id ?? noEncontradoTel ?? telefonoActivo}
              telefonoInicial={telefonoActivo}
              paciente={ctx?.paciente ?? null}
              alerta={alertaRegistro}
              onSaved={async () => {
                setEditandoPaciente(false);
                setNoEncontradoTel(null);
                setAlertaRegistro(null);
                await cargarContexto(telefonoActivo, true);
                setBanner({ kind: "ok", text: "Datos de la paciente guardados en SWI." });
              }}
              onCancel={ctx ? () => setEditandoPaciente(false) : undefined}
            />
          </section>
        )}

        {/* Expediente del paciente */}
        {ctx && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5 min-w-0">
              {/* Ficha del paciente */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">
                        {ctx.paciente.nombre ||
                          [ctx.paciente.nombres, ctx.paciente.primerApellido, ctx.paciente.segundoApellido]
                            .filter(Boolean)
                            .join(" ") ||
                          ctx.paciente.telefono}
                      </h2>
                      {esRegistroCompleto(ctx.paciente) ? (
                        <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                          Registro completo
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                          Registro incompleto
                        </span>
                      )}
                      {ctx.paciente.adultoMayor && (
                        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800">
                          Adulto mayor (60+)
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      Tel. <span className="font-mono">{ctx.paciente.telefono}</span>
                      {ctx.paciente.email ? ` · ${ctx.paciente.email}` : ""}
                      {ctx.paciente.fechaNacimiento ? ` · Nac. ${ctx.paciente.fechaNacimiento.slice(0, 10)}` : ""}
                    </p>
                    {ctx.paciente.contactoNombre && (
                      <p className="mt-1 text-sm text-slate-700">
                        <span className="text-slate-500">Familiar:</span>{" "}
                        <strong>{ctx.paciente.contactoNombre}</strong>
                        {ctx.paciente.contactoParentesco && (
                          <span className="ml-1.5 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {etiquetaParentesco(ctx.paciente.contactoParentesco)}
                          </span>
                        )}
                        {ctx.paciente.contactoTelefono && (
                          <span className="ml-1.5 font-mono text-xs text-slate-500">
                            · {ctx.paciente.contactoTelefono}
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAlertaRegistro(
                          esRegistroCompleto(ctx.paciente)
                            ? null
                            : mensajeRegistroIncompleto(ctx.paciente),
                        );
                        setEditandoPaciente((v) => !v);
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {editandoPaciente ? "Ocultar formulario" : "Editar / completar datos"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEncuestaTramiteId(tramiteActivo?.id ?? ctx.tramites[0]?.id);
                        setShowEncuesta(true);
                      }}
                      className="rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    >
                      Encuesta de satisfacción
                    </button>
                  </div>
                </div>

                {!esRegistroCompleto(ctx.paciente) && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {mensajeRegistroIncompleto(ctx.paciente)}
                  </p>
                )}
              </section>

              {/* Agendado paso a paso (ESTUDIO -> CLINICA -> FECHA -> DATOS -> AGENDAR -> CONFIRMAR) */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {tramiteActivo ? `Trámite en curso · ${tramiteActivo.folio}` : "Nuevo trámite paso a paso"}
                  </h3>
                  {tramiteActivo && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        Estado: {tramiteActivo.estado} · Paso: {tramiteActivo.paso}
                      </span>
                      {tramiteActivo.estado === "ABANDONADO" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => avanzarPaso(tramiteActivo, "RETOMAR")}
                          className="rounded bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700"
                        >
                          Retomar
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const motivo = window.prompt("Motivo de cancelación:", "Cancelado en clínica");
                          if (motivo) avanzarPaso(tramiteActivo, "CANCELAR", { motivo });
                        }}
                        className="text-red-700 hover:underline"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => borrarTramite(tramiteActivo)}
                        className="text-slate-500 hover:underline"
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>

                {/* Paso 1: Estudio */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    1. Estudio {tramiteActivo?.estudio?.nombre ? `— ${tramiteActivo.estudio.nombre}` : ""}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {estudios.map((e) => {
                      const selected = tramiteActivo?.estudio?.id === e.id;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          disabled={busy}
                          onClick={() => elegirEstudio(e.id)}
                          className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                            selected
                              ? "border-teal-600 bg-teal-50"
                              : "border-slate-200 hover:border-teal-400 hover:bg-slate-50"
                          }`}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-medium">{e.nombre}</span>
                            <span className="font-semibold text-teal-800">{formatMoneyPesos(e.precio)}</span>
                          </span>
                          <span className="block text-xs text-slate-500 mt-0.5">{e.preparacion}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Paso 2: Clínica */}
                {tramiteActivo && (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      2. Clínica (acción CLINICA)
                      {tramiteActivo.clinica?.nombre ? ` — ${tramiteActivo.clinica.nombre}` : ""}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {clinicas.map((cl) => {
                        const selected = tramiteActivo.clinica?.id === cl.id;
                        return (
                          <button
                            key={cl.id}
                            type="button"
                            disabled={busy}
                            onClick={() => avanzarPaso(tramiteActivo, "CLINICA", { clinicaId: cl.id })}
                            className={`rounded-xl border px-3 py-2 text-left text-sm ${
                              selected
                                ? "border-teal-600 bg-teal-50"
                                : "border-slate-200 hover:border-teal-400 hover:bg-slate-50"
                            }`}
                          >
                            <span className="font-medium block">{cl.nombre}</span>
                            <span className="text-xs text-slate-500">
                              {cl.direccion} · {cl.ciudad}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Paso 3: Fecha y hora */}
                {tramiteActivo && tramiteActivo.clinica && (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      3. Fecha y hora (acción FECHA)
                      {tramiteActivo.fechaCita
                        ? ` — ${new Date(tramiteActivo.fechaCita).toLocaleString("es-MX")}`
                        : ""}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {diasDisponibles.map((d) => (
                        <button
                          key={d.fecha}
                          type="button"
                          onClick={() => setDiaElegido(d.fecha)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${
                            diaActivo?.fecha === d.fecha
                              ? "border-teal-600 bg-teal-600 text-white"
                              : "border-slate-200 bg-white text-slate-700"
                          }`}
                        >
                          {d.fecha === hoyIso ? "Hoy" : d.etiqueta}
                        </button>
                      ))}
                    </div>
                    {diaActivo && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {diaActivo.horas.slice(0, 12).map((h) => (
                          <button
                            key={`${diaActivo.fecha}-${h}`}
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              avanzarPaso(tramiteActivo, "FECHA", {
                                fechaCita: aFechaCDMX(diaActivo.fecha, h).toISOString(),
                              })
                            }
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50"
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Paso 4: Confirmar datos y Agendar */}
                {tramiteActivo && tramiteActivo.clinica && tramiteActivo.fechaCita && (
                  <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => avanzarPaso(tramiteActivo, "DATOS", {})}
                      className="rounded-lg border border-teal-600 px-3.5 py-2 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                    >
                      4. Confirmar datos (DATOS)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => avanzarPaso(tramiteActivo, "AGENDAR")}
                      className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      5. Agendar cita (AGENDAR)
                    </button>
                  </div>
                )}
              </section>

              {/* Citas / Trámites de la paciente + Eventos de recepción */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  Citas y trámites en SWI ({ctx.tramites.length})
                </h3>
                {ctx.tramites.length === 0 ? (
                  <p className="text-sm text-slate-500">Sin trámites registrados todavía.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {ctx.tramites.map((t) => (
                      <li key={t.id} className="py-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold bg-slate-100 rounded px-2 py-0.5">
                            {t.folio}
                          </span>
                          <span className="text-sm font-medium">{t.estudio.nombre}</span>
                          <span className="text-xs text-slate-500">
                            {t.clinica?.nombre ?? "Sin clínica"}
                            {t.fechaCita ? ` · ${new Date(t.fechaCita).toLocaleString("es-MX")}` : ""}
                          </span>
                          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {t.estado} · Pago: {t.pago?.estado ?? "PENDIENTE"}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1.5 text-xs">
                          <button
                            type="button"
                            onClick={() => abrirDetalleCita(t)}
                            className="rounded-md border border-slate-300 px-2.5 py-1 hover:bg-slate-50"
                          >
                            Ver detalle
                          </button>
                          {t.estado === "AGENDADO" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => avanzarPaso(t, "CONFIRMAR")}
                              className="rounded-md bg-teal-700 px-2.5 py-1 font-medium text-white hover:bg-teal-800"
                            >
                              Confirmar asistencia
                            </button>
                          )}
                          {(t.estado === "AGENDADO" || t.estado === "CONFIRMADO") &&
                            t.pago?.estado !== "PAGADO" && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => abrirPago(t)}
                                className="rounded-md border border-teal-600 px-2.5 py-1 font-medium text-teal-700 hover:bg-teal-50"
                              >
                                {modoOperacion === "MOSTRADOR" ? "Pagará en clínica" : "Pagar"}
                              </button>
                            )}
                          {(t.estado === "AGENDADO" || t.estado === "CONFIRMADO") && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  enviarInteraccion({
                                    tramiteId: t.id,
                                    tipo: "CHECK_IN",
                                    detalle: { recepcion: recepcion.trim() || "Recepción" },
                                    requiereRegistroCompleto: true,
                                    okMsg: `Check-in registrado para ${t.folio}.`,
                                  })
                                }
                                className="rounded-md bg-emerald-700 px-2.5 py-1 font-medium text-white hover:bg-emerald-800"
                              >
                                Check-in (llegada)
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  enviarInteraccion({
                                    tramiteId: t.id,
                                    tipo: "RESULTADOS_ENTREGADOS",
                                    detalle: {
                                      recepcion: recepcion.trim() || "Recepción",
                                      estudio: t.estudio.nombre,
                                    },
                                    requiereRegistroCompleto: true,
                                    okMsg: `Entrega de resultados registrada para ${t.folio}.`,
                                  })
                                }
                                className="rounded-md bg-indigo-700 px-2.5 py-1 font-medium text-white hover:bg-indigo-800"
                              >
                                Entregar resultados
                              </button>
                            </>
                          )}
                          {t.estado !== "CANCELADO" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                const motivo = window.prompt("Motivo de cancelación:", "Cancelado por la paciente");
                                if (motivo) avanzarPaso(t, "CANCELAR", { motivo });
                              }}
                              className="rounded-md border border-red-200 px-2.5 py-1 text-red-700 hover:bg-red-50"
                            >
                              Cancelar cita
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {citaDetalle && (
                  <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4 text-sm space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-teal-900">
                        Detalle de cita · <span className="font-mono">{citaDetalle.folio}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setCitaDetalle(null)}
                        className="text-xs text-slate-600 hover:underline"
                      >
                        Cerrar
                      </button>
                    </div>
                    <p>
                      <strong>Estudio:</strong> {citaDetalle.estudio.nombre} (
                      {formatMoneyPesos(citaDetalle.estudio.precio)})
                    </p>
                    <p>
                      <strong>Clínica:</strong> {citaDetalle.clinica?.nombre ?? "Por elegir"}{" "}
                      {citaDetalle.clinica?.direccion ? `· ${citaDetalle.clinica.direccion}` : ""}
                    </p>
                    <p>
                      <strong>Preparación:</strong> {citaDetalle.estudio.preparacion}
                    </p>
                    <p className="text-xs text-teal-800">
                      Evento <code className="font-mono">CITA_VISUALIZADA</code> enviado a SWI.
                    </p>
                  </div>
                )}
              </section>
            </div>

            {/* Columna derecha: Seguridad, Acciones de interacción 8b y Recorrido SWI */}
            <aside className="space-y-4">
              <SwiSecurityCard
                paciente={ctx.paciente}
                onUpdated={async () => {
                  await cargarContexto(ctx.paciente.telefono, false);
                }}
              />

              {/* Eventos 8b manuales: NOTA_ASESOR, MENSAJE_ENVIADO/RECIBIDO, TRANSFERENCIA_ASESOR */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">Registrar interacción en SWI</h3>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!notaTexto.trim()) return;
                    void enviarInteraccion({
                      tramiteId: tramiteActivo?.id,
                      tipo: "NOTA_ASESOR",
                      detalle: {
                        nota: notaTexto.trim(),
                        recepcion: recepcion.trim() || "Recepción",
                      },
                      okMsg: "Nota registrada en SWI.",
                    }).then(() => setNotaTexto(""));
                  }}
                  className="space-y-1.5"
                >
                  <label className="text-xs font-medium text-slate-600">Nota del personal (NOTA_ASESOR)</label>
                  <div className="flex gap-1.5">
                    <input
                      value={notaTexto}
                      onChange={(e) => setNotaTexto(e.target.value)}
                      placeholder="Observación de recepción…"
                      className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={busy || !notaTexto.trim()}
                      className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Guardar
                    </button>
                  </div>
                </form>

                <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                  <label className="text-xs font-medium text-slate-600">Mensajes (MENSAJE_ENVIADO / RECIBIDO)</label>
                  <input
                    value={mensajeTexto}
                    onChange={(e) => setMensajeTexto(e.target.value)}
                    placeholder="Texto del mensaje…"
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy || !mensajeTexto.trim()}
                      onClick={() =>
                        void enviarInteraccion({
                          tramiteId: tramiteActivo?.id,
                          tipo: "MENSAJE_ENVIADO",
                          detalle: { texto: mensajeTexto.trim() },
                          okMsg: "MENSAJE_ENVIADO registrado.",
                        }).then(() => setMensajeTexto(""))
                      }
                      className="flex-1 rounded-lg border border-teal-600 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                    >
                      App → Paciente
                    </button>
                    <button
                      type="button"
                      disabled={busy || !mensajeTexto.trim()}
                      onClick={() =>
                        void enviarInteraccion({
                          tramiteId: tramiteActivo?.id,
                          tipo: "MENSAJE_RECIBIDO",
                          detalle: { texto: mensajeTexto.trim() },
                          okMsg: "MENSAJE_RECIBIDO registrado.",
                        }).then(() => setMensajeTexto(""))
                      }
                      className="flex-1 rounded-lg border border-slate-300 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Paciente → App
                    </button>
                  </div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!transferMotivo.trim()) return;
                    void enviarInteraccion({
                      tramiteId: tramiteActivo?.id,
                      tipo: "TRANSFERENCIA_ASESOR",
                      detalle: { motivo: transferMotivo.trim() },
                      okMsg: "Solicitud de transferencia registrada.",
                    }).then(() => setTransferMotivo(""));
                  }}
                  className="space-y-1.5 border-t border-slate-100 pt-2.5"
                >
                  <label className="text-xs font-medium text-slate-600">
                    Hablar con asesor (TRANSFERENCIA_ASESOR)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      value={transferMotivo}
                      onChange={(e) => setTransferMotivo(e.target.value)}
                      placeholder="Motivo de transferencia…"
                      className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={busy || !transferMotivo.trim()}
                      className="rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Transferir
                    </button>
                  </div>
                </form>
              </section>

              {/* Línea de tiempo SWI */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Recorrido en SWI ({ctx.interacciones?.length ?? 0})
                </h3>
                <ol className="max-h-80 overflow-y-auto space-y-2 pr-1 text-xs">
                  {[...(ctx.interacciones ?? [])].reverse().map((ev) => (
                    <li key={ev.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-teal-800">{ev.tipo}</span>
                        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500 border border-slate-200">
                          {ev.canal}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(ev.fecha).toLocaleString("es-MX")}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </aside>
          </div>
        )}
      </main>

      {pagandoTramite && ctx && (
        <SwiPaymentModal
          tramite={pagandoTramite}
          telefono={ctx.paciente.telefono}
          nombrePaciente={ctx.paciente.nombre ?? ""}
          modo={modoOperacion}
          onClose={() => setPagandoTramite(null)}
          onRegistroIncompleto={(msg) => {
            setPagandoTramite(null);
            setAlertaRegistro(msg);
            setBanner({ kind: "warn", text: msg });
            setEditandoPaciente(true);
          }}
          onPaid={async () => {
            setBanner({ kind: "ok", text: "Pago registrado en SWI." });
            await cargarContexto(ctx.paciente.telefono, false);
          }}
        />
      )}

      {showEncuesta && ctx && (
        <SwiSurveyModal
          telefono={ctx.paciente.telefono}
          tramiteId={encuestaTramiteId}
          onClose={() => setShowEncuesta(false)}
          onSubmitted={async () => {
            setBanner({ kind: "ok", text: "Encuesta de satisfacción enviada a SWI." });
            await cargarContexto(ctx.paciente.telefono, false);
          }}
        />
      )}
    </div>
  );
}
