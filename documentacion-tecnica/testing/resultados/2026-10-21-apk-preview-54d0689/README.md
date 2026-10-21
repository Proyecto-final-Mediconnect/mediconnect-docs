# Checklist de emulador Android — APK `preview` de la release 2.0.0

Primera corrida completa del [checklist de testing manual](../../checklist-emulador-android.md) (ENG-121), sobre el APK de la demo (ENG-119, F1.7 del Plan de cierre). Es la evidencia que le faltó a mobile #11 al mergearse.

| | |
| --- | --- |
| **Fecha** | 21/10/2026 |
| **Quién** | Felipe Becerra |
| **Entorno** | Pixel 6 · Android 14 (API 34) · Google APIs x86_64 · AVD de referencia |
| **Build** | EAS `cbb9124b-db3d-4580-8ed7-417405579ebc`, perfil **`preview`**, `main` en `54d0689` |
| **App** | `ar.mediconnect.app` 0.0.0 (versionCode 1), instalada con `adb install` |
| **Backend** | Producción: `https://mediconnect-backend-smss.onrender.com` |
| **Cuenta** | `paciente.demo@mediconnect.test` (datos sintéticos del seed de demo) |

## Resultado

```markdown
### Checklist de emulador Android (ENG-121)

Entorno: Pixel 6 · Android 14 (API 34) · perfil `preview`

- [x] 1. Arranque en frío
- [ ] 2. Permisos denegados — no aplica
- [x] 3. Sin conexión
- [ ] 4. Sesión vencida — no ejecutable sobre este build
- [x] 5. Rotación de pantalla
- [x] 6. Volver desde segundo plano
```

### 1. Arranque en frío — OK

- Sin sesión, la app abre directo en "Ingresá a tu cuenta", sin pantalla en blanco ni contenido sin estilo ([`00-primer-arranque.png`](00-primer-arranque.png)).
- Con sesión, después de cerrar el proceso (`am force-stop`, equivalente a quitarla de recientes), muestra "Abriendo MediConnect…" ([`01b-arranque-2s.png`](01b-arranque-2s.png)) y entra al inicio de Julián con la sesión intacta ([`01c-arranque-12s.png`](01c-arranque-12s.png)).

### 2. Permisos denegados — no aplica

**La app no pide ningún permiso en tiempo de ejecución.** El APK declara `CAMERA`, `RECORD_AUDIO` y `POST_NOTIFICATIONS` porque los traen `expo-camera` y `expo-notifications` al instalarse, pero ninguna pantalla los importa ni los pide (`grep` sobre `src/` en `54d0689`):

- El escaneo del MediPass desde el celular quedó fuera de alcance (decisión D3; ENG-118 en Backlog).
- El push todavía no existe (F3.2, ENG-71).
- La videoconsulta se abre en el navegador (`WebBrowser.openBrowserAsync`), que pide cámara y micrófono por su cuenta.

Se vuelve a correr cuando entre la primera pantalla que pida un permiso.

### 3. Sin conexión — OK

Grabación: [`03-sin-conexion.mp4`](03-sin-conexion.mp4).

- Con WiFi y datos apagados (`svc wifi disable`, `svc data disable`), "Mis turnos" dice **en la pantalla** "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo", con el botón "Probá de nuevo" ([`03a-sin-red.png`](03a-sin-red.png)).
- Con la red de vuelta, el primer reintento coincidió con la reconexión y volvió a mostrar el error ([`03b-red-vuelve-reintento.png`](03b-red-vuelve-reintento.png)). Segundos después la lista cargó completa, sin datos a medias ([`03c-tras-espera.png`](03c-tras-espera.png)).
- **No probado:** "nada de lo escrito se perdió". En esta pasada no se dejó ningún campo a medio llenar con la red cortada. Los únicos campos de texto de la app son el login y el buscador de profesionales (`ProfessionalsScreen`); la próxima corrida tiene que cortar la red con una búsqueda escrita.

### 4. Sesión vencida — no ejecutable sobre este build

La receta anterior del checklist ("cerrar sesión desde la web con el mismo usuario") **no invalida la sesión del celular, y está bien que no lo haga**: las sesiones de la web y de la app son independientes, y `POST /auth/logout` solo borra las cookies del navegador. La alternativa ("borrar el token del secure storage") no es posible en un build de release.

Lo que sí corta todas las sesiones es cambiar la contraseña (ENG-142, `signOut({ scope: 'global' })`), pero el enlace de recuperación de una cuenta `@mediconnect.test` no llega a ninguna casilla. Bloquear la cuenta desde Supabase se descartó porque toca la cuenta demo que usa todo el equipo.

**Se corrigió la receta del punto 4 en el checklist** para usar el cambio de contraseña con una cuenta de prueba cuya casilla sea de alguien del equipo. El comportamiento esperado está implementado en `src/features/auth/session.tsx` (vuelve al login con "Tu sesión terminó. Iniciá sesión de nuevo.") y cubierto por sus tests. Queda pendiente correrlo a mano con esa cuenta.

### 5. Rotación de pantalla — OK

Con la rotación del sistema forzada a horizontal (`accelerometer_rotation 0`, `user_rotation 1`), la app siguió en vertical y entera: `ROTATION_0`, 1080×2400 ([`05-rotacion-forzada.png`](05-rotacion-forzada.png)). Es lo que fija `orientation: "portrait"`.

### 6. Volver desde segundo plano — OK

Grabación: [`06-segundo-plano.mp4`](06-segundo-plano.mp4).

En MediPass ([`06a-antes-medipass.png`](06a-antes-medipass.png)), la app se mandó al fondo, se abrió Ajustes y se esperaron 75 s. El sistema no mató el proceso, y al volver estaba en la misma pantalla ([`06b-al-volver.png`](06b-al-volver.png)). El código QR quedó **oculto a propósito** ("Lo ocultamos cuando saliste de la app"): es una medida de privacidad, no estado perdido.

## Observaciones fuera del checklist

1. **El MediPass del celular sigue con datos de ejemplo.** Muestra "Vista previa con datos de ejemplo: tu MediPass todavía no está disponible" con datos inventados (código `MP-AR-…`, "Dra. Valeria Ocampo", "0 Rh+", "41 años"). La API real ya existe desde backend #68: falta conectar la pantalla mobile.
2. **El APK declara permisos que no usa** (`CAMERA`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`). No rompe nada, pero un usuario que revisa los permisos de la app ve pedidos que la app nunca hace.
3. **`versionName` es `0.0.0`.** Conviene numerar la versión antes del build de la defensa, para poder decir qué APK se mostró.
