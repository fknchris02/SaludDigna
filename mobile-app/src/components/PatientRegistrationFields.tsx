import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ETIQUETA_PARENTESCO,
  OPCIONES_PARENTESCO,
  normalizarTelefono,
} from "../lib/constantes";
import {
  ENTIDADES,
  ETIQUETA_SEXO,
  OPCIONES_ENTIDAD,
  generarCurp,
  leerCurp,
  validarCurp,
} from "../lib/curp";
import { COLORS } from "../theme/tokens";
import type { ContactoParentesco, Paciente, RegistroPacienteInput, Sexo } from "../types/swi";

export type RegistroFormValues = {
  curp: string;
  nombres: string;
  primerApellido: string;
  segundoApellido: string;
  fechaNacimiento: string;
  sexo: "" | Sexo;
  entidad: string;
  telefonoFijo: string;
  email: string;
  contactoNombre: string;
  contactoTelefono: string;
  contactoParentesco: "" | ContactoParentesco;
};

export function createInitialRegistro(paciente?: Paciente | null): RegistroFormValues {
  return {
    curp: paciente?.curp ?? "",
    nombres: paciente?.nombres ?? "",
    primerApellido: paciente?.primerApellido ?? "",
    segundoApellido: paciente?.segundoApellido ?? "",
    fechaNacimiento: paciente?.fechaNacimiento ? paciente.fechaNacimiento.slice(0, 10) : "",
    sexo: paciente?.sexo ?? "",
    entidad: paciente?.entidadNacimiento ?? paciente?.entidad ?? "",
    telefonoFijo: paciente?.telefonoFijo ?? "",
    email: paciente?.email ?? "",
    contactoNombre: paciente?.contactoNombre ?? "",
    contactoTelefono: paciente?.contactoTelefono ?? "",
    contactoParentesco: paciente?.contactoParentesco ?? "",
  };
}

/** Formatea dígitos como AAAA-MM-DD mientras el usuario escribe. */
function formatFechaInput(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

export function validateRegistroValues(
  telefono: string,
  v: RegistroFormValues,
): { ok: true; payload: RegistroPacienteInput } | { ok: false; error: string } {
  const tel = normalizarTelefono(telefono);
  if (!tel) return { ok: false, error: "El celular debe tener 10 dígitos." };

  const faltan: string[] = [];
  if (!v.nombres.trim()) faltan.push("nombre(s)");
  if (!v.primerApellido.trim()) faltan.push("primer apellido");
  if (!v.segundoApellido.trim()) faltan.push("segundo apellido");
  if (!v.fechaNacimiento.trim()) faltan.push("fecha de nacimiento");
  if (!v.sexo) faltan.push("sexo");
  if (!v.entidad) faltan.push("estado de nacimiento");
  if (!v.telefonoFijo.trim()) faltan.push("teléfono fijo");
  if (!v.email.trim()) faltan.push("correo");
  if (!v.contactoNombre.trim()) faltan.push("nombre del familiar");
  if (!v.contactoParentesco) faltan.push("parentesco del familiar");
  if (!v.contactoTelefono.trim()) faltan.push("número del familiar");
  if (faltan.length > 0) return { ok: false, error: `Faltan: ${faltan.join(", ")}.` };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.fechaNacimiento)) {
    return { ok: false, error: "Usa el formato AAAA-MM-DD para tu fecha de nacimiento." };
  }
  const fechaDate = new Date(`${v.fechaNacimiento}T12:00:00Z`);
  if (Number.isNaN(fechaDate.getTime()) || fechaDate > new Date()) {
    return { ok: false, error: "Revisa tu fecha de nacimiento." };
  }

  const curpLimpia = v.curp.trim().toUpperCase();
  if (curpLimpia && !validarCurp(curpLimpia).valida) {
    return { ok: false, error: validarCurp(curpLimpia).motivo ?? "CURP inválida." };
  }

  const fijo = normalizarTelefono(v.telefonoFijo);
  if (!fijo) return { ok: false, error: "El teléfono fijo debe tener 10 dígitos (con lada)." };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
    return { ok: false, error: "Revisa el correo; debe verse como nombre@correo.com." };
  }

  const famTel = normalizarTelefono(v.contactoTelefono);
  if (!famTel) return { ok: false, error: "El número del familiar debe tener 10 dígitos." };

  return {
    ok: true,
    payload: {
      telefono: tel,
      nombres: v.nombres.trim(),
      primerApellido: v.primerApellido.trim(),
      segundoApellido: v.segundoApellido.trim(),
      fechaNacimiento: v.fechaNacimiento,
      sexo: v.sexo as Sexo,
      entidad: v.entidad,
      ...(curpLimpia ? { curp: curpLimpia } : {}),
      email: v.email.trim(),
      telefonoFijo: fijo,
      contactoNombre: v.contactoNombre.trim(),
      contactoTelefono: famTel,
      contactoParentesco: v.contactoParentesco as ContactoParentesco,
    },
  };
}

export function PatientRegistrationFields({
  value,
  onChange,
  disabled,
}: {
  value: RegistroFormValues;
  onChange: (next: RegistroFormValues) => void;
  disabled?: boolean;
}) {
  const [showEntidadPicker, setShowEntidadPicker] = useState(false);
  const [showParentescoPicker, setShowParentescoPicker] = useState(false);

  const curpLimpia = value.curp.trim().toUpperCase();
  const curpCheck = curpLimpia.length === 18 ? validarCurp(curpLimpia) : null;
  const deCurp = curpCheck?.valida ? leerCurp(curpLimpia) : null;
  const calculada =
    value.nombres.trim() &&
    value.primerApellido.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.fechaNacimiento) &&
    value.sexo &&
    value.entidad
      ? generarCurp({
          nombres: value.nombres,
          primerApellido: value.primerApellido,
          segundoApellido: value.segundoApellido,
          fechaNacimiento: value.fechaNacimiento,
          sexo: value.sexo,
          entidad: value.entidad,
        })
      : null;

  function setField<K extends keyof RegistroFormValues>(key: K, nextVal: RegistroFormValues[K]) {
    onChange({ ...value, [key]: nextVal });
  }

  function handleCurpChange(raw: string) {
    const c = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 18);
    if (c.length === 18 && validarCurp(c).valida) {
      const parsed = leerCurp(c);
      if (parsed) {
        onChange({
          ...value,
          curp: c,
          fechaNacimiento: parsed.fechaNacimiento,
          sexo: parsed.sexo,
          entidad: parsed.entidad,
        });
        return;
      }
    }
    setField("curp", c);
  }

  return (
    <View style={styles.container}>
      <View style={styles.field}>
        <Text style={styles.label}>
          CURP <Text style={styles.optional}>(opcional — llena fecha, sexo y estado)</Text>
        </Text>
        <TextInput
          value={value.curp}
          onChangeText={handleCurpChange}
          editable={!disabled}
          autoCapitalize="characters"
          maxLength={18}
          placeholder="18 caracteres"
          placeholderTextColor={COLORS.slate400}
          style={[styles.input, styles.mono]}
        />
        {curpCheck && !curpCheck.valida ? (
          <Text style={styles.errorHint}>{curpCheck.motivo}</Text>
        ) : deCurp ? (
          <Text style={styles.okHint}>
            ✓ {deCurp.fechaNacimiento} · {ETIQUETA_SEXO[deCurp.sexo]} · {ENTIDADES[deCurp.entidad]}
          </Text>
        ) : calculada ? (
          <Text style={styles.mutedHint}>
            CURP estimada: <Text style={styles.mono}>{calculada.curp}</Text>
          </Text>
        ) : (
          <Text style={styles.mutedHint}>Si no la tienes a la mano, se calcula con tus datos.</Text>
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Nombre(s)</Text>
        <TextInput
          value={value.nombres}
          onChangeText={(t) => setField("nombres", t)}
          editable={!disabled}
          placeholder="Ej. Ana María"
          placeholderTextColor={COLORS.slate400}
          style={styles.input}
        />
      </View>

      <View style={styles.row}>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Primer apellido</Text>
          <TextInput
            value={value.primerApellido}
            onChangeText={(t) => setField("primerApellido", t)}
            editable={!disabled}
            placeholder="López"
            placeholderTextColor={COLORS.slate400}
            style={styles.input}
          />
        </View>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Segundo apellido</Text>
          <TextInput
            value={value.segundoApellido}
            onChangeText={(t) => setField("segundoApellido", t)}
            editable={!disabled}
            placeholder="Ruiz"
            placeholderTextColor={COLORS.slate400}
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Fecha de nacimiento</Text>
          <TextInput
            value={value.fechaNacimiento}
            onChangeText={(t) => setField("fechaNacimiento", formatFechaInput(t))}
            editable={!disabled}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={COLORS.slate400}
            style={[styles.input, styles.mono]}
          />
        </View>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Sexo</Text>
          <View style={styles.segmentRow}>
            {(["M", "H"] as const).map((s) => {
              const active = value.sexo === s;
              return (
                <Pressable
                  key={s}
                  disabled={disabled}
                  onPress={() => setField("sexo", s)}
                  style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {s === "M" ? "Mujer" : "Hombre"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Estado de nacimiento</Text>
        <Pressable
          disabled={disabled}
          onPress={() => setShowEntidadPicker(true)}
          style={[styles.input, styles.pickerTrigger]}
        >
          <Text style={value.entidad ? styles.pickerValue : styles.pickerPlaceholder}>
            {value.entidad ? ENTIDADES[value.entidad] : "Elige el estado"}
          </Text>
          <Text style={styles.chevron}>▾</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Teléfono fijo</Text>
          <TextInput
            value={value.telefonoFijo}
            onChangeText={(t) => setField("telefonoFijo", t.replace(/\D/g, "").slice(0, 10))}
            editable={!disabled}
            keyboardType="phone-pad"
            maxLength={10}
            placeholder="10 dígitos"
            placeholderTextColor={COLORS.slate400}
            style={[styles.input, styles.mono]}
          />
        </View>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Correo</Text>
          <TextInput
            value={value.email}
            onChangeText={(t) => setField("email", t)}
            editable={!disabled}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="nombre@correo.com"
            placeholderTextColor={COLORS.slate400}
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Familiar o contacto de emergencia</Text>
        <TextInput
          value={value.contactoNombre}
          onChangeText={(t) => setField("contactoNombre", t)}
          editable={!disabled}
          placeholder="Nombre completo del familiar"
          placeholderTextColor={COLORS.slate400}
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Parentesco del familiar</Text>
        <Pressable
          disabled={disabled}
          onPress={() => setShowParentescoPicker(true)}
          style={[styles.input, styles.pickerTrigger]}
        >
          <Text style={value.contactoParentesco ? styles.pickerValue : styles.pickerPlaceholder}>
            {value.contactoParentesco
              ? ETIQUETA_PARENTESCO[value.contactoParentesco]
              : "Elige qué es de la paciente"}
          </Text>
          <Text style={styles.chevron}>▾</Text>
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Teléfono del familiar (10 dígitos)</Text>
        <TextInput
          value={value.contactoTelefono}
          onChangeText={(t) => setField("contactoTelefono", t.replace(/\D/g, "").slice(0, 10))}
          editable={!disabled}
          keyboardType="phone-pad"
          maxLength={10}
          placeholder="667 000 0000"
          placeholderTextColor={COLORS.slate400}
          style={[styles.input, styles.mono]}
        />
      </View>

      <Modal
        visible={showParentescoPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowParentescoPicker(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Parentesco del familiar</Text>
              <Pressable onPress={() => setShowParentescoPicker(false)}>
                <Text style={styles.modalClose}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.modalList}>
              {OPCIONES_PARENTESCO.map((opt) => {
                const selected = value.contactoParentesco === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setField("contactoParentesco", opt.value);
                      setShowParentescoPicker(false);
                    }}
                    style={[styles.optionRow, selected && styles.optionRowSelected]}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showEntidadPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEntidadPicker(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Estado de nacimiento</Text>
              <Pressable onPress={() => setShowEntidadPicker(false)}>
                <Text style={styles.modalClose}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.modalList}>
              {OPCIONES_ENTIDAD.map(([clave, nombre]) => {
                const selected = value.entidad === clave;
                return (
                  <Pressable
                    key={clave}
                    onPress={() => {
                      setField("entidad", clave);
                      setShowEntidadPicker(false);
                    }}
                    style={[styles.optionRow, selected && styles.optionRowSelected]}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {nombre}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  half: {
    flex: 1,
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    color: COLORS.slate700,
    fontWeight: "500",
  },
  optional: {
    fontWeight: "400",
    color: COLORS.slate500,
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.slate300,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.slate900,
    backgroundColor: COLORS.white,
  },
  mono: {
    fontFamily: "monospace",
  },
  mutedHint: {
    fontSize: 11,
    color: COLORS.slate500,
  },
  okHint: {
    fontSize: 11,
    color: COLORS.teal800,
    fontWeight: "500",
  },
  errorHint: {
    fontSize: 11,
    color: COLORS.red700,
  },
  segmentRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: COLORS.slate300,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: COLORS.slate50,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: COLORS.teal700,
  },
  segmentText: {
    fontSize: 13,
    color: COLORS.slate700,
    fontWeight: "500",
  },
  segmentTextActive: {
    color: COLORS.white,
  },
  pickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerValue: {
    fontSize: 14,
    color: COLORS.slate900,
  },
  pickerPlaceholder: {
    fontSize: 14,
    color: COLORS.slate400,
  },
  chevron: {
    fontSize: 14,
    color: COLORS.slate500,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "75%",
    paddingBottom: 24,
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
    fontWeight: "600",
    color: COLORS.slate900,
  },
  modalClose: {
    fontSize: 14,
    color: COLORS.teal700,
    fontWeight: "600",
  },
  modalList: {
    paddingHorizontal: 12,
  },
  optionRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  optionRowSelected: {
    backgroundColor: COLORS.teal50,
  },
  optionText: {
    fontSize: 15,
    color: COLORS.slate900,
  },
  optionTextSelected: {
    color: COLORS.teal800,
    fontWeight: "600",
  },
});
