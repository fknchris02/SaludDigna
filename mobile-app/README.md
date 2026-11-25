# Salud Digna · App Móvil (Expo + SWI)

Aplicación móvil multiplataforma (**React Native + Expo + TypeScript**) creada desde cero con la misma interfaz visual que la app del paciente de `SaludDigna` (`/app`) y conectada directamente a la API central **`SWI-Salud Digna`** en **`http://10.35.11.66:3000`** (`canal: "APP"`), compatible en tiempo real con `WEB-CLINICA`, WhatsApp, Web y Call Center.

## Requisitos en red local

- El servidor central **`SWI-Salud Digna`** debe estar encendido en **`http://10.35.11.66:3000`** con el puerto `3000` abierto en su firewall.
- El teléfono (con **Expo Go**) o emulador debe estar en la misma red Wi-Fi (`10.35.x.x`).

## Configuración

Por defecto la app ya apunta a:
- `EXPO_PUBLIC_SWI_URL=http://10.35.11.66:3000`
- `EXPO_PUBLIC_SWI_API_KEY=demo-canales-2026`

Si necesitas cambiar la IP o llave sin tocar el código, copia `.env.example` a `.env` y ajusta las variables.

## Comandos

```powershell
cd "C:\HACKATECK 2026\SaludDigna\mobile-app"
npm start          # Inicia Expo (escanea el QR con Expo Go en Android o iOS)
npm run android    # Abre en emulador / dispositivo Android conectado
npm run typecheck  # Validación TypeScript
npm test           # Pruebas unitarias (Vitest)
```
