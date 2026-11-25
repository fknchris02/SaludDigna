import type { Sexo } from "../types/swi";

export const ENTIDADES: Record<string, string> = {
  AS: "Aguascalientes",
  BC: "Baja California",
  BS: "Baja California Sur",
  CC: "Campeche",
  CL: "Coahuila",
  CM: "Colima",
  CS: "Chiapas",
  CH: "Chihuahua",
  DF: "Ciudad de México",
  DG: "Durango",
  GT: "Guanajuato",
  GR: "Guerrero",
  HG: "Hidalgo",
  JC: "Jalisco",
  MC: "Estado de México",
  MN: "Michoacán",
  MS: "Morelos",
  NT: "Nayarit",
  NL: "Nuevo León",
  OC: "Oaxaca",
  PL: "Puebla",
  QT: "Querétaro",
  QR: "Quintana Roo",
  SP: "San Luis Potosí",
  SL: "Sinaloa",
  SR: "Sonora",
  TC: "Tabasco",
  TS: "Tamaulipas",
  TL: "Tlaxcala",
  VZ: "Veracruz",
  YN: "Yucatán",
  ZS: "Zacatecas",
  NE: "Nacido en el extranjero",
};

export const OPCIONES_ENTIDAD: [string, string][] = Object.entries(ENTIDADES)
  .filter(([c]) => c !== "NE")
  .sort((a, b) => a[1].localeCompare(b[1], "es"))
  .concat([["NE", ENTIDADES.NE]]);

export const ETIQUETA_SEXO: Record<Sexo, string> = { H: "Hombre", M: "Mujer" };

export type DatosCurp = {
  nombres: string;
  primerApellido: string;
  segundoApellido?: string | null;
  fechaNacimiento: string; // YYYY-MM-DD
  sexo: Sexo;
  entidad: string;
};

const ALTISONANTES = new Set(
  "BACA BAKA BUEI BUEY CACA CACO CAGA CAGO CAKA CAKO COGE COGI COJA COJE COJI COJO COLA CULO FALO FETO GETA GUEI GUEY JETA JOTO KACA KACO KAGA KAGO KAKA KAKO KOGE KOGI KOJA KOJE KOJI KOJO KOLA KULO LILO LOCA LOCO LOKA LOKO MAME MAMO MEAR MEAS MEON MIAR MION MOCO MOKO MULA MULO NACA NACO PEDA PEDO PENE PIPI PITO POPO PUTA PUTO QULO RATA ROBA ROBE ROBO RUIN SENO TETA VACA VAGA VAGO VAKA VUEI VUEY WUEI WUEY".split(
    " ",
  ),
);
const PARTICULAS = new Set([
  "DA",
  "DAS",
  "DE",
  "DEL",
  "DER",
  "DI",
  "DIE",
  "DD",
  "EL",
  "LA",
  "LOS",
  "LAS",
  "LE",
  "LES",
  "MAC",
  "MC",
  "VAN",
  "VON",
  "Y",
]);
const NOMBRES_COMUNES = new Set(["MARIA", "MA", "MA.", "M", "JOSE", "J", "J."]);
const VOCALES = "AEIOU";
const DICCIONARIO = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

export function normalizarTexto(texto: string): string {
  return (texto || "")
    .toUpperCase()
    .replace(/Ñ/g, "X")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sinParticulas(texto: string): string {
  const palabras = normalizarTexto(texto).split(" ").filter(Boolean);
  const utiles = palabras.filter((p) => !PARTICULAS.has(p));
  return (utiles.length ? utiles : palabras).join(" ");
}

function nombreParaCurp(nombres: string): string {
  const palabras = sinParticulas(nombres).split(" ").filter(Boolean);
  if (palabras.length > 1 && NOMBRES_COMUNES.has(palabras[0])) return palabras.slice(1).join(" ");
  return palabras.join(" ");
}

const primeraVocalInterna = (s: string) => [...s.slice(1)].find((c) => VOCALES.includes(c)) ?? "X";
const primeraConsonanteInterna = (s: string) =>
  [...s.slice(1)].find((c) => /[A-Z]/.test(c) && !VOCALES.includes(c)) ?? "X";

export function digitoVerificador(curp17: string): string {
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += DICCIONARIO.indexOf(curp17[i]) * (18 - i);
  return String((10 - (suma % 10)) % 10);
}

export function generarCurp(d: DatosCurp): { curp16: string; curp: string } | null {
  const ap1 = sinParticulas(d.primerApellido).split(" ")[0] ?? "";
  const ap2 = d.segundoApellido ? (sinParticulas(d.segundoApellido).split(" ")[0] ?? "") : "";
  const nom = nombreParaCurp(d.nombres).split(" ")[0] ?? "";
  const fecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.fechaNacimiento);
  if (!ap1 || !nom || !fecha || !ENTIDADES[d.entidad] || (d.sexo !== "H" && d.sexo !== "M")) {
    return null;
  }

  let iniciales = ap1[0] + primeraVocalInterna(ap1) + (ap2 ? ap2[0] : "X") + nom[0];
  if (ALTISONANTES.has(iniciales)) iniciales = iniciales[0] + "X" + iniciales.slice(2);

  const [, anio, mes, dia] = fecha;
  const curp16 =
    iniciales +
    anio.slice(2) +
    mes +
    dia +
    d.sexo +
    d.entidad +
    primeraConsonanteInterna(ap1) +
    (ap2 ? primeraConsonanteInterna(ap2) : "X") +
    primeraConsonanteInterna(nom);
  const homoclave = Number(anio) < 2000 ? "0" : "A";
  const curp17 = curp16 + homoclave;
  return { curp16, curp: curp17 + digitoVerificador(curp17) };
}

const PATRON =
  /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]\d$/;

export function validarCurp(curp: string): { valida: boolean; motivo?: string } {
  const c = (curp || "").toUpperCase().trim();
  if (c.length !== 18) return { valida: false, motivo: "La CURP tiene 18 caracteres." };
  if (!PATRON.test(c)) return { valida: false, motivo: "El formato de la CURP no es válido." };
  if (digitoVerificador(c.slice(0, 17)) !== c[17]) {
    return {
      valida: false,
      motivo: "El dígito verificador no coincide; revisa que esté bien escrita.",
    };
  }
  return { valida: true };
}

export function leerCurp(curp: string): { fechaNacimiento: string; sexo: Sexo; entidad: string } | null {
  const c = curp.toUpperCase();
  if (!PATRON.test(c)) return null;
  const yy = Number(c.slice(4, 6));
  const siglo = /\d/.test(c[16]) ? 1900 : 2000;
  return {
    fechaNacimiento: `${siglo + yy}-${c.slice(6, 8)}-${c.slice(8, 10)}`,
    sexo: c[10] as Sexo,
    entidad: c.slice(11, 13),
  };
}
