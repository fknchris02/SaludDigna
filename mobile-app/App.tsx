import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { BookingFlow } from "./src/components/BookingFlow";
import { HomeView } from "./src/components/HomeView";
import { OtpLogin } from "./src/components/OtpLogin";
import { POLL_INTERVAL_MS, SWI_BASE_URL } from "./src/config";
import { formatearTelefono } from "./src/lib/constantes";
import { clearSessionPhone, loadSessionPhone, saveSessionPhone } from "./src/lib/sessionStore";
import { SwiError, getContexto } from "./src/lib/swiApi";
import { COLORS } from "./src/theme/tokens";
import type { Contexto } from "./src/types/swi";

export default function App() {
  return <PatientApp />;
}

/** App del paciente: misma estética que SaludDigna/app, conectada a SWI (http://10.35.11.66:3000). */
function PatientApp() {
  const [phone, setPhone] = useState<string | null | "loading">("loading");
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [mode, setMode] = useState<"home" | "flow">("home");
  const [refreshing, setRefreshing] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  const loadContext = useCallback(
    async (targetPhone: string, silent = false, registrar = false): Promise<Contexto | null> => {
      try {
        const data = await getContexto(targetPhone, registrar);
        setCtx(data);
        setNetError(null);
        return data;
      } catch (err) {
        if (err instanceof SwiError && err.status === 404) {
          await clearSessionPhone();
          setPhone(null);
          setCtx(null);
          setMode("home");
          return null;
        }
        if (!silent) {
          setNetError(
            err instanceof SwiError
              ? err.message
              : `No se pudo conectar con ${SWI_BASE_URL}.`,
          );
        }
        return null;
      }
    },
    [],
  );

  // Hidratar sesión guardada al abrir la app
  useEffect(() => {
    let active = true;
    loadSessionPhone().then(async (saved) => {
      if (!active) return;
      if (!saved) {
        setPhone(null);
        return;
      }
      setPhone(saved);
      await loadContext(saved, false, true);
    });
    return () => {
      active = false;
    };
  }, [loadContext]);

  // Sincronización en vivo cada 4 s (mismo ritmo que WEB-CLINICA y consola SWI)
  useEffect(() => {
    if (!phone || phone === "loading") return;
    const interval = setInterval(() => {
      if (appStateRef.current === "active") {
        loadContext(phone, true);
      }
    }, POLL_INTERVAL_MS);

    const sub = AppState.addEventListener("change", (nextState) => {
      const wasBg = appStateRef.current !== "active";
      appStateRef.current = nextState;
      if (wasBg && nextState === "active") {
        loadContext(phone, true);
      }
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [phone, loadContext]);

  async function handleVerified(verifiedPhone: string) {
    await saveSessionPhone(verifiedPhone);
    setPhone(verifiedPhone);
    await loadContext(verifiedPhone, false, true);
  }

  async function handleLogout() {
    await clearSessionPhone();
    setMode("home");
    setCtx(null);
    setNetError(null);
    setPhone(null);
  }

  async function handlePullRefresh() {
    if (!phone || phone === "loading") return;
    setRefreshing(true);
    await loadContext(phone);
    setRefreshing(false);
  }

  const firstName = ctx?.paciente.nombre?.trim().split(/\s+/)[0];
  const headerTitle = ctx
    ? `Hola, ${firstName || formatearTelefono(ctx.paciente.telefono)}`
    : "Salud Digna";

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <SafeAreaView style={styles.headerSafe}>
        <View style={styles.header}>
          {mode === "flow" && ctx ? (
            <Pressable
              onPress={() => {
                setMode("home");
                if (phone && phone !== "loading") loadContext(phone);
              }}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
            >
              <Text style={styles.headerBtnText}>← Inicio</Text>
            </Pressable>
          ) : (
            <View style={styles.sdBadge}>
              <Text style={styles.sdBadgeText}>SD</Text>
            </View>
          )}

          <View style={styles.headerTextWrap}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {headerTitle}
            </Text>
            <Text style={styles.headerSubtitle}>
              {mode === "flow" ? "Agendar estudio" : "Mis citas"}
            </Text>
          </View>

          {ctx ? (
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.headerBtn,
                styles.logoutBtn,
                pressed && styles.headerBtnPressed,
              ]}
            >
              <Text style={styles.logoutBtnText}>Salir</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            ctx ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handlePullRefresh}
                tintColor={COLORS.teal700}
                colors={[COLORS.teal700]}
              />
            ) : undefined
          }
        >
          {phone === "loading" || (phone && !ctx && !netError) ? (
            <Text style={styles.loadingText}>Cargando…</Text>
          ) : null}

          {phone && !ctx && netError ? (
            <View style={styles.card}>
              <Text style={styles.errorTitle}>Sin conexión con el servidor</Text>
              <Text style={styles.errorText}>{netError}</Text>
              <View style={styles.errorActions}>
                <Pressable
                  onPress={() => loadContext(phone)}
                  style={({ pressed }) => [
                    styles.retryBtn,
                    pressed && styles.retryBtnPressed,
                  ]}
                >
                  <Text style={styles.retryBtnText}>Reintentar</Text>
                </Pressable>
                <Pressable onPress={handleLogout} style={styles.changePhoneBtn}>
                  <Text style={styles.changePhoneText}>Cambiar cuenta</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {phone === null ? (
            <View style={styles.card}>
              <OtpLogin
                title="Inicia sesión"
                description="Entra con tu número de celular para ver tus citas y continuar tus trámites."
                onVerified={handleVerified}
              />
            </View>
          ) : null}

          {ctx && mode === "flow" ? (
            <BookingFlow
              ctx={ctx}
              onReload={async () =>
                phone && phone !== "loading" ? loadContext(phone) : null
              }
            />
          ) : null}

          {ctx && mode === "home" ? (
            <HomeView
              ctx={ctx}
              onContinue={() => setMode("flow")}
              onReload={async () => {
                if (phone && phone !== "loading") await loadContext(phone);
              }}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.appBg,
  },
  flex: {
    flex: 1,
  },
  headerSafe: {
    backgroundColor: COLORS.teal700,
    paddingTop: Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 28) : 0,
  },
  header: {
    backgroundColor: COLORS.teal700,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sdBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
  },
  sdBadgeText: {
    color: COLORS.teal700,
    fontWeight: "700",
    fontSize: 12,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
  },
  headerSubtitle: {
    color: COLORS.white80,
    fontSize: 12,
    marginTop: 1,
  },
  headerBtn: {
    backgroundColor: COLORS.white15,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerBtnPressed: {
    backgroundColor: COLORS.white25,
  },
  headerBtnText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "500",
  },
  logoutBtn: {
    marginLeft: "auto",
  },
  logoutBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "500",
  },
  body: {
    padding: 16,
    paddingBottom: 32,
  },
  loadingText: {
    textAlign: "center",
    color: COLORS.slate500,
    fontSize: 14,
    marginTop: 40,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    padding: 20,
    gap: 12,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.slate900,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.slate600,
    lineHeight: 20,
  },
  errorActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  retryBtn: {
    backgroundColor: COLORS.teal700,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryBtnPressed: {
    backgroundColor: COLORS.teal800,
  },
  retryBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "600",
  },
  changePhoneBtn: {
    paddingVertical: 8,
  },
  changePhoneText: {
    fontSize: 14,
    color: COLORS.slate600,
  },
});
