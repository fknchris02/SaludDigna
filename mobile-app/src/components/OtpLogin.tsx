import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  enmascararTelefono,
  generarCodigoDemo,
  normalizarTelefono,
} from "../lib/constantes";
import { SwiError, getContexto, registrarPaciente } from "../lib/swiApi";
import { COLORS } from "../theme/tokens";
import {
  PatientRegistrationFields,
  createInitialRegistro,
  validateRegistroValues,
  type RegistroFormValues,
} from "./PatientRegistrationFields";

type SentState = {
  telefonoNormalizado: string;
  telefonoEnmascarado: string;
  demoCode: string;
  needsProfile: boolean;
};

/**
 * Misma apariencia y flujo que SaludDigna/app/_components/OtpLogin.tsx:
 * Teléfono + código demo de 6 dígitos. Si el teléfono no existe en SWI (404),
 * muestra el registro completo exigido por SWI sin perder el código.
 */
export function OtpLogin({
  title,
  description,
  onVerified,
}: {
  title: string;
  description: string;
  onVerified: (telefono: string) => Promise<void> | void;
}) {
  const [telefono, setTelefono] = useState("");
  const [sent, setSent] = useState<SentState | null>(null);
  const [code, setCode] = useState("");
  const [registro, setRegistro] = useState<RegistroFormValues>(() => createInitialRegistro());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRequest() {
    setError(null);
    const limpio = normalizarTelefono(telefono);
    if (!limpio) {
      setError("Escribe un número celular válido de 10 dígitos.");
      return;
    }

    setBusy(true);
    try {
      let needsProfile = false;
      try {
        await getContexto(limpio);
      } catch (err) {
        if (err instanceof SwiError && err.status === 404) {
          needsProfile = true;
        } else {
          throw err;
        }
      }
      setSent({
        telefonoNormalizado: limpio,
        telefonoEnmascarado: enmascararTelefono(limpio),
        demoCode: generarCodigoDemo(),
        needsProfile,
      });
    } catch (err) {
      setError(err instanceof SwiError ? err.message : "No pudimos conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!sent) return;
    setError(null);

    if (code.length !== 6) {
      setError("Ingresa el código de 6 dígitos.");
      return;
    }
    if (code !== sent.demoCode) {
      setError("Código incorrecto o expirado.");
      return;
    }

    if (sent.needsProfile) {
      const check = validateRegistroValues(sent.telefonoNormalizado, registro);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      setBusy(true);
      try {
        await registrarPaciente(check.payload);
        await onVerified(sent.telefonoNormalizado);
      } catch (err) {
        setError(err instanceof SwiError ? err.message : "No se pudo completar tu registro.");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      await onVerified(sent.telefonoNormalizado);
    } catch (err) {
      setError(err instanceof SwiError ? err.message : "Error de red.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>

      {!sent ? (
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Teléfono celular (10 dígitos)</Text>
            <TextInput
              value={telefono}
              onChangeText={setTelefono}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="667 000 0001"
              placeholderTextColor={COLORS.slate400}
              editable={!busy}
              onSubmitEditing={handleRequest}
              style={styles.input}
            />
          </View>

          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            disabled={busy}
            onPress={handleRequest}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.primaryBtnPressed,
              busy && styles.btnDisabled,
            ]}
          >
            <Text style={styles.primaryBtnText}>{busy ? "Enviando…" : "Enviar código"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.sentText}>Enviamos un código a {sent.telefonoEnmascarado}.</Text>

          <View style={styles.demoPill}>
            <Text style={styles.demoText}>
              Demo sin SMS · tu código es <Text style={styles.demoCode}>{sent.demoCode}</Text>
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Código de 6 dígitos</Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={COLORS.slate400}
              editable={!busy}
              style={[styles.input, styles.codeInput]}
            />
          </View>

          {sent.needsProfile ? (
            <View style={styles.profileBox}>
              <Text style={styles.profileTitle}>Eres nuevo: completa tu registro</Text>
              <PatientRegistrationFields
                value={registro}
                onChange={setRegistro}
                disabled={busy}
              />
            </View>
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable
              disabled={busy}
              onPress={handleVerify}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.primaryBtnPressed,
                busy && styles.btnDisabled,
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {busy ? "Verificando…" : "Verificar"}
              </Text>
            </Pressable>

            <Pressable
              disabled={busy}
              onPress={() => {
                setSent(null);
                setCode("");
                setError(null);
              }}
              style={styles.linkBtn}
            >
              <Text style={styles.linkBtnText}>Cambiar teléfono</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: COLORS.slate900,
  },
  description: {
    fontSize: 14,
    color: COLORS.slate600,
    marginTop: 4,
    lineHeight: 20,
  },
  form: {
    gap: 12,
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 14,
    color: COLORS.slate700,
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
  codeInput: {
    fontFamily: "monospace",
    letterSpacing: 6,
    fontSize: 17,
  },
  sentText: {
    fontSize: 14,
    color: COLORS.slate600,
  },
  demoPill: {
    backgroundColor: COLORS.slate100,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  demoText: {
    fontSize: 12,
    color: COLORS.slate700,
  },
  demoCode: {
    fontFamily: "monospace",
    fontWeight: "700",
    color: COLORS.slate900,
  },
  profileBox: {
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 10,
    padding: 12,
    gap: 10,
    backgroundColor: COLORS.slate50,
  },
  profileTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.slate700,
  },
  error: {
    fontSize: 14,
    color: COLORS.red700,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  primaryBtn: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.teal700,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  primaryBtnPressed: {
    backgroundColor: COLORS.teal800,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "600",
  },
  linkBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  linkBtnText: {
    fontSize: 14,
    color: COLORS.slate600,
  },
});
