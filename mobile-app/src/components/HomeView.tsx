import React, { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { splitContextoTramites } from "../lib/bookingState";
import {
  CANAL_NOMBRE,
  ETIQUETA_PASO,
  esRegistroCompleto,
  etiquetaParentesco,
  mensajeRegistroIncompleto,
} from "../lib/constantes";
import { ago, capitalizeFirst, formatDate, formatMoney } from "../lib/format";
import {
  SwiError,
  avanzarTramite,
  enviarEncuesta,
  getContexto,
  guardarPreguntaSeguridad,
  registrarInteraccion,
  registrarPaciente,
  verificarPreguntaSeguridad,
} from "../lib/swiApi";
import { COLORS } from "../theme/tokens";
import type { Contexto, Pago, Tramite } from "../types/swi";
import {
  PatientRegistrationFields,
  createInitialRegistro,
  validateRegistroValues,
  type RegistroFormValues,
} from "./PatientRegistrationFields";
import { PaymentModal } from "./PaymentModal";

function PagoPill({ pago }: { pago: Pago }) {
  if (pago.estado === "PAGADO") {
    return (
      <View style={[styles.pill, styles.pillPaid]}>
        <Text style={[styles.pillText, styles.pillPaidText]}>
          ✓ Pagado{pago.detalle?.ultimos4 ? ` ···${pago.detalle.ultimos4}` : ""}
        </Text>
      </View>
    );
  }
  if (pago.estado === "EN_CLINICA") {
    return (
      <View style={[styles.pill, styles.pillClinic]}>
        <Text style={[styles.pillText, styles.pillClinicText]}>Paga en clínica</Text>
      </View>
    );
  }
  return (
    <View style={[styles.pill, styles.pillPending]}>
      <Text style={[styles.pillText, styles.pillPendingText]}>Pago pendiente</Text>
    </View>
  );
}

/** Réplica fiel de `Home` en SaludDigna/app/app/page.tsx conectada a SWI-Salud Digna. */
export function HomeView({
  ctx,
  onContinue,
  onReload,
}: {
  ctx: Contexto;
  onContinue: () => void;
  onReload: () => Promise<void>;
}) {
  const { active, upcoming, history } = splitContextoTramites(ctx);
  const [paying, setPaying] = useState<Tramite | null>(null);
  const [detailCita, setDetailCita] = useState<Tramite | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modal completar/editar registro
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileAlert, setProfileAlert] = useState<string | null>(null);
  const [registro, setRegistro] = useState<RegistroFormValues>(() =>
    createInitialRegistro(ctx.paciente),
  );
  const [savingProfile, setSavingProfile] = useState(false);

  // Modal pregunta de seguridad
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [secPregunta, setSecPregunta] = useState(ctx.paciente.preguntaSeguridad ?? "");
  const [secRespuesta, setSecRespuesta] = useState("");
  const [secVerifyInput, setSecVerifyInput] = useState("");
  const [secMsg, setSecMsg] = useState<string | null>(null);
  const [secBusy, setSecBusy] = useState(false);

  // Modal encuesta de satisfacción
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [surveyPuntaje, setSurveyPuntaje] = useState(5);
  const [surveyMotivo, setSurveyMotivo] = useState("");
  const [surveyErr, setSurveyErr] = useState<string | null>(null);
  const [surveyBusy, setSurveyBusy] = useState(false);

  function openProfileCompletion(pacienteSource = ctx.paciente, alertText?: string) {
    setRegistro(createInitialRegistro(pacienteSource));
    setProfileAlert(alertText ?? null);
    setShowProfileModal(true);
  }

  async function handleSaveProfile() {
    const check = validateRegistroValues(ctx.paciente.telefono, registro);
    if (!check.ok) {
      setProfileAlert(check.error);
      return;
    }
    setSavingProfile(true);
    setProfileAlert(null);
    try {
      await registrarPaciente(check.payload);
      setShowProfileModal(false);
      setNotice("Datos actualizados correctamente.");
      await onReload();
    } catch (err) {
      setProfileAlert(err instanceof SwiError ? err.message : "No se pudieron guardar tus datos.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleConfirmAttendance(t: Tramite) {
    setBusyId(t.id);
    setNotice(null);
    try {
      const fresh = await getContexto(ctx.paciente.telefono, false);
      if (!esRegistroCompleto(fresh.paciente)) {
        const msg = mensajeRegistroIncompleto(fresh.paciente);
        setNotice(msg);
        openProfileCompletion(fresh.paciente, msg);
        return;
      }
      await avanzarTramite(t.id, "CONFIRMAR");
      setNotice("Asistencia confirmada.");
      await onReload();
    } catch (err) {
      const msg = err instanceof SwiError ? err.message : "No se pudo confirmar la cita.";
      setNotice(msg);
      if (err instanceof SwiError && err.status === 400 && msg.toLowerCase().includes("completa su registro")) {
        openProfileCompletion(ctx.paciente, msg);
      }
    } finally {
      setBusyId(null);
    }
  }

  function handleOpenDetail(t: Tramite) {
    setDetailCita(t);
    // Regla 8b: ver detalle de cita -> CITA_VISUALIZADA { folio }
    void registrarInteraccion({
      tramiteId: t.id,
      tipo: "CITA_VISUALIZADA",
      detalle: { folio: t.folio },
    }).catch(() => {});
  }

  async function handleRequestAdvisor() {
    setNotice(null);
    try {
      await registrarInteraccion({
        ...(active ? { tramiteId: active.id } : { telefono: ctx.paciente.telefono }),
        tipo: "TRANSFERENCIA_ASESOR",
        detalle: { motivo: "La paciente solicitó hablar con un asesor desde la app" },
      });
      setNotice("Registramos tu solicitud para hablar con un asesor. Te contactaremos pronto.");
    } catch (err) {
      setNotice(err instanceof SwiError ? err.message : "No se pudo registrar la solicitud.");
    }
  }

  async function handleSaveSecurity() {
    setSecMsg(null);
    if (!secPregunta.trim() || !secRespuesta.trim()) {
      setSecMsg("Escribe la pregunta y la respuesta.");
      return;
    }
    setSecBusy(true);
    try {
      await guardarPreguntaSeguridad(ctx.paciente.telefono, secPregunta, secRespuesta);
      setSecRespuesta("");
      setSecMsg("Pregunta de seguridad guardada.");
      await onReload();
    } catch (err) {
      setSecMsg(err instanceof SwiError ? err.message : "No se pudo guardar la pregunta.");
    } finally {
      setSecBusy(false);
    }
  }

  async function handleVerifySecurity() {
    setSecMsg(null);
    if (!secVerifyInput.trim()) {
      setSecMsg("Escribe tu respuesta.");
      return;
    }
    setSecBusy(true);
    try {
      const r = await verificarPreguntaSeguridad(ctx.paciente.telefono, secVerifyInput);
      setSecVerifyInput("");
      setSecMsg(
        r.correcta
          ? "✓ Identidad verificada correctamente."
          : `Respuesta incorrecta. Intentos restantes: ${r.intentosRestantes}.`,
      );
    } catch (err) {
      setSecMsg(err instanceof SwiError ? err.message : "No se pudo verificar.");
    } finally {
      setSecBusy(false);
    }
  }

  async function handleSubmitSurvey() {
    setSurveyErr(null);
    if (surveyPuntaje < 3 && !surveyMotivo.trim()) {
      setSurveyErr("El motivo es obligatorio cuando el puntaje es menor a 3.");
      return;
    }
    setSurveyBusy(true);
    try {
      await enviarEncuesta({
        telefono: ctx.paciente.telefono,
        puntaje: surveyPuntaje,
        motivo: surveyMotivo.trim() || undefined,
        tramiteId: upcoming[0]?.id ?? active?.id,
      });
      setShowSurveyModal(false);
      setSurveyMotivo("");
      setNotice("¡Gracias por responder la encuesta de satisfacción!");
    } catch (err) {
      setSurveyErr(err instanceof SwiError ? err.message : "No se pudo enviar la encuesta.");
    } finally {
      setSurveyBusy(false);
    }
  }

  function handleCancel(t: Tramite) {
    Alert.alert("Cancelar cita", "¿Seguro que quieres cancelar esta cita?", [
      { text: "Volver", style: "cancel" },
      {
        text: "Cancelar cita",
        style: "destructive",
        onPress: async () => {
          setBusyId(t.id);
          setNotice(null);
          try {
            await avanzarTramite(t.id, "CANCELAR", {
              motivo: "Cancelado por el paciente en la app",
            });
            setNotice("Cita cancelada.");
            await onReload();
          } catch (err) {
            setNotice(err instanceof SwiError ? err.message : "No se pudo cancelar.");
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  const registroOk = esRegistroCompleto(ctx.paciente);

  return (
    <View style={styles.stack}>
      {notice ? (
        <View style={styles.noticeBanner}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {!registroOk ? (
        <View style={styles.warnCard}>
          <Text style={styles.warnText}>{mensajeRegistroIncompleto(ctx.paciente)}</Text>
          <Pressable
            onPress={() =>
              openProfileCompletion(ctx.paciente, mensajeRegistroIncompleto(ctx.paciente))
            }
            style={styles.smallPrimaryBtn}
          >
            <Text style={styles.smallPrimaryBtnText}>Completar registro</Text>
          </Pressable>
        </View>
      ) : null}

      {ctx.paciente.contactoNombre || ctx.paciente.adultoMayor ? (
        <View style={styles.profileSummaryCard}>
          <View style={styles.upcomingTopRow}>
            <Text style={styles.profileSummaryTitle}>Mi expediente</Text>
            {ctx.paciente.adultoMayor ? (
              <View style={[styles.pill, styles.pillClinic]}>
                <Text style={[styles.pillText, styles.pillClinicText]}>Adulto mayor (60+)</Text>
              </View>
            ) : null}
          </View>
          {ctx.paciente.contactoNombre ? (
            <Text style={styles.profileSummaryText}>
              Familiar: <Text style={styles.bold}>{ctx.paciente.contactoNombre}</Text>
              {ctx.paciente.contactoParentesco
                ? ` (${etiquetaParentesco(ctx.paciente.contactoParentesco)})`
                : ""}
              {ctx.paciente.contactoTelefono ? ` · ${ctx.paciente.contactoTelefono}` : ""}
            </Text>
          ) : null}
        </View>
      ) : null}

      {upcoming.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Tu próxima cita</Text>
          {upcoming.map((c) => {
            const isBusy = busyId === c.id;
            return (
              <View key={c.id} style={styles.card}>
                <View style={styles.upcomingHeader}>
                  <View style={styles.upcomingTopRow}>
                    <Text style={styles.confirmedTag}>
                      {c.estado === "CONFIRMADO" ? "✓ Confirmada" : "✓ Agendada"}
                    </Text>
                    <PagoPill pago={c.pago} />
                  </View>
                  <Text style={styles.upcomingDate}>
                    {c.fechaCita ? capitalizeFirst(formatDate(c.fechaCita)) : ""}
                  </Text>
                </View>

                <View style={styles.upcomingBody}>
                  <View style={styles.studyRow}>
                    <Text style={styles.studyName}>{c.estudio.nombre}</Text>
                    <Text style={styles.studyPrice}>{formatMoney(c.estudio.precio)}</Text>
                  </View>

                  {c.clinica ? (
                    <View>
                      <Text style={styles.clinicName}>{c.clinica.nombre}</Text>
                      {c.clinica.direccion ? (
                        <Text style={styles.clinicAddress}>{c.clinica.direccion}</Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.folioRow}>
                    <Text style={styles.folioLabel}>Folio</Text>
                    <Text style={styles.folioValue}>{c.folio}</Text>
                  </View>
                </View>

                {c.estudio.preparacion ? (
                  <View style={styles.prepBox}>
                    <Text style={styles.prepText}>Preparación: {c.estudio.preparacion}</Text>
                  </View>
                ) : null}

                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => handleOpenDetail(c)}
                    style={({ pressed }) => [
                      styles.smallOutlineBtn,
                      pressed && styles.smallOutlineBtnPressed,
                    ]}
                  >
                    <Text style={styles.smallOutlineBtnText}>Ver detalle</Text>
                  </Pressable>

                  {c.estado === "AGENDADO" ? (
                    <Pressable
                      disabled={isBusy}
                      onPress={() => handleConfirmAttendance(c)}
                      style={({ pressed }) => [
                        styles.smallPrimaryBtn,
                        pressed && styles.smallPrimaryBtnPressed,
                        isBusy && styles.disabled,
                      ]}
                    >
                      <Text style={styles.smallPrimaryBtnText}>Confirmar asistencia</Text>
                    </Pressable>
                  ) : null}

                  {c.pago.estado !== "PAGADO" ? (
                    <Pressable
                      disabled={isBusy}
                      onPress={() => setPaying(c)}
                      style={({ pressed }) => [
                        styles.smallOutlineBtn,
                        pressed && styles.smallOutlineBtnPressed,
                        isBusy && styles.disabled,
                      ]}
                    >
                      <Text style={styles.smallOutlineBtnText}>Pagar ahora</Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    disabled={isBusy}
                    onPress={() => handleCancel(c)}
                    style={({ pressed }) => [
                      styles.smallDangerBtn,
                      pressed && styles.smallDangerBtnPressed,
                      isBusy && styles.disabled,
                    ]}
                  >
                    <Text style={styles.smallDangerBtnText}>Cancelar</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No tienes citas próximas.</Text>
        </View>
      )}

      {active ? (
        <View style={styles.activeCard}>
          <Text style={styles.activeTag}>
            {active.estado === "ABANDONADO"
              ? "Trámite en curso · Pausado"
              : "Trámite en curso"}
          </Text>
          <Text style={styles.activeTitle}>
            {active.estudio?.nombre ?? "Estudio por elegir"}
            {active.clinica?.nombre ? ` · ${active.clinica.nombre}` : ""}
          </Text>
          <Text style={styles.activeDesc}>
            Te falta:{" "}
            <Text style={styles.bold}>
              {ETIQUETA_PASO[active.paso] ?? "continuar trámite"}
            </Text>
            . Lo dejaste en {CANAL_NOMBRE[active.canalActual] ?? active.canalActual}{" "}
            {ago(active.actualizadoEn)}.
          </Text>
          <Pressable
            onPress={onContinue}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
          >
            <Text style={styles.primaryBtnText}>Continuar aquí</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onContinue}
          style={({ pressed }) => [styles.outlineBtn, pressed && styles.outlineBtnPressed]}
        >
          <Text style={styles.outlineBtnText}>Agendar un estudio</Text>
        </Pressable>
      )}

      {/* Acciones adicionales SWI: seguridad, encuesta y transferencia a asesor */}
      <View style={styles.quickActionsRow}>
        <Pressable
          onPress={() => openProfileCompletion(ctx.paciente)}
          style={styles.smallOutlineBtn}
        >
          <Text style={styles.smallOutlineBtnText}>Mis datos</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setSecPregunta(ctx.paciente.preguntaSeguridad ?? "");
            setSecMsg(null);
            setShowSecurityModal(true);
          }}
          style={styles.smallOutlineBtn}
        >
          <Text style={styles.smallOutlineBtnText}>Seguridad</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setSurveyErr(null);
            setShowSurveyModal(true);
          }}
          style={styles.smallOutlineBtn}
        >
          <Text style={styles.smallOutlineBtnText}>Calificar atención</Text>
        </Pressable>
        <Pressable onPress={handleRequestAdvisor} style={styles.smallOutlineBtn}>
          <Text style={styles.smallOutlineBtnText}>Hablar con asesor</Text>
        </Pressable>
      </View>

      {history.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Historial</Text>
          <View style={styles.card}>
            {history.map((c, idx) => (
              <Pressable
                key={c.id}
                onPress={() => handleOpenDetail(c)}
                style={[styles.historyRow, idx > 0 && styles.historyRowDivider]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.historyStudy,
                    c.estado === "CANCELADO" && styles.historyCancelled,
                  ]}
                >
                  {c.estudio?.nombre ?? "Sin estudio"}
                </Text>
                <Text style={styles.historyMeta}>
                  {c.estado === "CANCELADO"
                    ? "Cancelado"
                    : c.fechaCita
                      ? formatDate(c.fechaCita)
                      : ""}
                </Text>
              </Pressable>
            ))}
          </View>
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
          openProfileCompletion(ctx.paciente, msg);
        }}
        onPaid={async (_updated, msg) => {
          setPaying(null);
          setNotice(msg);
          await onReload();
        }}
      />

      {/* Modal detalle de cita */}
      <Modal
        visible={Boolean(detailCita)}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailCita(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Detalle de cita</Text>
              <Pressable onPress={() => setDetailCita(null)}>
                <Text style={styles.modalClose}>Cerrar</Text>
              </Pressable>
            </View>
            {detailCita ? (
              <View style={styles.modalBody}>
                <Text style={styles.studyName}>{detailCita.estudio.nombre}</Text>
                <Text style={styles.activeDesc}>Folio: {detailCita.folio}</Text>
                {detailCita.clinica ? (
                  <Text style={styles.activeDesc}>
                    Clínica: {detailCita.clinica.nombre} · {detailCita.clinica.direccion}
                  </Text>
                ) : null}
                {detailCita.fechaCita ? (
                  <Text style={styles.activeDesc}>Fecha: {formatDate(detailCita.fechaCita)}</Text>
                ) : null}
                <Text style={styles.activeDesc}>
                  Preparación: {detailCita.estudio.preparacion}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal completar / editar datos */}
      <Modal
        visible={showProfileModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProfileModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Datos de la paciente</Text>
              <Pressable onPress={() => setShowProfileModal(false)}>
                <Text style={styles.modalClose}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              {profileAlert ? (
                <View style={styles.warnCard}>
                  <Text style={styles.warnText}>{profileAlert}</Text>
                </View>
              ) : null}
              <PatientRegistrationFields
                value={registro}
                onChange={setRegistro}
                disabled={savingProfile}
              />
              <Pressable
                disabled={savingProfile}
                onPress={handleSaveProfile}
                style={[styles.primaryBtn, savingProfile && styles.disabled]}
              >
                <Text style={styles.primaryBtnText}>
                  {savingProfile ? "Guardando…" : "Guardar datos"}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal pregunta de seguridad */}
      <Modal
        visible={showSecurityModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSecurityModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pregunta de seguridad</Text>
              <Pressable onPress={() => setShowSecurityModal(false)}>
                <Text style={styles.modalClose}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              {ctx.paciente.preguntaSeguridad ? (
                <View style={styles.secBox}>
                  <Text style={styles.activeTag}>Pregunta registrada</Text>
                  <Text style={styles.activeTitle}>{ctx.paciente.preguntaSeguridad}</Text>
                  <TextInput
                    value={secVerifyInput}
                    onChangeText={setSecVerifyInput}
                    placeholder="Tu respuesta para verificar"
                    placeholderTextColor={COLORS.slate400}
                    style={styles.textInput}
                  />
                  <Pressable
                    disabled={secBusy}
                    onPress={handleVerifySecurity}
                    style={styles.primaryBtn}
                  >
                    <Text style={styles.primaryBtnText}>Verificar identidad</Text>
                  </Pressable>
                </View>
              ) : null}

              <Text style={styles.sectionHeading}>
                {ctx.paciente.preguntaSeguridad ? "Actualizar pregunta" : "Registrar pregunta"}
              </Text>
              <TextInput
                value={secPregunta}
                onChangeText={setSecPregunta}
                placeholder="Ej. ¿Cómo se llama tu mascota?"
                placeholderTextColor={COLORS.slate400}
                style={styles.textInput}
              />
              <TextInput
                value={secRespuesta}
                onChangeText={setSecRespuesta}
                placeholder="Respuesta (se guarda cifrada)"
                placeholderTextColor={COLORS.slate400}
                secureTextEntry
                style={styles.textInput}
              />
              <Pressable disabled={secBusy} onPress={handleSaveSecurity} style={styles.outlineBtn}>
                <Text style={styles.outlineBtnText}>Guardar pregunta</Text>
              </Pressable>

              {secMsg ? (
                <View style={styles.noticeBanner}>
                  <Text style={styles.noticeText}>{secMsg}</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal encuesta de satisfacción */}
      <Modal
        visible={showSurveyModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSurveyModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Encuesta de satisfacción</Text>
              <Pressable onPress={() => setShowSurveyModal(false)}>
                <Text style={styles.modalClose}>Cerrar</Text>
              </Pressable>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.activeDesc}>¿Cómo calificas tu experiencia? (1 a 5)</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setSurveyPuntaje(n)}
                    style={[styles.ratingBtn, surveyPuntaje === n && styles.ratingBtnActive]}
                  >
                    <Text
                      style={[
                        styles.ratingBtnText,
                        surveyPuntaje === n && styles.ratingBtnTextActive,
                      ]}
                    >
                      {n}★
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={surveyMotivo}
                onChangeText={setSurveyMotivo}
                placeholder={
                  surveyPuntaje < 3
                    ? "Cuéntanos el motivo (obligatorio)"
                    : "Comentarios (opcional)"
                }
                placeholderTextColor={COLORS.slate400}
                multiline
                style={[styles.textInput, { minHeight: 72 }]}
              />
              {surveyErr ? <Text style={styles.errorText}>{surveyErr}</Text> : null}
              <Pressable
                disabled={surveyBusy}
                onPress={handleSubmitSurvey}
                style={[styles.primaryBtn, surveyBusy && styles.disabled]}
              >
                <Text style={styles.primaryBtnText}>
                  {surveyBusy ? "Enviando…" : "Enviar encuesta"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 16,
  },
  noticeBanner: {
    backgroundColor: COLORS.teal50,
    borderWidth: 1,
    borderColor: COLORS.teal100,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noticeText: {
    fontSize: 13,
    color: COLORS.teal800,
    fontWeight: "500",
  },
  warnCard: {
    backgroundColor: COLORS.amber50,
    borderWidth: 1,
    borderColor: COLORS.amber200,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    alignItems: "flex-start",
  },
  warnText: {
    fontSize: 13,
    color: COLORS.amber900,
  },
  profileSummaryCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    padding: 14,
    gap: 6,
  },
  profileSummaryTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.slate700,
  },
  profileSummaryText: {
    fontSize: 13,
    color: COLORS.slate600,
  },
  quickActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  section: {
    gap: 10,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.slate700,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    overflow: "hidden",
  },
  upcomingHeader: {
    backgroundColor: COLORS.teal50,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.teal100,
    gap: 4,
  },
  upcomingTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  confirmedTag: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.teal800,
  },
  upcomingDate: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.slate900,
  },
  upcomingBody: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
  },
  studyRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  studyName: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.slate900,
    flex: 1,
  },
  studyPrice: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.teal800,
  },
  clinicName: {
    fontSize: 14,
    color: COLORS.slate900,
  },
  clinicAddress: {
    fontSize: 12,
    color: COLORS.slate500,
    marginTop: 2,
  },
  folioRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  folioLabel: {
    fontSize: 14,
    color: COLORS.slate500,
  },
  folioValue: {
    fontSize: 14,
    fontFamily: "monospace",
    fontWeight: "700",
    color: COLORS.slate900,
  },
  prepBox: {
    marginHorizontal: 16,
    marginBottom: 12,
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
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  smallPrimaryBtn: {
    backgroundColor: COLORS.teal700,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallPrimaryBtnPressed: {
    backgroundColor: COLORS.teal800,
  },
  smallPrimaryBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "600",
  },
  smallOutlineBtn: {
    borderWidth: 1,
    borderColor: COLORS.teal600,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: COLORS.white,
  },
  smallOutlineBtnPressed: {
    backgroundColor: COLORS.teal50,
  },
  smallOutlineBtnText: {
    color: COLORS.teal700,
    fontSize: 12,
    fontWeight: "600",
  },
  smallDangerBtn: {
    borderWidth: 1,
    borderColor: COLORS.red200,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: COLORS.white,
    marginLeft: "auto",
  },
  smallDangerBtnPressed: {
    backgroundColor: COLORS.red50,
  },
  smallDangerBtnText: {
    color: COLORS.red700,
    fontSize: 12,
    fontWeight: "500",
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  pillPaid: {
    backgroundColor: COLORS.teal100,
  },
  pillPaidText: {
    color: COLORS.teal900,
  },
  pillClinic: {
    backgroundColor: COLORS.amber50,
    borderWidth: 1,
    borderColor: COLORS.amber200,
  },
  pillClinicText: {
    color: COLORS.amber800,
  },
  pillPending: {
    backgroundColor: COLORS.slate100,
  },
  pillPendingText: {
    color: COLORS.slate600,
  },
  emptyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    padding: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.slate500,
  },
  activeCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.amber200,
    padding: 16,
    gap: 8,
  },
  activeTag: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.amber800,
  },
  activeTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.slate900,
  },
  activeDesc: {
    fontSize: 14,
    color: COLORS.slate600,
    lineHeight: 20,
  },
  bold: {
    fontWeight: "700",
    color: COLORS.slate900,
  },
  primaryBtn: {
    marginTop: 4,
    backgroundColor: COLORS.teal700,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryBtnPressed: {
    backgroundColor: COLORS.teal800,
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "600",
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: COLORS.teal600,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  outlineBtnPressed: {
    backgroundColor: COLORS.teal50,
  },
  outlineBtnText: {
    color: COLORS.teal700,
    fontSize: 15,
    fontWeight: "600",
  },
  historyRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
  },
  historyRowDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.slate100,
  },
  historyStudy: {
    flex: 1,
    fontSize: 14,
    color: COLORS.slate900,
  },
  historyCancelled: {
    color: COLORS.slate400,
    textDecorationLine: "line-through",
  },
  historyMeta: {
    fontSize: 12,
    color: COLORS.slate500,
  },
  disabled: {
    opacity: 0.6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.slate200,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.slate900,
  },
  modalClose: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.teal700,
  },
  modalBody: {
    padding: 20,
    gap: 12,
  },
  secBox: {
    backgroundColor: COLORS.teal50,
    borderWidth: 1,
    borderColor: COLORS.teal100,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.slate300,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.slate900,
    backgroundColor: COLORS.white,
  },
  ratingRow: {
    flexDirection: "row",
    gap: 8,
  },
  ratingBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.slate300,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  ratingBtnActive: {
    backgroundColor: COLORS.teal700,
    borderColor: COLORS.teal700,
  },
  ratingBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.slate700,
  },
  ratingBtnTextActive: {
    color: COLORS.white,
  },
  errorText: {
    fontSize: 13,
    color: COLORS.red700,
  },
});
