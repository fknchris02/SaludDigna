"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

export default function StaffLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("asesor@demo.mx");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ role: string }>("/api/auth/staff/login", { body: { email, password } });
      router.replace(r.role === "ADMIN" ? "/admin" : "/asesor");
      // Next conserva el estado de esta página al volver (p. ej. tras "Salir"): dejar el formulario listo y sin la contraseña.
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-100 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-teal-700 uppercase">Salud Digna · Call Center</p>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">Iniciar sesión</h1>
        </div>
        <label className="block text-sm">
          <span className="text-slate-700">Correo</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600/40" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Contraseña</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600/40" />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-md bg-teal-700 text-white py-2 font-medium hover:bg-teal-800 disabled:opacity-60">
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <p className="text-xs text-slate-500">Demo: asesor@demo.mx / asesor123 · admin@demo.mx / admin123</p>
      </form>
    </main>
  );
}
