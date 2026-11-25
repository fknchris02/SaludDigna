import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { splitContextoTramites } from "../lib/bookingState";
import { CANAL_NOMBRE, ETIQUETA_PASO } from "../lib/constantes";
import { ago, capitalizeFirst, formatDate, formatMoney } from "../lib/format";
import { SwiError, avanzarTramite } from "../lib/swiApi";
import { COLORS } from "../theme/tokens";
import type { Contexto, Pago, Tramite } from "../types/swi";
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleConfirmAttendance(t: Tramite) {
    setBusyId(t.id);
    setNotice(null);
    try {
      await avanzarTramite(t.id, "CONFIRMAR", {});
      setNotice("Asistencia confirmada.");
      await onReload();
    } catch (err) {
      setNotice(err instanceof SwiError ? err.message : "No se pudo confirmar la cita.");
    } finally {
      setBusyId(null);
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

  return (
    <View style={styles.stack}>
      {notice ? (
        <View style={styles.noticeBanner}>
          <Text style={styles.noticeText}>{notice}</Text>
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

      {history.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Historial</Text>
          <View style={styles.card}>
            {history.map((c, idx) => (
              <View
                key={c.id}
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
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <PaymentModal
        tramite={paying}
        nombrePaciente={ctx.paciente.nombre ?? ""}
        visible={Boolean(paying)}
        onClose={() => setPaying(null)}
        onPaid={async (_updated, msg) => {
          setPaying(null);
          setNotice(msg);
          await onReload();
        }}
      />
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
});
