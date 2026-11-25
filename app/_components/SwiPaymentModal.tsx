"use client";

import { useState } from "react";
import {
  ETIQUETA_MARCA,
  TARJETAS_PRUEBA_SWI,
  detectarMarca,
  formatearNumeroTarjeta,
  formatearVencimiento,
  formatMoneyPesos,
  soloDigitos,
  validarTarjeta,
} from "@/lib/swi/helpers";
import type { SwiComprobante, SwiResultadoPago, SwiTramite } from "@/lib/swi/types";

type SwiPaymentModalProps = {
  tramite: SwiTramite;
  telefono: string;
  nombrePaciente: string;
  /** MOSTRADOR: quita opción de tarjeta y solo deja "Pagará en clínica". APP: permite tarjeta con canal "APP". */
  modo: "MOSTRADOR" | "APP";
  onClose: () => void;
  onPaid: (res: SwiResultadoPago) => Promise<void> | void;
  onRegistroIncompleto?: (mensaje: string) => void;
};

export function SwiPaymentModal({
  tramite,
  telefono,
  nombrePaciente,
  modo,
  onClose,
  onPaid,
  onRegistroIncompleto,
}: SwiPaymentModalProps) {
  const [numero, setNumero] = useState("");
  const [titular, setTitular] = useState(nombrePaciente);
  const [vencimiento, setVencimiento] = useState("");
  const [cvc, setCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comprobante, setComprobante] = useState<{
    res: SwiResultadoPago;
    datos: SwiComprobante;
  } | null>(null);

  const marca = detectarMarca(numero);

  function extractComprobante(res: SwiResultadoPago): SwiComprobante {
    return {
      folio: res.comprobante?.folio ?? res.tramite?.folio ?? tramite.folio,
      referencia: res.comprobante?.referencia ?? res.pago?.referencia ?? null,
      autorizacion: res.comprobante?.autorizacion ?? res.pago?.autorizacion ?? null,
      monto: res.comprobante?.monto ?? res.pago?.monto ?? tramite.estudio.precio,
      marca: res.comprobante?.marca ?? res.pago?.marca ?? null,
      ultimos4: res.comprobante?.ultimos4 ?? res.pago?.ultimos4 ?? null,
      metodo: res.comprobante?.metodo ?? res.pago?.metodo ?? "TARJETA",
      fecha: res.comprobante?.fecha ?? res.pago?.fecha ?? new Date().toISOString(),
      paciente: res.comprobante?.paciente ?? nombrePaciente,
      estudio: res.comprobante?.estudio ?? tramite.estudio.nombre,
      clinica: res.comprobante?.clinica ?? tramite.clinica?.nombre ?? null,
      ...(res.comprobante ?? {}),
    };
  }

  async function pagarTarjeta(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const errs = validarTarjeta({ numero, titular, vencimiento, cvc });
    const first = Object.values(errs)[0];
    if (first) return setError(first);

    setBusy(true);
    try {
      const r = await fetch(`/api/swi/tramites/${encodeURIComponent(tramite.id)}/pagos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metodo: "TARJETA",
          modo: "APP",
          tarjeta: {
            numero: soloDigitos(numero),
            titular: titular.trim(),
            vencimiento,
            cvc: soloDigitos(cvc),
          },
        }),
      });
      const json = (await r.json().catch(() => ({}))) as SwiResultadoPago & { error?: string };
      if (!r.ok) {
        setError(json.error ?? `Error al procesar pago (HTTP ${r.status}).`);
        return;
      }
      if (json.pago?.estado === "RECHAZADO") {
        setError(json.error ?? json.pago.mensaje ?? "Pago rechazado por el banco.");
        return;
      }
      setComprobante({ res: json, datos: extractComprobante(json) });
    } catch {
      setError("No se pudo conectar con SWI para procesar el pago.");
    } finally {
      setBusy(false);
    }
  }

  async function pagarEnClinica() {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/swi/tramites/${encodeURIComponent(tramite.id)}/pagos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metodo: "CLINICA",
          telefonoParaValidar: telefono,
        }),
      });
      const json = (await r.json().catch(() => ({}))) as SwiResultadoPago & {
        error?: string;
        registroCompleto?: boolean;
      };
      if (!r.ok) {
        const msg = json.error ?? `Error al registrar pago en clínica (HTTP ${r.status}).`;
        if (r.status === 400 && (json.registroCompleto === false || msg.toLowerCase().includes("completa su registro"))) {
          onRegistroIncompleto?.(msg);
        }
        setError(msg);
        return;
      }
      await onPaid(json);
    } catch {
      setError("No se pudo conectar con SWI para registrar el pago en clínica.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/40";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-teal-50 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {comprobante
                ? "Comprobante de pago aprobado"
                : modo === "MOSTRADOR"
                  ? "Registrar forma de pago (Mostrador)"
                  : `Pagar ${formatMoneyPesos(tramite.estudio.precio)}`}
            </h2>
            <p className="text-xs text-slate-600">
              {tramite.estudio.nombre} · <span className="font-mono">{tramite.folio}</span>
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (comprobante) await onPaid(comprobante.res);
              onClose();
            }}
            className="rounded-full bg-white px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {comprobante ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-800">✓ Pago aprobado</p>
                <p className="mt-1 text-2xl font-bold text-emerald-900">
                  {formatMoneyPesos(Number(comprobante.datos.monto ?? tramite.estudio.precio))}
                </p>
              </div>
              <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                {comprobante.datos.folio && (
                  <Row label="Folio" value={String(comprobante.datos.folio)} mono />
                )}
                {comprobante.datos.referencia && (
                  <Row label="Referencia" value={String(comprobante.datos.referencia)} mono />
                )}
                {comprobante.datos.autorizacion && (
                  <Row label="Autorización" value={String(comprobante.datos.autorizacion)} mono />
                )}
                {comprobante.datos.paciente && (
                  <Row label="Paciente" value={String(comprobante.datos.paciente)} />
                )}
                {comprobante.datos.estudio && (
                  <Row label="Estudio" value={String(comprobante.datos.estudio)} />
                )}
                {comprobante.datos.clinica && (
                  <Row label="Clínica" value={String(comprobante.datos.clinica)} />
                )}
                {(comprobante.datos.marca || comprobante.datos.ultimos4) && (
                  <Row
                    label="Tarjeta"
                    value={`${comprobante.datos.marca ?? "Tarjeta"}${comprobante.datos.ultimos4 ? ` ···${comprobante.datos.ultimos4}` : ""}`}
                    mono
                  />
                )}
                {comprobante.datos.fecha && (
                  <Row
                    label="Fecha"
                    value={new Date(String(comprobante.datos.fecha)).toLocaleString("es-MX")}
                  />
                )}
              </dl>
              <button
                type="button"
                onClick={async () => {
                  await onPaid(comprobante.res);
                  onClose();
                }}
                className="w-full rounded-lg bg-teal-700 py-2.5 text-sm font-medium text-white hover:bg-teal-800"
              >
                Cerrar comprobante
              </button>
            </div>
          ) : modo === "MOSTRADOR" ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                En modo mostrador / recepción el cobro con tarjeta en línea está deshabilitado por regla de
                SWI (<code className="font-mono text-xs">canal: &quot;CLINICA&quot;</code>). Registra el
                pago en clínica para este trámite.
              </p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm flex items-baseline justify-between">
                <span className="text-slate-600">Total a cobrar en clínica</span>
                <span className="text-lg font-semibold text-slate-900">
                  {formatMoneyPesos(tramite.estudio.precio)}
                </span>
              </div>
              {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={pagarEnClinica}
                className="w-full rounded-lg bg-teal-700 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {busy ? "Registrando…" : "Pagará en clínica"}
              </button>
            </div>
          ) : (
            <form onSubmit={pagarTarjeta} className="space-y-3.5">
              <p className="text-xs rounded-md bg-teal-50 text-teal-900 border border-teal-100 px-3 py-2">
                Modo celular de la paciente: esta petición envía <code className="font-mono">canal: &quot;APP&quot;</code>.
              </p>

              <label className="block text-sm">
                <span className="flex justify-between font-medium text-slate-700">
                  <span>Número de tarjeta</span>
                  {soloDigitos(numero).length >= 2 && (
                    <span className="text-xs text-teal-800">{ETIQUETA_MARCA[marca]}</span>
                  )}
                </span>
                <input
                  value={formatearNumeroTarjeta(numero)}
                  onChange={(e) => setNumero(soloDigitos(e.target.value).slice(0, 19))}
                  placeholder="4242 4242 4242 4242"
                  inputMode="numeric"
                  required
                  className={`${input} font-mono`}
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">Titular</span>
                <input
                  value={titular}
                  onChange={(e) => setTitular(e.target.value)}
                  required
                  className={input}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Vencimiento (MM/AA)</span>
                  <input
                    value={vencimiento}
                    onChange={(e) => setVencimiento(formatearVencimiento(e.target.value))}
                    placeholder="12/30"
                    maxLength={5}
                    required
                    className={`${input} font-mono`}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">CVC</span>
                  <input
                    value={cvc}
                    onChange={(e) => setCvc(soloDigitos(e.target.value).slice(0, 4))}
                    placeholder="123"
                    maxLength={4}
                    required
                    className={`${input} font-mono`}
                  />
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-xs font-medium text-slate-600 mb-1.5">Tarjetas de prueba SWI:</p>
                <div className="flex flex-wrap gap-1.5">
                  {TARJETAS_PRUEBA_SWI.map((t) => (
                    <button
                      key={t.numero}
                      type="button"
                      onClick={() => {
                        setNumero(t.numero);
                        setVencimiento("12/30");
                        setCvc(t.marca === "amex" ? "1234" : "123");
                        setError(null);
                      }}
                      className={`rounded border px-2 py-1 text-xs ${
                        t.rechazo
                          ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
                          : "border-teal-200 bg-white text-teal-800 hover:bg-teal-50"
                      }`}
                    >
                      {t.descripcion}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-teal-700 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {busy ? "Procesando pago…" : `Pagar ${formatMoneyPesos(tramite.estudio.precio)}`}
              </button>

              {tramite.pago?.estado !== "EN_CLINICA" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={pagarEnClinica}
                  className="w-full rounded-lg border border-teal-600 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60"
                >
                  Pagará en clínica
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3.5 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right font-medium text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
