# Aplicación Android

La aplicación Android usa Capacitor como contenedor de la página `/app` de Next.js. El backend sigue ejecutándose en Next.js y PostgreSQL; no se empaqueta como una aplicación web estática porque el flujo móvil usa API Routes, cookies de sesión y SSE.

## Emulador Android

1. Inicia PostgreSQL y el backend desde la raíz del proyecto:

   ```powershell
   npm run dev:mobile
   ```

   `dev:mobile` enlaza Next.js a todas las interfaces de red para que el emulador pueda acceder al servidor.

2. Sincroniza y abre el proyecto nativo:

   ```powershell
   npm run cap:sync
   npm run cap:open
   ```

3. En Android Studio, espera a que Gradle termine de sincronizar, elige un emulador e inicia la configuración `app`.

La URL predeterminada es `http://10.0.2.2:3000/app`: `10.0.2.2` es la dirección especial con la que el emulador Android llega al `localhost` de Windows.

El proyecto usa Gradle 8.13 y requiere JDK 21. Si Android Studio selecciona otro JDK, cambia **Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK** a JDK 21.

## Dispositivo Android físico

Conecta el teléfono y la PC a la misma red Wi-Fi. Inicia Next.js con `npm run dev:mobile`, obtiene la IPv4 de la PC con `ipconfig` y establece la URL antes de sincronizar:

```powershell
$env:CAPACITOR_SERVER_URL = "http://192.168.1.20:3000/app"
npm run cap:sync
npm run cap:open
```

Reemplaza `192.168.1.20` por la IPv4 real de la PC. Si Windows Firewall pregunta, permite conexiones entrantes privadas para Node.js en el puerto 3000.

## Backend desplegado

Para una compilación destinada a distribución, usa una URL HTTPS pública:

```powershell
$env:CAPACITOR_SERVER_URL = "https://tu-dominio.example/app"
npm run cap:sync
```

El proyecto permite tráfico HTTP sin cifrar únicamente en la variante `debug`; la variante `release` lo bloquea. No distribuyas un APK que apunte al emulador o a un servidor de desarrollo. Genera el APK/AAB de release desde Android Studio con la URL HTTPS configurada y prueba inicio de sesión, cookies, API y eventos SSE contra ese backend.

## Notas

- `capacitor.config.ts` usa `CAPACITOR_SERVER_URL` si está definida; en otro caso apunta al emulador.
- `npm run cap:sync` vuelve a copiar la configuración al proyecto Android.
- Los cambios de UI siguen haciéndose en `app/app/page.tsx` y componentes React; recarga la página para verlos en el emulador mientras Next.js está activo.
- No se requieren permisos de cámara, ubicación ni notificaciones para el flujo actual. Las notificaciones push necesitarían integrar Firebase y configurar `google-services.json`.
