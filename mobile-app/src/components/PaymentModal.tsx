import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { formatMoney } from "../lib/format";
import { SwiError, marcarPagoEnClinica, pagarConTarjeta } from "../lib/swiApi";
import {
  ETIQUETA_MARCA,
  TARJETAS_PRUEBA,
  detectarMarca,
  formatearNumero,
  formatearVencimiento,
  soloDigitos,
  validarTarjeta,
} from "../lib/tarjetas";
import { COLORS } from "../theme/tokens";
import type { Tramite } from "../types/swi";

export function PaymentModal({
  tramite,
  nombrePaciente,
  visible,
  onClose,
  onPaid,
}: {
  tramite: Tramite | null;
  nombrePaciente: string;
  visible: boolean;
  onClose: () => void;
  onPaid: (updated: Tramite, message: string) => void;
}) {
  const [numero, setNumero] = useState("");
  const [titular, setTitular] = useState(nombrePaciente);
  const [vencimiento, setVencimiento] = useState("");
  const [cvc, setCvc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCards, setShowCards] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitular(nombrePaciente);
      setError(null);
    }
  }, [visible, nombrePaciente]);

  if (!tramite) return null;
  const activeTramite = tramite;
  const marca = detectarMarca(numero);

  async function handleCardPay() {
    setError(null);
    const errores = validarTarjeta({ numero, titular, vencimiento, cvc });
    const firstErr = Object.values(errores)[0];
    if (firstErr) {
      setError(firstErr);
      return;
    }

    setBusy(true);
    try {
      const r = await pagarConTarjeta(activeTramite.id, {
        numero: soloDigitos(numero),
        titular: titular.trim(),
        vencimiento,
        cvc: soloDigitos(cvc),
      });
      if (r.pago.estado === "APROBADO") {
        setNumero("");
        setCvc("");
        onPaid(
          r.tramite,
          `Pago aprobado · ${formatMoney(r.pago.monto)}${r.pago.ultimos4 ? ` (···${r.pago.ultimos4})` : ""}`,
        );
      } else {
        setError(r.pago.mensaje ?? "El banco rechazó la tarjeta. Prueba con otra.");
      }
    } catch (err) {
      setError(err instanceof SwiError ? err.message : "No se pudo procesar el pago.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePayAtClinic() {
    setError(null);
    setBusy(true);
    try {
      const r = await marcarPagoEnClinica(activeTramite.id);
      onPaid(r.tramite, "Registrado: pagas en la clínica el día de tu estudio.");
    } catch (err) {
      setError(
        err instanceof SwiError ? err.message : "No se pudo registrar el pago en clínica.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>
                Pagar {formatMoney(activeTramite.estudio.precio)}
              </Text>
              <Text style={styles.subtitle}>
                {activeTramite.estudio.nombre} ·{" "}
                <Text style={styles.mono}>{activeTramite.folio}</Text>
              </Text>
            </View>
            <Pressable disabled={busy} onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Número de tarjeta</Text>
                {soloDigitos(numero).length >= 2 ? (
                  <Text style={styles.brandTag}>{ETIQUETA_MARCA[marca]}</Text>
                ) : null}
              </View>
              <TextInput
                value={formatearNumero(numero)}
                onChangeText={(t) => setNumero(soloDigitos(t).slice(0, 19))}
                keyboardType="number-pad"
                placeholder="4242 4242 4242 4242"
                placeholderTextColor={COLORS.slate400}
                editable={!busy}
                style={[styles.input, styles.mono]}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Titular</Text>
              <TextInput
                value={titular}
                onChangeText={setTitular}
                placeholder="Nombre como aparece en la tarjeta"
                placeholderTextColor={COLORS.slate400}
                editable={!busy}
                style={styles.input}
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.field, styles.half]}>
                <Text style={styles.label}>Vencimiento</Text>
                <TextInput
                  value={vencimiento}
                  onChangeText={(t) => setVencimiento(formatearVencimiento(t))}
                  keyboardType="number-pad"
                  maxLength={5}
                  placeholder="MM/AA"
                  placeholderTextColor={COLORS.slate400}
                  editable={!busy}
                  style={[styles.input, styles.mono]}
                />
              </View>
              <View style={[styles.field, styles.half]}>
                <Text style={styles.label}>CVC</Text>
                <TextInput
                  value={cvc}
                  onChangeText={(t) => setCvc(soloDigitos(t).slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="123"
                  placeholderTextColor={COLORS.slate400}
                  editable={!busy}
                  style={[styles.input, styles.mono]}
                />
              </View>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.testCardsBox}>
              <Pressable
                onPress={() => setShowCards((v) => !v)}
                style={styles.testCardsHeader}
              >
                <Text style={styles.testCardsTitle}>Tarjetas de prueba (SWI / Stripe)</Text>
                <Text style={styles.testCardsArrow}>{showCards ? "▴" : "▾"}</Text>
              </Pressable>
              {showCards ? (
                <View style={styles.testCardsList}>
                  {TARJETAS_PRUEBA.map((t) => (
                    <Pressable
                      key={t.numero}
                      onPress={() => {
                        setNumero(t.numero);
                        setVencimiento("12/30");
                        setCvc(t.marca === "amex" ? "1234" : "123");
                        setError(null);
                      }}
                      style={({ pressed }) => [
                        styles.testCardRow,
                        pressed && styles.testCardRowPressed,
                      ]}
                    >
                      <Text style={styles.testCardNumber}>{formatearNumero(t.numero)}</Text>
                      <Text
                        style={[
                          styles.testCardDesc,
                          t.rechazo ? styles.testCardDeclined : styles.testCardApproved,
                        ]}
                      >
                        {t.descripcion}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>

            <Pressable
              disabled={busy}
              onPress={handleCardPay}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.primaryBtnPressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {busy
                  ? "Procesando…"
                  : `Pagar ${formatMoney(activeTramite.estudio.precio)}`}
              </Text>
            </Pressable>

            {activeTramite.pago.estado !== "EN_CLINICA" ? (
              <Pressable
                disabled={busy}
                onPress={handlePayAtClinic}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.secondaryBtnPressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryBtnText}>Pagar en clínica el día de mi cita</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.slate200,
    backgroundColor: COLORS.teal50,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.slate900,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.slate600,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
  },
  closeText: {
    fontSize: 15,
    color: COLORS.slate700,
    fontWeight: "600",
  },
  body: {
    padding: 20,
    gap: 14,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  half: {
    flex: 1,
  },
  field: {
    gap: 4,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.slate700,
  },
  brandTag: {
    fontSize: 12,
    color: COLORS.teal800,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.slate300,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.slate900,
    backgroundColor: COLORS.white,
  },
  mono: {
    fontFamily: "monospace",
  },
  errorBox: {
    backgroundColor: COLORS.red50,
    borderWidth: 1,
    borderColor: COLORS.red200,
    borderRadius: 8,
    padding: 10,
  },
  errorText: {
    fontSize: 13,
    color: COLORS.red700,
  },
  testCardsBox: {
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 10,
    overflow: "hidden",
  },
  testCardsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.slate50,
  },
  testCardsTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.slate700,
  },
  testCardsArrow: {
    fontSize: 13,
    color: COLORS.slate500,
  },
  testCardsList: {
    borderTopWidth: 1,
    borderTopColor: COLORS.slate200,
  },
  testCardRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.slate100,
    gap: 8,
  },
  testCardRowPressed: {
    backgroundColor: COLORS.teal50,
  },
  testCardNumber: {
    fontFamily: "monospace",
    fontSize: 12,
    color: COLORS.slate900,
  },
  testCardDesc: {
    fontSize: 11,
    fontWeight: "500",
  },
  testCardApproved: {
    color: COLORS.teal800,
  },
  testCardDeclined: {
    color: COLORS.red700,
  },
  primaryBtn: {
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
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: COLORS.teal600,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: COLORS.white,
  },
  secondaryBtnPressed: {
    backgroundColor: COLORS.teal50,
  },
  secondaryBtnText: {
    color: COLORS.teal700,
    fontSize: 14,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.6,
  },
});
