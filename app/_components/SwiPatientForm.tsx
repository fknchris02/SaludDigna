"use client";

import { useState } from "react";
import { leerCurp, validarCurp } from "@/lib/swi/helpers";
import {
  OPCIONES_ENTIDAD,
  OPCIONES_PARENTESCO,
  SWI_ENTIDADES,
  normalizarTelefonoSwi,
  type ContactoParentesco,
  type SwiPaciente,
  type SwiSexo,
} from "@/lib/swi/types";

export type SwiPatientFormProps = {
  telefonoInicial: string;
  paciente?: SwiPaciente | null;
  alerta?: string | null;
  onSaved: (paciente?: SwiPaciente) => Promise<void> | void;
  onCancel?: () => void;
};

export function SwiPatientForm({
  telefonoInicial,
  paciente,
  alerta,
  onSaved,
  onCancel,
}: SwiPatientFormProps) {
  const [telefono, setTelefono] = useState(
    normalizarTelefonoSwi(paciente?.telefono ?? telefonoInicial) ?? telefonoInicial,
  );
  const [curp, setCurp] = useState(paciente?.curp ?? "");
  const [nombres, setNombres] = useState(paciente?.nombres ?? "");
  const [primerApellido, setPrimerApellido] = useState(paciente?.primerApellido ?? "");
  const [segundoApellido, setSegundoApellido] = useState(paciente?.segundoApellido ?? "");
  const [fechaNacimiento, setFechaNacimiento] = useState(
    paciente?.fechaNacimiento ? paciente.fechaNacimiento.slice(0, 10) : "",
  );
  const [sexo, setSexo] = useState<"" | SwiSexo>(paciente?.sexo ?? "");
  const [entidad, setEntidad] = useState(paciente?.entidadNacimiento ?? paciente?.entidad ?? "");
  const [email, setEmail] = useState(paciente?.email ?? "");
  const [telefonoFijo, setTelefonoFijo] = useState(paciente?.telefonoFijo ?? "");
  const [contactoNombre, setContactoNombre] = useState(paciente?.contactoNombre ?? "");
  const [contactoTelefono, setContactoTelefono] = useState(paciente?.contactoTelefono ?? "");
  const [contactoParentesco, setContactoParentesco] = useState<"" | ContactoParentesco>(
    paciente?.contactoParentesco ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const curpClean = curp.trim().toUpperCase();
  const curpCheck = curpClean.length === 18 ? validarCurp(curpClean) : null;

  function onCurpChange(raw: string) {
    const clean = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 18);
    setCurp(clean);
    if (clean.length === 18) {
      const parsed = leerCurp(clean);
      if (parsed) {
        setFechaNacimiento(parsed.fechaNacimiento);
        setSexo(parsed.sexo);
        setEntidad(parsed.entidad);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const tel = normalizarTelefonoSwi(telefono);
    if (!tel) return setError("El celular debe tener 10 dígitos.");
    const fijo = normalizarTelefonoSwi(telefonoFijo);
    if (!fijo) return setError("El teléfono fijo debe tener 10 dígitos.");
    const famTel = normalizarTelefonoSwi(contactoTelefono);
    if (!famTel) return setError("El teléfono del familiar debe tener 10 dígitos.");
    if (!sexo) return setError("Selecciona el sexo.");
    if (!entidad) return setError("Selecciona el estado de nacimiento.");
    if (!contactoParentesco) return setError("Selecciona el parentesco del familiar.");
    if (curpClean && !validarCurp(curpClean).valida) {
      return setError(validarCurp(curpClean).motivo ?? "CURP inválida.");
    }

    setBusy(true);
    try {
      const res = await fetch("/api/swi/pacientes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          telefono: tel,
          nombres: nombres.trim(),
          primerApellido: primerApellido.trim(),
          segundoApellido: segundoApellido.trim(),
          fechaNacimiento,
          sexo,
          entidad,
          ...(curpClean ? { curp: curpClean } : {}),
          email: email.trim(),
          telefonoFijo: fijo,
          contactoNombre: contactoNombre.trim(),
          contactoTelefono: famTel,
          contactoParentesco,
          canal: "CLINICA",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        paciente?: SwiPaciente;
      };
      if (!res.ok) {
        setError(json.error ?? `Error al guardar el registro (HTTP ${res.status}).`);
        return;
      }
      await onSaved(json.paciente);
    } catch {
      setError("No se pudo conectar con el servidor para guardar los datos.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/40";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {alerta && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"
        >
          {alerta}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Teléfono celular (10 dígitos) *</span>
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.replace(/\D/g, "").slice(0, 10))}
            required
            inputMode="tel"
            placeholder="6670000001"
            className={`${input} font-mono`}
          />
        </label>

        <label className="text-sm">
          <span className="font-medium text-slate-700">
            CURP <span className="font-normal text-slate-500">(opcional)</span>
          </span>
          <input
            value={curp}
            onChange={(e) => onCurpChange(e.target.value)}
            maxLength={18}
            placeholder="18 caracteres (autocompleta datos)"
            className={`${input} font-mono uppercase`}
          />
          {curpCheck && !curpCheck.valida && (
            <span className="mt-0.5 block text-xs text-red-700">{curpCheck.motivo}</span>
          )}
          {curpCheck?.valida && entidad && (
            <span className="mt-0.5 block text-xs text-teal-700">
              ✓ {fechaNacimiento} · {sexo === "M" ? "Mujer" : "Hombre"} · {SWI_ENTIDADES[entidad]}
            </span>
          )}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Nombre(s) *</span>
          <input value={nombres} onChange={(e) => setNombres(e.target.value)} required className={input} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Primer apellido *</span>
          <input
            value={primerApellido}
            onChange={(e) => setPrimerApellido(e.target.value)}
            required
            className={input}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Segundo apellido *</span>
          <input
            value={segundoApellido}
            onChange={(e) => setSegundoApellido(e.target.value)}
            required
            className={input}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Fecha de nacimiento *</span>
          <input
            type="date"
            value={fechaNacimiento}
            onChange={(e) => setFechaNacimiento(e.target.value)}
            required
            className={input}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Sexo *</span>
          <select
            value={sexo}
            onChange={(e) => setSexo(e.target.value as "" | SwiSexo)}
            required
            className={input}
          >
            <option value="">Selecciona…</option>
            <option value="M">Mujer</option>
            <option value="H">Hombre</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Estado de nacimiento *</span>
          <select
            value={entidad}
            onChange={(e) => setEntidad(e.target.value)}
            required
            className={input}
          >
            <option value="">Selecciona el estado…</option>
            {OPCIONES_ENTIDAD.map(([clave, nombre]) => (
              <option key={clave} value={clave}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Correo electrónico *</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="nombre@correo.com"
            className={input}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Teléfono fijo (10 dígitos) *</span>
          <input
            value={telefonoFijo}
            onChange={(e) => setTelefonoFijo(e.target.value.replace(/\D/g, "").slice(0, 10))}
            required
            inputMode="tel"
            placeholder="6671234567"
            className={`${input} font-mono`}
          />
        </label>
      </div>

      <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          Familiar o contacto de emergencia
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="font-medium text-slate-700">Nombre del familiar *</span>
            <input
              value={contactoNombre}
              onChange={(e) => setContactoNombre(e.target.value)}
              required
              placeholder="Nombre completo"
              className={input}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-700">Parentesco *</span>
            <select
              value={contactoParentesco}
              onChange={(e) => setContactoParentesco(e.target.value as "" | ContactoParentesco)}
              required
              className={input}
            >
              <option value="">¿Qué es de la paciente?</option>
              {OPCIONES_PARENTESCO.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-700">Teléfono del familiar *</span>
            <input
              value={contactoTelefono}
              onChange={(e) => setContactoTelefono(e.target.value.replace(/\D/g, "").slice(0, 10))}
              required
              inputMode="tel"
              placeholder="6670000000"
              className={`${input} font-mono`}
            />
          </label>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {busy ? "Guardando en SWI…" : paciente ? "Guardar y actualizar datos" : "Registrar paciente"}
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
