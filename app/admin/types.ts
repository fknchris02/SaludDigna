import type { Ev } from "@/app/_components/Timeline";
import type { JourneyStatus } from "./JourneyGraph";

export type Journey = {
  caseId: string;
  paciente: string | null;
  estudio: string | null;
  clinica: string | null;
  folio: string | null;
  step: string;
  status: JourneyStatus;
  channels: string[];
  lastChannel: string;
  updatedAt: string;
};
export type Overview = {
  kpis: { open: number; paused: number; confirmed24h: number; switches24h: number; conflicts24h: number; multichannelPct: number };
  steps: Record<string, number>;
  transitions: Record<string, Record<string, number>>;
  channels: string[];
  journeys: Journey[];
  audit: { seq: string; type: string; createdAt: string; staff: { nombre: string; role: string } | null; paciente: string | null; payload: Record<string, unknown> }[];
  recent: Ev[];
};
// Trámites recibidos de SWI (GET /api/integraciones/swi/resumen), ya en formato de recorrido.
export type SwiOverview = {
  kpis: { open: number; paused: number; confirmed24h: number; switches24h: number; multichannel: number; total: number };
  steps: Record<string, number>;
  transitions: Record<string, Record<string, number>>;
  journeys: Journey[];
};
