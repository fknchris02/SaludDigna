"use client";

import { useState } from "react";

export function SwiSurveyModal({
  telefono,
  tramiteId,
  onClose,
  onSubmitted,
}: {
  telefono: string;
  tramiteId?: string;
  onClose: () => void;
  onSubmitted: () => Promise<void> | void;
}) {
  const [puntaje, setPuntaje] = useState<number>(5);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const motivoObligatorio = puntaje < 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (motivoObligatorio && !motivo.trim()) {
      return setError("Con puntaje menor a 3, el motivo es obligatorio.");
    }
    setBusy(true);
    try {
      const r = await fetch("/api/swi/encuestas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          telefono,
          puntaje,
          ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
          ...(tramiteId ? { tramiteId } : {}),
          canal: "CLINICA",
        }),
      });
      const json = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(json.error ?? `Error HTTP ${r.status}`);
        return;
      }
      await onSubmitted();
      onClose();
    } catch {
      setError("No se pudo enviar la encuesta a SWI.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Encuesta de satisfacción</h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div>
          <p className="text-sm text-slate-600 mb-2">¿Cómo califica la atención recibida? (1 a 5)</p>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPuntaje(n)}
                className={`rounded-xl border py-2.5 text-base font-semibold ${
                  puntaje === n
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-teal-50"
                }`}
              >
                {n} ★
              </button>
            ))}
          </div>
        </div>

        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            Motivo / comentarios {motivoObligatorio ? "*" : "(opcional)"}
          </span>
          <textarea
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required={motivoObligatorio}
            placeholder={
              motivoObligatorio
                ? "Cuéntanos qué ocurrió (obligatorio para calificaciones menores a 3)"
                : "Comentarios adicionales (opcional)"
            }
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/40"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? "Enviando…" : "Enviar encuesta"}
          </button>
        </div>
      </form>
    </div>
  );
}
