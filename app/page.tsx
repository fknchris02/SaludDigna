import Link from "next/link";

const CHANNELS = [
  { href: "/whatsapp", title: "WhatsApp", desc: "Simulador del canal de WhatsApp (paciente)", ready: true },
  { href: "/asesor", title: "Call Center", desc: "Consola del asesor con contexto y línea de tiempo", ready: true },
  { href: "/web", title: "Sitio Web", desc: "Cotizar y agendar (paciente)", ready: false },
  { href: "/app", title: "App", desc: "Citas e historial (paciente)", ready: false },
  { href: "/admin", title: "Administrador", desc: "Tablero del patient journey en tiempo real", ready: false },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <p className="text-xs font-semibold tracking-wide text-teal-700 uppercase">Salud Digna · Omnicanal</p>
        <h1 className="text-2xl font-semibold text-slate-900 mt-1">Un paciente, una sola conversación</h1>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {CHANNELS.map((c) => (
            <li key={c.href}>
              {c.ready ? (
                <Link href={c.href} className="block h-full rounded-xl bg-white border border-slate-200 p-4 hover:border-teal-600">
                  <span className="font-medium text-slate-900">{c.title}</span>
                  <span className="block text-sm text-slate-600 mt-1">{c.desc}</span>
                </Link>
              ) : (
                <div className="h-full rounded-xl bg-white/60 border border-dashed border-slate-300 p-4 text-slate-500">
                  <span className="font-medium">{c.title}</span> <span className="text-xs">(próximamente)</span>
                  <span className="block text-sm mt-1">{c.desc}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
