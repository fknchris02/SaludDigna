"use client";

import { useState } from "react";
import type { SwiPaciente, SwiSeguridadVerificacion } from "@/lib/swi/types";

export function SwiSecurityCard({
  paciente,
  onUpdated,
}: {
  paciente: SwiPaciente;
  onUpdated: () => Promise<void> | void;
}) {
  const [pregunta, setPregunta] = useState(paciente.preguntaSeguridad ?? "");
  const [nuevaRespuesta, setNuevaRespuesta] = useState("");
  const [respuestaVerificar, setRespuestaVerificar] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/swi/pacientes/${encodeURIComponent(paciente.telefono)}/seguridad`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pregunta, respuesta: nuevaRespuesta, canal: "CLINICA" }),
      });
      const json = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setFeedback({ kind: "error", text: json.error ?? `Error HTTP ${r.status}` });
        return;
      }
      setNuevaRespuesta("");
      setFeedback({
        kind: "ok",
        text: "Pregunta de seguridad guardada (la respuesta se almacena cifrada en SWI).",
      });
      await onUpdated();
    } catch {
      setFeedback({ kind: "error", text: "Error de red al guardar la pregunta de seguridad." });
    } finally {
      setBusy(false);
    }
  }

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/swi/pacientes/${encodeURIComponent(paciente.telefono)}/seguridad`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ respuesta: respuestaVerificar, canal: "CLINICA" }),
      });
      const json = (await r.json().catch(() => ({}))) as Partial<SwiSeguridadVerificacion> & {
        error?: string;
      };
      if (!r.ok) {
        // Incluye 429 tras 3 errores en 15 minutos
        setFeedback({ kind: "error", text: json.error ?? `Error HTTP ${r.status}` });
        return;
      }
      setRespuestaVerificar("");
      if (json.correcta) {
        setFeedback({ kind: "ok", text: "✓ Identidad verificada correctamente." });
      } else {
        setFeedback({
          kind: "error",
          text: `Respuesta incorrecta. Intentos restantes: ${json.intentosRestantes ?? 0}.`,
        });
      }
      await onUpdated();
    } catch {
      setFeedback({ kind: "error", text: "Error de red al verificar la respuesta." });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/40";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Pregunta de seguridad</h3>
        {paciente.adultoMayor && (
          <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800">
            Adulto mayor (60+ años)
          </span>
        )}
      </div>

      {paciente.preguntaSeguridad ? (
        <form onSubmit={verificar} className="space-y-2 rounded-lg border border-teal-100 bg-teal-50/50 p-3">
          <p className="text-xs font-medium text-teal-900">Pregunta registrada:</p>
          <p className="text-sm font-medium text-slate-900">{paciente.preguntaSeguridad}</p>
          <div className="flex gap-2">
            <input
              value={respuestaVerificar}
              onChange={(e) => setRespuestaVerificar(e.target.value)}
              placeholder="Respuesta de la paciente"
              required
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              Verificar
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-slate-500">Esta paciente aún no tiene pregunta de seguridad registrada.</p>
      )}

      <form onSubmit={guardar} className="space-y-2 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium text-slate-600">
          {paciente.preguntaSeguridad ? "Actualizar pregunta de seguridad" : "Registrar pregunta de seguridad"}
        </p>
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          placeholder="Ej. ¿Cómo se llama tu primera mascota?"
          required
          className={input}
        />
        <input
          type="password"
          value={nuevaRespuesta}
          onChange={(e) => setNuevaRespuesta(e.target.value)}
          placeholder="Respuesta secreta (se guarda cifrada)"
          required
          className={input}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-teal-600 px-3.5 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60"
        >
          {busy ? "Guardando…" : "Guardar pregunta"}
        </button>
      </form>

      {feedback && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-xs ${
            feedback.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
