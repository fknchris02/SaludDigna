"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

/** Teléfono + código (OTP). Si el teléfono es nuevo, pide nombre y fecha de nacimiento sin gastar el código. */
export function OtpLogin({ channel, title, description, onVerified }: {
  channel: "WEB" | "APP";
  title: string;
  description: string;
  onVerified: () => Promise<void> | void;
}) {
  const [telefono, setTelefono] = useState("");
  const [sent, setSent] = useState<{ telefono: string; demoCode: string } | null>(null);
  const [code, setCode] = useState("");
  const [needsProfile, setNeedsProfile] = useState(false);
  const [nombre, setNombre] = useState("");
  const [fechaNac, setFechaNac] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-600/40";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.body.needsProfile) setNeedsProfile(true);
      else setError(err instanceof ApiError ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  const request = () => run(async () => setSent(await api("/api/auth/otp/request", { body: { telefono, channel } })));
  const verify = () =>
    run(async () => {
      await api("/api/auth/otp/verify", { body: { telefono, code, channel, perfil: needsProfile ? { nombre, fechaNac } : undefined } });
      await onVerified();
    });

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-600 mt-1">{description}</p>
      </div>
      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); request(); }} className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-700">Teléfono celular (10 dígitos)</span>
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" autoComplete="tel" required placeholder="667 000 0001" className={input} />
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="rounded-lg bg-teal-700 text-white px-5 py-2.5 font-medium hover:bg-teal-800 disabled:opacity-60">
            {busy ? "Enviando…" : "Enviar código"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-3">
          <p className="text-sm text-slate-600">Enviamos un código a {sent.telefono}.</p>
          <p className="text-xs rounded-md bg-slate-100 text-slate-700 px-3 py-2">
            Demo sin SMS · tu código es <span className="font-mono font-semibold">{sent.demoCode}</span>
          </p>
          <label className="block text-sm">
            <span className="text-slate-700">Código de 6 dígitos</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" className={`${input} tracking-[0.4em] font-mono`} />
          </label>
          {needsProfile && (
            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
              <legend className="text-sm px-1 text-slate-700">Eres nuevo: completa tu registro</legend>
              <label className="block text-sm">
                <span className="text-slate-700">Nombre completo</span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoComplete="name" className={input} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Fecha de nacimiento</span>
                <input type="date" value={fechaNac} onChange={(e) => setFechaNac(e.target.value)} required autoComplete="bday" className={input} />
              </label>
            </fieldset>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-3 items-center">
            <button disabled={busy} className="rounded-lg bg-teal-700 text-white px-5 py-2.5 font-medium hover:bg-teal-800 disabled:opacity-60">
              {busy ? "Verificando…" : "Verificar"}
            </button>
            <button type="button" onClick={() => { setSent(null); setCode(""); }} className="text-sm text-slate-600 hover:underline">Cambiar teléfono</button>
          </div>
        </form>
      )}
    </div>
  );
}
