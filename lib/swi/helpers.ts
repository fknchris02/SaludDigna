import { SWI_ENTIDADES, type SwiDatosTarjeta, type SwiHorarios, type SwiSexo } from "./types";

// ───────────────────────── CURP ─────────────────────────

const PATRON_CURP =
  /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]\d$/;

const DICCIONARIO = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

export function digitoVerificadorCurp(curp17: string): string {
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += DICCIONARIO.indexOf(curp17[i]) * (18 - i);
  return String((10 - (suma % 10)) % 10);
}

export function validarCurp(curp: string): { valida: boolean; motivo?: string } {
  const c = (curp || "").toUpperCase().trim();
  if (c.length !== 18) return { valida: false, motivo: "La CURP debe tener 18 caracteres." };
  if (!PATRON_CURP.test(c)) return { valida: false, motivo: "El formato de la CURP no es válido." };
  if (digitoVerificadorCurp(c.slice(0, 17)) !== c[17]) {
    return { valida: false, motivo: "El dígito verificador de la CURP no coincide." };
  }
  return { valida: true };
}

export function leerCurp(curp: string): { fechaNacimiento: string; sexo: SwiSexo; entidad: string } | null {
  const c = (curp || "").toUpperCase().trim();
  if (!PATRON_CURP.test(c)) return null;
  const yy = Number(c.slice(4, 6));
  const siglo = /\d/.test(c[16]) ? 1900 : 2000;
  const entidad = c.slice(11, 13);
  if (!SWI_ENTIDADES[entidad]) return null;
  return {
    fechaNacimiento: `${siglo + yy}-${c.slice(6, 8)}-${c.slice(8, 10)}`,
    sexo: c[10] as SwiSexo,
    entidad,
  };
}

// ───────────────────────── Tarjetas ─────────────────────────

export type MarcaTarjeta = "visa" | "mastercard" | "amex" | "desconocida";

export const ETIQUETA_MARCA: Record<MarcaTarjeta, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  desconocida: "Tarjeta",
};

export const TARJETAS_PRUEBA_SWI = [
  { numero: "4242424242424242", marca: "visa" as MarcaTarjeta, descripcion: "Visa · aprobada", rechazo: false },
  { numero: "5555555555554444", marca: "mastercard" as MarcaTarjeta, descripcion: "Mastercard · aprobada", rechazo: false },
  { numero: "378282246310005", marca: "amex" as MarcaTarjeta, descripcion: "Amex · aprobada", rechazo: false },
  { numero: "4000000000000002", marca: "visa" as MarcaTarjeta, descripcion: "Rechazo genérico", rechazo: true },
  { numero: "4000000000009995", marca: "visa" as MarcaTarjeta, descripcion: "Fondos insuficientes", rechazo: true },
];

export const soloDigitos = (s: string) => (s || "").replace(/\D/g, "");

export function detectarMarca(numero: string): MarcaTarjeta {
  const n = soloDigitos(numero);
  if (/^4/.test(n)) return "visa";
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/.test(n)) return "mastercard";
  if (/^3[47]/.test(n)) return "amex";
  return "desconocida";
}

export function luhn(numero: string): boolean {
  const n = soloDigitos(numero);
  if (n.length < 12) return false;
  let suma = 0;
  let doble = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (doble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

export function formatearNumeroTarjeta(numero: string): string {
  const marca = detectarMarca(numero);
  const n = soloDigitos(numero).slice(0, marca === "amex" ? 15 : 16);
  if (marca === "amex") {
    return [n.slice(0, 4), n.slice(4, 10), n.slice(10, 15)].filter(Boolean).join(" ");
  }
  return n.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function formatearVencimiento(valor: string): string {
  const d = soloDigitos(valor).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function validarTarjeta(
  t: SwiDatosTarjeta,
  hoy = new Date(),
): Partial<Record<keyof SwiDatosTarjeta, string>> {
  const errores: Partial<Record<keyof SwiDatosTarjeta, string>> = {};
  const n = soloDigitos(t.numero);
  const marca = detectarMarca(n);
  const largo = marca === "amex" ? 15 : 16;
  if (n.length !== largo || !luhn(n)) errores.numero = "El número de tarjeta no es válido.";
  else if (marca === "desconocida") errores.numero = "Solo se aceptan Visa, Mastercard y Amex.";
  if (!t.titular.trim()) errores.titular = "Escribe el nombre del titular.";
  const m = /^(\d{2})\/(\d{2})$/.exec(t.vencimiento);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) {
    errores.vencimiento = "Usa el formato MM/AA.";
  } else {
    const fin = new Date(2000 + Number(m[2]), Number(m[1]), 1);
    if (fin <= hoy) errores.vencimiento = "La tarjeta está vencida.";
  }
  const cvc = soloDigitos(t.cvc);
  if (cvc.length !== (marca === "amex" ? 4 : 3)) {
    errores.cvc = marca === "amex" ? "El CVC de Amex tiene 4 dígitos." : "El CVC tiene 3 dígitos.";
  }
  return errores;
}

// ───────────────────────── Horarios CDMX ─────────────────────────

const ZONA_HORARIA = "America/Mexico_City";

export type DiaDisponible = {
  fecha: string;
  etiqueta: string;
  horas: string[];
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export function fechaLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function aFechaCDMX(fechaISO: string, hora: string): Date {
  return new Date(`${fechaISO}T${hora}:00-06:00`);
}

export function espaciosDisponiblesClinica(
  horarios?: SwiHorarios | null,
  dias = 5,
  ahora = new Date(),
): DiaDisponible[] {
  const defaultHorarios: SwiHorarios = {
    "0": null,
    "1": ["07:00", "17:00"],
    "2": ["07:00", "17:00"],
    "3": ["07:00", "17:00"],
    "4": ["07:00", "17:00"],
    "5": ["07:00", "17:00"],
    "6": ["07:00", "13:00"],
  };
  const h = horarios && Object.keys(horarios).length > 0 ? horarios : defaultHorarios;
  const minMs = ahora.getTime() + 60 * 60_000;
  const res: DiaDisponible[] = [];
  const cursor = new Date(ahora);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < 21 && res.length < dias; i++) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() + i);
    const tramo = h[String(d.getDay())];
    if (!tramo) continue;
    const [aH, aM] = tramo[0].split(":").map(Number);
    const [cH, cM] = tramo[1].split(":").map(Number);
    const inicio = aH * 60 + aM;
    const fin = cH * 60 + cM;
    const fecha = fechaLocalIso(d);
    const horas: string[] = [];
    for (let m = inicio; m + 30 <= fin; m += 30) {
      const hhmm = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
      if (aFechaCDMX(fecha, hhmm).getTime() >= minMs) horas.push(hhmm);
    }
    if (horas.length > 0) {
      const etiqueta = new Intl.DateTimeFormat("es-MX", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: ZONA_HORARIA,
      }).format(aFechaCDMX(fecha, "12:00"));
      res.push({ fecha, etiqueta, horas });
    }
  }
  return res;
}

export function formatMoneyPesos(pesos: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(pesos);
}
