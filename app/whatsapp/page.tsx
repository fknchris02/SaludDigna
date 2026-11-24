"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Msg = { id: string; dir: "in" | "out"; text: string; options: string[] };

/** Simulador de WhatsApp: mismo backend que usará Twilio (handleInboundMessage). */
export default function WhatsAppSimulator() {
  const [phone, setPhone] = useState("667 000 0001");
  const [active, setActive] = useState("667 000 0001");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async (from: string) => {
    setError(null);
    const r = await fetch(`/api/whatsapp/simulator?from=${encodeURIComponent(from)}`);
    if (!r.ok) return setError("Número inválido");
    setMsgs((await r.json()).messages);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del historial
    load(active);
  }, [active, load]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  async function send(body: string) {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const temp: Msg = { id: `tmp-${Date.now()}`, dir: "in", text: body, options: [] };
    setMsgs((m) => [...m, temp]);
    setText("");
    try {
      const r = await fetch("/api/whatsapp/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: active, text: body, messageId: crypto.randomUUID() }),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Error");
      await load(active); // el historial del servidor es la fuente de verdad
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  const lastOptions = msgs.at(-1)?.dir === "out" ? msgs.at(-1)!.options : [];

  return (
    <main className="min-h-screen bg-[#d1d7db] flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] h-[min(780px,calc(100vh-2rem))] bg-[#efeae2] rounded-[2rem] shadow-2xl overflow-hidden flex flex-col border-8 border-neutral-900">
        <header className="bg-[#008069] text-white px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/90 text-[#008069] font-bold grid place-items-center text-sm" aria-hidden>SD</div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold leading-tight">Salud Digna</p>
            <p className="text-xs text-white/80">{busy ? "escribiendo…" : "Cuenta de empresa"}</p>
          </div>
        </header>

        <form
          className="bg-[#f0f2f5] px-3 py-2 flex gap-2 items-center text-sm border-b border-black/5"
          onSubmit={(e) => {
            e.preventDefault();
            setActive(phone);
          }}
        >
          <label htmlFor="phone" className="text-neutral-600 shrink-0">Desde</label>
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel"
            className="flex-1 min-w-0 rounded-md px-2 py-1 bg-white border border-black/10" />
          <button className="rounded-md px-2 py-1 bg-white border border-black/10 hover:bg-neutral-50">Usar</button>
        </form>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2" aria-live="polite">
          {msgs.length === 0 && <p className="text-center text-xs text-neutral-500 bg-white/70 rounded-md py-2 mx-8">Escribe “Hola” para empezar</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.dir === "in" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[14.5px] shadow-sm whitespace-pre-wrap break-words ${m.dir === "in" ? "bg-[#d9fdd3]" : "bg-white"}`}>
                <Rich text={m.text} />
                {m.options.length > 0 && (
                  <ol className="mt-1 text-neutral-700">
                    {m.options.map((o, i) => <li key={i}>{i + 1}. {o}</li>)}
                  </ol>
                )}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>

        {lastOptions.length > 0 && (
          <div className="px-3 pb-2 flex flex-wrap gap-2">
            {lastOptions.map((o, i) => (
              <button key={i} disabled={busy} onClick={() => send(String(i + 1))}
                className="bg-white text-[#008069] text-sm rounded-full px-3 py-1.5 shadow-sm hover:bg-neutral-50 disabled:opacity-50">
                {o}
              </button>
            ))}
          </div>
        )}

        {error && <p role="alert" className="text-xs text-red-700 bg-red-50 px-3 py-1">{error}</p>}

        <form className="bg-[#f0f2f5] p-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <label htmlFor="msg" className="sr-only">Mensaje</label>
          <input id="msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensaje" autoComplete="off"
            className="flex-1 rounded-full px-4 py-2 bg-white outline-none focus:ring-2 focus:ring-[#008069]/40" />
          <button disabled={busy || !text.trim()} aria-label="Enviar"
            className="w-10 h-10 rounded-full bg-[#008069] text-white grid place-items-center disabled:opacity-50">➤</button>
        </form>
      </div>
    </main>
  );
}

/** Formato de WhatsApp: *negritas*. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*[^*\n]+\*)/g).map((p, i) => (p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <strong key={i}>{p.slice(1, -1)}</strong> : p))}</>;
}
