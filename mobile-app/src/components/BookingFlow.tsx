import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  WIZARD_STEPS,
  splitContextoTramites,
  viewForTramite,
  wizardIndexFor,
  type BookingView,
} from "../lib/bookingState";
import {
  CANAL_NOMBRE,
  ESTADOS_EN_CURSO,
  esRegistroCompleto,
  etiquetaParentesco,
  mensajeRegistroIncompleto,
} from "../lib/constantes";
import { formatDate, formatMoney } from "../lib/format";
import { aFechaCDMX, espaciosDisponibles, fechaLocal } from "../lib/horarios";
import {
  SwiError,
  avanzarTramite,
  crearTramite,
  getClinicas,
  getContexto,
  getEstudios,
  marcarPagoEnClinica,
  registrarPaciente,
} from "../lib/swiApi";
import { COLORS } from "../theme/tokens";
import type { Clinica, Contexto, Estudio, Tramite } from "../types/swi";
import {
  PatientRegistrationFields,
  createInitialRegistro,
  validateRegistroValues,
  type RegistroFormValues,
} from "./PatientRegistrationFields";
import { PaymentModal } from "./PaymentModal";

/**
 * Flujo de agendado compartido con la misma estética y reglas de SaludDigna/BookingFlow.tsx,
 * conectado a la máquina de estados y pagos de SWI-Salud Digna (canal: APP).
 */
export function BookingFlow({
  ctx,
  onReload,
}: {
  ctx: Contexto;
  onReload: () => Promise<Contexto | null>;
}) {
  const [estudios, setEstudios] = useState<Estudio[] | null>(null);
  const [clinicas, setClinicas] = useState<Clinica[] | null>(null);
  const [editing, setEditing] = useState<BookingView | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Tramite | null>(null);
  const [paying, setPaying] = useState<Tramite | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [registro, setRegistro] = useState<RegistroFormValues>(() =>
    createInitialRegistro(ctx.paciente),
  );

  const seenChannel = useRef<string | null>(null);
  const lastActiveId = useRef<string | null>(null);

  const { active } = useMemo(() => splitContextoTramites(ctx), [ctx]);

  // Cargar catálogo público desde SWI
  useEffect(() => {
    let mounted = true;
    Promise.all([getEstudios(), getClinicas()])
      .then(([e, c]) => {
        if (!mounted) return;
        setEstudios(e);
        setClinicas(c);
      })
      .catch((err) => {
        if (!mounted) return;
        setBanner(
          err instanceof SwiError
            ? err.message
            : "No se pudo cargar el catálogo de estudios y clínicas.",
        );
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Sincronización en vivo: detectar si otro canal retomó, confirmó o canceló el trámite.
  useEffect(() => {
    if (!active && lastActiveId.current && !done) {
      const closed = ctx.tramites.find((t) => t.id === lastActiveId.current);
      if (
        closed &&
        (closed.estado === "AGENDADO" ||
          closed.estado === "CONFIRMADO" ||
          closed.estado === "CANCELADO")
      ) {
        setDone(closed);
        setBanner(null);
      }
    }
    lastActiveId.current = active?.id ?? null;

    if (
      active &&
      active.canalActual !== "APP" &&
      seenChannel.current !== active.canalActual &&
      ESTADOS_EN_CURSO.includes(active.estado)
    ) {
      setBanner(
        `Retomamos tu trámite donde lo dejaste en ${CANAL_NOMBRE[active.canalActual] ?? active.canalActual}. No tienes que repetir nada.`,
      );
    }
    seenChannel.current = active?.canalActual ?? null;
  }, [active, ctx.tramites, done]);

  const currentTramite = done ?? active;
  const view: BookingView = done
    ? "LISTO"
    : editing ?? viewForTramite(active, ctx.paciente);
  const wizardIndex = wizardIndexFor(view);

  const selectedClinicObj = useMemo(() => {
    if (!clinicas || !currentTramite?.clinica?.id) return null;
    return clinicas.find((c) => c.id === currentTramite.clinica?.id) ?? null;
  }, [clinicas, currentTramite?.clinica?.id]);

  const dias = useMemo(
    () => (selectedClinicObj ? espaciosDisponibles(selectedClinicObj.horarios, 7) : []),
    [selectedClinicObj],
  );

  useEffect(() => {
    if (dias.length > 0 && (!selectedDay || !dias.some((d) => d.fecha === selectedDay))) {
      setSelectedDay(dias[0].fecha);
    }
  }, [dias, selectedDay]);

  const ensureResumedIfAbandoned = useCallback(async (t: Tramite) => {
    if (t.estado === "ABANDONADO") {
      return await avanzarTramite(t.id, "RETOMAR", {});
    }
    return t;
  }, []);

  async function pickStudy(studyId: string) {
    setBusy(true);
    setBanner(null);
    try {
      if (!active) {
        await crearTramite(ctx.paciente.telefono, studyId);
      } else {
        const ready = await ensureResumedIfAbandoned(active);
        await avanzarTramite(ready.id, "ESTUDIO", { estudioId: studyId });
      }
      setEditing(null);
      await onReload();
    } catch (err) {
      setBanner(
        err instanceof SwiError
          ? err.message
          : "No pudimos guardar el estudio. Revisa tu conexión e intenta de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function pickClinic(clinicId: string) {
    if (!active) return;
    setBusy(true);
    setBanner(null);
    try {
      const ready = await ensureResumedIfAbandoned(active);
      await avanzarTramite(ready.id, "CLINICA", { clinicaId: clinicId });
      setEditing(null);
      await onReload();
    } catch (err) {
      setBanner(err instanceof SwiError ? err.message : "No pudimos guardar la clínica.");
    } finally {
      setBusy(false);
    }
  }

  async function pickSlot(fecha: string, hora: string) {
    if (!active) return;
    setBusy(true);
    setBanner(null);
    try {
      const ready = await ensureResumedIfAbandoned(active);
      const fechaIso = aFechaCDMX(fecha, hora).toISOString();
      await avanzarTramite(ready.id, "FECHA", { fechaCita: fechaIso });
      setEditing(null);
      await onReload();
    } catch (err) {
      setBanner(err instanceof SwiError ? err.message : "No pudimos guardar el horario.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDatos() {
    if (!active) return;
    setBanner(null);

    if (!esRegistroCompleto(ctx.paciente)) {
      const check = validateRegistroValues(ctx.paciente.telefono, registro);
      if (!check.ok) {
        setBanner(check.error);
        return;
      }
      setBusy(true);
      try {
        await registrarPaciente(check.payload);
        const ready = await ensureResumedIfAbandoned(active);
        await avanzarTramite(ready.id, "DATOS", {});
        setEditing(null);
        await onReload();
      } catch (err) {
        setBanner(err instanceof SwiError ? err.message : "No pudimos guardar tus datos.");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const ready = await ensureResumedIfAbandoned(active);
      await avanzarTramite(ready.id, "DATOS", {});
      setEditing(null);
      await onReload();
    } catch (err) {
      setBanner(err instanceof SwiError ? err.message : "No pudimos confirmar tus datos.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAppointment(payMode: "CLINICA" | "TARJETA") {
    if (!active || !active.clinica?.id || !active.fechaCita) return;
    setBusy(true);
    setBanner(null);
    try {
      // Regla 2: verificar registro completo antes de AGENDAR / CONFIRMAR / pagar en CLINICA
      const freshCtx = await getContexto(ctx.paciente.telefono, false);
      if (!esRegistroCompleto(freshCtx.paciente)) {
        const msg = mensajeRegistroIncompleto(freshCtx.paciente);
        setRegistro(createInitialRegistro(freshCtx.paciente));
        setBanner(msg);
        setEditing("DATOS");
        return;
      }

      const ready = await ensureResumedIfAbandoned(active);
      // Regla 8a: CLINICA y FECHA ya se registraron paso a paso; en AGENDAR no mandamos todo junto.
      let agendado = await avanzarTramite(ready.id, "AGENDAR");
      if (agendado.estado === "AGENDADO") {
        agendado = await avanzarTramite(agendado.id, "CONFIRMAR");
      }
      if (payMode === "CLINICA") {
        try {
          const pagoRes = await marcarPagoEnClinica(agendado.id);
          agendado = pagoRes.tramite;
        } catch (payErr) {
          if (payErr instanceof SwiError && (payErr.status === 400 || payErr.status === 403)) {
            setBanner(payErr.message);
          }
        }
        setDone(agendado);
      } else {
        setDone(agendado);
        setPaying(agendado);
      }
      setEditing(null);
      await onReload();
    } catch (err) {
      const msg = err instanceof SwiError ? err.message : "No pudimos confirmar tu cita.";
      setBanner(msg);
      if (err instanceof SwiError && err.status === 400 && msg.toLowerCase().includes("completa su registro")) {
        setRegistro(createInitialRegistro(ctx.paciente));
        setEditing("DATOS");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleCancelTramite() {
    if (!active) return;
    Alert.alert("Cancelar trámite", "¿Seguro que quieres cancelar tu trámite?", [
      { text: "Volver", style: "cancel" },
      {
        text: "Sí, cancelar",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setBanner(null);
          try {
            const cancelled = await avanzarTramite(active.id, "CANCELAR", {
              motivo: "Cancelado por el paciente en la app",
            });
            setDone(cancelled);
            setEditing(null);
            await onReload();
          } catch (err) {
            setBanner(err instanceof SwiError ? err.message : "No pudimos cancelar el trámite.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  if (!estudios || !clinicas) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={styles.loadingText}>{banner ?? "Cargando…"}</Text>
      </View>
    );
  }

  const hoy = fechaLocal(new Date());
  const activeDayObj = dias.find((d) => d.fecha === selectedDay);

  return (
    <View style={styles.root}>
      {view !== "LISTO" ? (
        <View style={styles.wizardRow}>
          {WIZARD_STEPS.map((w, i) => (
            <View key={w.view} style={styles.wizardItem}>
              <View
                style={[
                  styles.wizardBar,
                  i < wizardIndex
                    ? styles.wizardBarDone
                    : i === wizardIndex
                      ? styles.wizardBarCurrent
                      : styles.wizardBarTodo,
                ]}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.wizardLabel,
                  i <= wizardIndex ? styles.wizardLabelActive : styles.wizardLabelTodo,
                ]}
              >
                {w.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {banner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        {editing ? (
          <Pressable onPress={() => setEditing(null)} style={styles.backEditBtn}>
            <Text style={styles.backEditText}>← Volver sin cambiar</Text>
          </Pressable>
        ) : null}

        {view === "ESTUDIO" ? (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>¿Qué estudio necesitas?</Text>
            <Text style={styles.stepSubtitle}>Precios de demostración.</Text>
            <View style={styles.choiceList}>
              {estudios.map((s) => (
                <Pressable
                  key={s.id}
                  disabled={busy}
                  onPress={() => pickStudy(s.id)}
                  style={({ pressed }) => [
                    styles.choiceBtn,
                    pressed && styles.choiceBtnPressed,
                    busy && styles.disabled,
                  ]}
                >
                  <View style={styles.choiceHeader}>
                    <Text style={styles.choiceName}>{s.nombre}</Text>
                    <Text style={styles.choicePrice}>{formatMoney(s.precio)}</Text>
                  </View>
                  <Text style={styles.choiceMeta}>{s.preparacion}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {view === "CLINICA" ? (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Elige tu clínica</Text>
            <View style={styles.choiceList}>
              {clinicas.map((c) => (
                <Pressable
                  key={c.id}
                  disabled={busy}
                  onPress={() => pickClinic(c.id)}
                  style={({ pressed }) => [
                    styles.choiceBtn,
                    pressed && styles.choiceBtnPressed,
                    busy && styles.disabled,
                  ]}
                >
                  <Text style={styles.choiceName}>{c.nombre}</Text>
                  <Text style={styles.choiceMeta}>
                    {c.direccion} · {c.ciudad}
                  </Text>
                  {c.horariosTexto ? (
                    <Text style={styles.choiceHours}>{c.horariosTexto}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {view === "HORARIO" ? (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Elige un horario</Text>
            {dias.length === 0 ? (
              <Text style={styles.stepSubtitle}>
                No hay horarios disponibles próximos para esta clínica.
              </Text>
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dayChipsRow}
                >
                  {dias.map((d) => {
                    const isSelected = d.fecha === selectedDay;
                    return (
                      <Pressable
                        key={d.fecha}
                        onPress={() => setSelectedDay(d.fecha)}
                        style={[styles.dayChip, isSelected && styles.dayChipActive]}
                      >
                        <Text
                          style={[styles.dayChipText, isSelected && styles.dayChipTextActive]}
                        >
                          {d.fecha === hoy ? "Hoy" : d.etiqueta}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <View style={styles.slotGrid}>
                  {(activeDayObj?.horas ?? []).map((hora) => (
                    <Pressable
                      key={`${selectedDay}-${hora}`}
                      disabled={busy}
                      onPress={() => pickSlot(selectedDay, hora)}
                      style={({ pressed }) => [
                        styles.slotBtn,
                        pressed && styles.choiceBtnPressed,
                        busy && styles.disabled,
                      ]}
                    >
                      <Text style={styles.slotText}>{hora}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        ) : null}

        {view === "DATOS" ? (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>
              {esRegistroCompleto(ctx.paciente) ? "Confirma tus datos" : "Completa tus datos"}
            </Text>
            {esRegistroCompleto(ctx.paciente) ? (
              <View style={{ gap: 6 }}>
                <Text style={styles.confirmBody}>
                  A nombre de <Text style={styles.bold}>{ctx.paciente.nombre}</Text>. Te enviaremos
                  la confirmación al teléfono que verificaste.
                </Text>
                {ctx.paciente.contactoNombre ? (
                  <Text style={styles.stepSubtitle}>
                    Familiar: <Text style={styles.bold}>{ctx.paciente.contactoNombre}</Text>
                    {ctx.paciente.contactoParentesco
                      ? ` (${etiquetaParentesco(ctx.paciente.contactoParentesco)})`
                      : ""}
                    {ctx.paciente.contactoTelefono ? ` · ${ctx.paciente.contactoTelefono}` : ""}
                  </Text>
                ) : null}
              </View>
            ) : (
              <>
                <Text style={styles.stepSubtitle}>
                  {mensajeRegistroIncompleto(ctx.paciente)}
                </Text>
                <PatientRegistrationFields
                  value={registro}
                  onChange={setRegistro}
                  disabled={busy}
                />
              </>
            )}
            <Pressable
              disabled={busy}
              onPress={confirmDatos}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.primaryBtnPressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {busy
                  ? "Guardando…"
                  : esRegistroCompleto(ctx.paciente)
                    ? "Mis datos son correctos"
                    : "Guardar y continuar"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {view === "CITA" && currentTramite ? (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Confirma tu cita</Text>
            <Text style={styles.confirmBody}>
              {currentTramite.estudio.nombre} en {currentTramite.clinica?.nombre},{" "}
              {currentTramite.fechaCita ? formatDate(currentTramite.fechaCita) : ""}.
            </Text>
            <Text style={styles.stepSubtitle}>
              Puedes pagar en la clínica el día de tu estudio o pagar ahora con tarjeta.
            </Text>

            <View style={styles.confirmActions}>
              <Pressable
                disabled={busy}
                onPress={() => confirmAppointment("CLINICA")}
                style={({ pressed }) => [
                  styles.primaryBtnFull,
                  pressed && styles.primaryBtnPressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.primaryBtnText}>
                  {busy ? "Guardando…" : "Confirmar cita (pago en clínica)"}
                </Text>
              </Pressable>

              <Pressable
                disabled={busy}
                onPress={() => confirmAppointment("TARJETA")}
                style={({ pressed }) => [
                  styles.outlineBtnFull,
                  pressed && styles.outlineBtnPressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.outlineBtnText}>
                  Confirmar y pagar con tarjeta ({formatMoney(currentTramite.estudio.precio)})
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {view === "LISTO" && currentTramite?.estado === "CANCELADO" ? (
          <View style={styles.doneBox}>
            <View style={styles.cancelCircle}>
              <Text style={styles.cancelCircleText}>✕</Text>
            </View>
            <Text style={styles.doneTitle}>Tu trámite fue cancelado</Text>
            <Text style={styles.doneStrike}>
              {[
                currentTramite.estudio?.nombre,
                currentTramite.clinica?.nombre,
                currentTramite.fechaCita && formatDate(currentTramite.fechaCita),
              ]
                .filter(Boolean)
                .join(" · ") || "Sin estudio elegido"}
            </Text>
            <Text style={styles.doneMeta}>
              Cancelado desde{" "}
              {CANAL_NOMBRE[currentTramite.canalActual] ?? currentTramite.canalActual}.
            </Text>
            <Pressable
              onPress={() => setDone(null)}
              style={({ pressed }) => [
                styles.outlineBtnInline,
                pressed && styles.outlineBtnPressed,
              ]}
            >
              <Text style={styles.outlineBtnText}>Agendar otro estudio</Text>
            </Pressable>
          </View>
        ) : null}

        {view === "LISTO" && currentTramite && currentTramite.estado !== "CANCELADO" ? (
          <View style={styles.doneBox}>
            <Text style={styles.doneEmoji}>✅</Text>
            <Text style={styles.doneTitle}>¡Tu cita está confirmada!</Text>
            <Text style={styles.doneFolioWrap}>
              Folio <Text style={styles.doneFolio}>{currentTramite.folio}</Text>
            </Text>
            <Text style={styles.doneMeta}>
              {currentTramite.estudio.nombre} · {currentTramite.clinica?.nombre ?? ""} ·{" "}
              {currentTramite.fechaCita ? formatDate(currentTramite.fechaCita) : ""}
            </Text>
            {currentTramite.pago.estado === "PAGADO" ? (
              <Text style={styles.donePaid}>
                ✓ Pago aprobado
                {currentTramite.pago.detalle?.ultimos4
                  ? ` (···${currentTramite.pago.detalle.ultimos4})`
                  : ""}
              </Text>
            ) : (
              <Text style={styles.doneHint}>
                {currentTramite.pago.estado === "EN_CLINICA"
                  ? "Pagas en la clínica el día de tu estudio."
                  : "Pago pendiente."}
              </Text>
            )}
            {currentTramite.canalActual !== "APP" ? (
              <Text style={styles.doneCrossChannel}>
                Confirmada desde{" "}
                {CANAL_NOMBRE[currentTramite.canalActual] ?? currentTramite.canalActual}, sin que
                repitieras tus datos.
              </Text>
            ) : null}
            <Text style={styles.doneHint}>Ya aparece en tu inicio.</Text>

            <View style={styles.doneActions}>
              {currentTramite.pago.estado !== "PAGADO" ? (
                <Pressable
                  onPress={() => setPaying(currentTramite)}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && styles.primaryBtnPressed,
                  ]}
                >
                  <Text style={styles.primaryBtnText}>Pagar con tarjeta</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setDone(null)}
                style={({ pressed }) => [
                  styles.outlineBtnInline,
                  pressed && styles.outlineBtnPressed,
                ]}
              >
                <Text style={styles.outlineBtnText}>Agendar otro estudio</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {currentTramite && view !== "LISTO" && currentTramite.estudio?.nombre ? (
        <View style={styles.card}>
          <Text style={styles.quoteHeading}>Tu cotización</Text>
          <View style={styles.quoteRows}>
            <SummaryRow
              label="Estudio"
              value={currentTramite.estudio.nombre}
              onChange={() => setEditing("ESTUDIO")}
            />
            <SummaryRow
              label="Clínica"
              value={currentTramite.clinica?.nombre ?? null}
              onChange={currentTramite.clinica ? () => setEditing("CLINICA") : undefined}
            />
            <SummaryRow
              label="Horario"
              value={currentTramite.fechaCita ? formatDate(currentTramite.fechaCita) : null}
              onChange={currentTramite.fechaCita ? () => setEditing("HORARIO") : undefined}
            />
          </View>

          <View style={styles.quoteTotalRow}>
            <Text style={styles.quoteTotalLabel}>Total</Text>
            <Text style={styles.quoteTotalValue}>
              {formatMoney(currentTramite.estudio.precio)}
            </Text>
          </View>

          {currentTramite.estudio.preparacion ? (
            <View style={styles.prepBox}>
              <Text style={styles.prepText}>
                Preparación: {currentTramite.estudio.preparacion}
              </Text>
            </View>
          ) : null}

          <Text style={styles.omniHint}>
            ¿Tienes que irte? Tu avance queda guardado: continúa por WhatsApp o llamando al Call
            Center.
          </Text>

          <Pressable
            disabled={busy}
            onPress={handleCancelTramite}
            style={({ pressed }) => [
              styles.cancelBtn,
              pressed && styles.cancelBtnPressed,
              busy && styles.disabled,
            ]}
          >
            <Text style={styles.cancelBtnText}>Cancelar trámite</Text>
          </Pressable>
        </View>
      ) : null}

      <PaymentModal
        tramite={paying}
        telefono={ctx.paciente.telefono}
        nombrePaciente={ctx.paciente.nombre ?? ""}
        visible={Boolean(paying)}
        onClose={() => setPaying(null)}
        onRegistroIncompleto={(msg) => {
          setPaying(null);
          setRegistro(createInitialRegistro(ctx.paciente));
          setBanner(msg);
          setEditing("DATOS");
        }}
        onPaid={async (updated, msg) => {
          setPaying(null);
          setDone(updated);
          setBanner(msg);
          await onReload();
        }}
      />
    </View>
  );
}

function SummaryRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange?: () => void;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, !value && styles.summaryEmpty]}>
        {value ?? "Por elegir"}
      </Text>
      {onChange ? (
        <Pressable onPress={onChange}>
          <Text style={styles.changeLink}>Cambiar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 16,
  },
  loadingWrap: {
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.slate500,
    textAlign: "center",
  },
  wizardRow: {
    flexDirection: "row",
    gap: 8,
  },
  wizardItem: {
    flex: 1,
    gap: 6,
  },
  wizardBar: {
    height: 6,
    borderRadius: 999,
  },
  wizardBarDone: {
    backgroundColor: COLORS.teal600,
  },
  wizardBarCurrent: {
    backgroundColor: COLORS.teal300,
  },
  wizardBarTodo: {
    backgroundColor: COLORS.slate200,
  },
  wizardLabel: {
    fontSize: 11,
  },
  wizardLabelActive: {
    color: COLORS.teal800,
    fontWeight: "600",
  },
  wizardLabelTodo: {
    color: COLORS.slate400,
  },
  banner: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.amber200,
    backgroundColor: COLORS.amber50,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bannerText: {
    fontSize: 13,
    color: COLORS.amber900,
    lineHeight: 19,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    padding: 18,
    gap: 12,
  },
  backEditBtn: {
    alignSelf: "flex-start",
    paddingBottom: 4,
  },
  backEditText: {
    fontSize: 14,
    color: COLORS.teal700,
    fontWeight: "500",
  },
  stepContent: {
    gap: 10,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: COLORS.slate900,
  },
  stepSubtitle: {
    fontSize: 14,
    color: COLORS.slate600,
    lineHeight: 20,
  },
  choiceList: {
    marginTop: 6,
    gap: 10,
  },
  choiceBtn: {
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    gap: 4,
  },
  choiceBtnPressed: {
    borderColor: COLORS.teal600,
    backgroundColor: COLORS.teal50,
  },
  choiceHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  choiceName: {
    fontSize: 15,
    fontWeight: "500",
    color: COLORS.slate900,
    flex: 1,
  },
  choicePrice: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.teal800,
  },
  choiceMeta: {
    fontSize: 12,
    color: COLORS.slate500,
    lineHeight: 17,
  },
  choiceHours: {
    fontSize: 11,
    color: COLORS.teal800,
    marginTop: 2,
  },
  dayChipsRow: {
    gap: 8,
    paddingVertical: 4,
  },
  dayChip: {
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.white,
  },
  dayChipActive: {
    borderColor: COLORS.teal700,
    backgroundColor: COLORS.teal700,
  },
  dayChipText: {
    fontSize: 13,
    color: COLORS.slate700,
    fontWeight: "500",
  },
  dayChipTextActive: {
    color: COLORS.white,
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  slotBtn: {
    width: "47%",
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: COLORS.white,
  },
  slotText: {
    fontSize: 14,
    fontFamily: "monospace",
    fontWeight: "600",
    color: COLORS.slate900,
  },
  confirmBody: {
    fontSize: 14,
    color: COLORS.slate900,
    lineHeight: 20,
  },
  bold: {
    fontWeight: "700",
  },
  confirmActions: {
    gap: 10,
    marginTop: 6,
  },
  primaryBtn: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.teal700,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  primaryBtnFull: {
    backgroundColor: COLORS.teal700,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnPressed: {
    backgroundColor: COLORS.teal800,
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "600",
  },
  outlineBtnFull: {
    borderWidth: 1,
    borderColor: COLORS.teal600,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: COLORS.white,
  },
  outlineBtnInline: {
    borderWidth: 1,
    borderColor: COLORS.teal600,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
  },
  outlineBtnPressed: {
    backgroundColor: COLORS.teal50,
  },
  outlineBtnText: {
    color: COLORS.teal700,
    fontSize: 14,
    fontWeight: "600",
  },
  doneBox: {
    alignItems: "center",
    paddingVertical: 18,
    gap: 10,
  },
  doneEmoji: {
    fontSize: 36,
  },
  cancelCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.slate100,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelCircleText: {
    fontSize: 22,
    color: COLORS.slate500,
  },
  doneTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.slate900,
    textAlign: "center",
  },
  doneFolioWrap: {
    fontSize: 15,
    color: COLORS.slate600,
  },
  doneFolio: {
    fontFamily: "monospace",
    fontWeight: "700",
    color: COLORS.slate900,
  },
  doneStrike: {
    fontSize: 14,
    color: COLORS.slate500,
    textDecorationLine: "line-through",
    textAlign: "center",
  },
  doneMeta: {
    fontSize: 14,
    color: COLORS.slate600,
    textAlign: "center",
    lineHeight: 20,
  },
  donePaid: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.teal800,
  },
  doneCrossChannel: {
    fontSize: 13,
    color: COLORS.teal800,
    textAlign: "center",
  },
  doneHint: {
    fontSize: 13,
    color: COLORS.slate500,
    textAlign: "center",
  },
  doneActions: {
    marginTop: 6,
    gap: 10,
    alignItems: "center",
  },
  quoteHeading: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.slate700,
  },
  quoteRows: {
    gap: 10,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  summaryLabel: {
    width: 64,
    fontSize: 14,
    color: COLORS.slate500,
  },
  summaryValue: {
    flex: 1,
    fontSize: 14,
    color: COLORS.slate900,
  },
  summaryEmpty: {
    color: COLORS.slate400,
  },
  changeLink: {
    fontSize: 12,
    color: COLORS.teal700,
    fontWeight: "600",
  },
  quoteTotalRow: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.slate100,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  quoteTotalLabel: {
    fontSize: 14,
    color: COLORS.slate600,
  },
  quoteTotalValue: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.slate900,
  },
  prepBox: {
    backgroundColor: COLORS.slate50,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  prepText: {
    fontSize: 12,
    color: COLORS.slate600,
    lineHeight: 17,
  },
  omniHint: {
    fontSize: 12,
    color: COLORS.slate500,
    lineHeight: 17,
  },
  cancelBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: COLORS.red200,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  cancelBtnPressed: {
    backgroundColor: COLORS.red50,
  },
  cancelBtnText: {
    fontSize: 14,
    color: COLORS.red700,
    fontWeight: "500",
  },
  disabled: {
    opacity: 0.55,
  },
});
