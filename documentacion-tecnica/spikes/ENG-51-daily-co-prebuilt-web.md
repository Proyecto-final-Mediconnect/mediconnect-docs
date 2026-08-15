# ENG-51 — Spike: Integración con Daily.co Prebuilt en web

**Épica:** EP-05 (Videoconsulta) · **Sprint 4** (planificado en el Sprint 3) · **5 SP** · **Tipo:** Spike
**Autor:** Magris

## Objetivo

Confirmar que el flujo *crear sala → embeber → llamar* funciona en la web antes de
comprometer el módulo de videoconsulta (ENG-56), y dejar decidido cómo se crea y
se protege una sala de consulta médica.

Los tres criterios de aceptación de la issue:

1. Sala creada vía API REST de Daily desde el backend NestJS.
2. Embed funcionando en una página de prueba de la web (iframe).
3. Métricas de latencia y calidad en una llamada de prueba de 30 minutos.

> **Alcance recortado a web el 12/08/2026.** El criterio original *"embed
> funcionando en la app mobile con el SDK de React Native"* se quitó: el
> repositorio mobile no tiene navegación, login ni cliente de API, y el Sprint 0
> planifica la configuración de Expo + EAS Build para el Release 4. La validación
> de Daily en mobile se redefine en el Planning del 15/08 y se abre como ticket
> propio.

## Qué se construyó

| Artefacto | Dónde |
|---|---|
| Cliente de la API REST de Daily | `mediconnect-backend/src/video/daily.service.ts` |
| Configuración de la sala (TTL, propiedades, tope de participantes) | `mediconnect-backend/src/video/daily.config.ts` |
| Endpoints `/video/spike/*` | `mediconnect-backend/src/video/video.controller.ts` |
| Embed del Prebuilt | `mediconnect-web/src/features/video/components/DailyPrebuiltFrame.tsx` |
| Banco de pruebas (`/spike/daily`) | `mediconnect-web/src/features/video/components/SpikeRoomPanel.tsx` |
| 29 tests unitarios + 7 e2e | `src/video/*.spec.ts`, `test/video.e2e-spec.ts` (backend) y `src/features/video/**/*.test.tsx` (web) |

Todo lo del spike vive bajo el prefijo `spike`: la ruta de la web es `/spike/daily`,
los endpoints cuelgan de `/video/spike` y las salas se llaman
`spike-eng51-<8 hex>`. **No es producto** — ENG-56 arranca desde un turno
confirmado y no deja crear salas a mano. `DailyService` sí queda: es la pieza que
ese ticket va a reusar.

---

## 1. Crear la sala desde el backend

`POST https://api.daily.co/v1/rooms` con `Authorization: Bearer <DAILY_API_KEY>`.
Son llamadas HTTP planas, así que el spike **no agrega ninguna dependencia**:
Node 22+ trae `fetch` global y el service es un wrapper de ~100 líneas.

### La API key no puede viajar al navegador

`DAILY_API_KEY` es una credencial de **cuenta**: con ella se crean salas, se
emiten tokens y se leen las grabaciones de todo el dominio. Si estuviera en el
bundle de la web, cualquiera podría gastar la cuota del proyecto o entrar a
cualquier consulta. Por eso el front nunca habla con `api.daily.co`: pide la sala
al backend, que es el único que tiene la key y el único que firma los tokens.

Es opcional en `env.validation`, igual que `SENTRY_DSN`: sin ella el backend
bootea normal y solo los endpoints de video responden 503 explicando qué falta.
En CI y en local no hay credenciales de terceros.

### Sala privada + meeting token, no sala pública

Es la decisión más importante del spike.

Una sala **pública** de Daily es accesible por cualquiera que tenga la URL. La URL
de una consulta médica termina en un historial de navegación, en un chat, en un
log de servidor o en una captura de pantalla; tratarla como secreto es tratar como
secreto algo que el sistema reparte por todos lados.

Con `privacy: "private"`, la URL sola no alcanza: para entrar hace falta un
**meeting token** (`POST /meeting-tokens`) firmado por el dominio, que solo emite
el backend y que lleva `room_name` y `exp` adentro. Es exactamente el control que
ENG-56 necesita — "solo el paciente y el profesional de *este* turno entran a
*esta* sala" — y por eso se validó acá y no allá.

El backend emite **dos** tokens por sala:

| Rol | `is_owner` | Por qué |
|---|---|---|
| Profesional | `true` | Habilita los controles de moderación del Prebuilt (silenciar, expulsar). |
| Paciente | `false` | El paciente no debería poder sacar al profesional de su propia consulta. |

### Propiedades de la sala

```jsonc
{
  "privacy": "private",
  "properties": {
    "exp": <ahora + 40 min>,     // la sala expira sola
    "eject_at_room_exp": true,   // y al expirar saca a todos
    "max_participants": 2,       // paciente + profesional
    "enable_prejoin_ui": true,   // elegir cámara/mic antes de entrar
    "enable_network_ui": true,   // indicador de calidad de conexión
    "enable_screenshare": true,
    "enable_chat": true,
    "enable_recording": false
  }
}
```

Tres de estas merecen justificación:

- **`max_participants: 2`** es la primera línea de defensa, antes del token: si el
  link se filtrara, un tercero no entra porque la sala ya está llena.
- **`eject_at_room_exp: true`**: sin esto, `exp` solo impide *entrar*. Los que ya
  están adentro siguen consumiendo minutos facturables indefinidamente.
- **`enable_recording: false`**: grabar una consulta médica tiene implicancias de
  la Ley 25.326 (consentimiento, retención, derechos ARCO) que no se resuelven en
  un spike. La grabación de audio para el pipeline de IA (EP-07) se define en su
  propio ticket, con su base legal.

**`enable_prejoin_ui`** no es cosmético en este dominio: entrar a una consulta con
la cámara prendida sin querer es un problema de privacidad, no una molestia.

### Manejo de errores

Cualquier fallo de Daily se expone como **502** (o **503** si es de red/timeout),
nunca con el status del proveedor. Un 401 de Daily —API key vencida— propagado tal
cual haría que la web creyera que venció la sesión *del usuario* e intentara
renovarla en loop. El problema es del proveedor y así se comunica.

---

## 2. El embed en la web

**Prebuilt es una app web completa servida por Daily.** No hace falta ningún SDK
para embeberla: alcanza con un `<iframe>` apuntado a la URL de la sala (con el
token). Por eso el spike no incorpora `@daily-co/daily-js`.

Cuándo *sí* haría falta ese SDK, para que ENG-56 lo evalúe con criterio:

| Necesidad | ¿Alcanza el iframe? |
|---|---|
| Mostrar la videollamada con la UI de Daily | Sí |
| Compartir pantalla, chat, pantalla previa | Sí (son propiedades de la sala) |
| Saber desde React cuándo alguien entró/salió | No — hacen falta los eventos de `daily-js` |
| Terminar la llamada desde código (al cerrarse el turno) | No |
| UI propia (layout, branding, controles a medida) | No — ahí se usa el modo *custom*, no Prebuilt |
| Leer estadísticas de red en vivo (`getNetworkStats()`) | No |

### Lo único que puede romper el embed

```tsx
<iframe
  src={roomUrl}
  allow="camera; microphone; autoplay; display-capture; fullscreen; clipboard-write"
/>
```

Un iframe **cross-origin no hereda** los permisos de cámara y micrófono de la
página que lo contiene: hay que delegarlos explícitamente con `allow`
(Permissions Policy). Sin eso, Prebuilt carga perfecto y recién falla al pedir los
dispositivos, con un error que parece de Daily y es del navegador. Es la falla más
fácil de diagnosticar mal, así que hay un test que fija cada permiso.

Los otros dos requisitos del navegador, para que no sorprendan en la demo:

- **HTTPS obligatorio** (o `localhost`): `getUserMedia` no funciona sobre HTTP
  plano. En local Vite sirve `localhost`, así que anda; una demo desde la IP de la
  máquina en la red del aula, no.
- **Un solo `<iframe>` de Daily por pestaña.** Para probar con dos participantes
  hay que abrir el link del paciente en **otra pestaña o en otra máquina** — que
  es como lo hace el banco de pruebas.

---

## 3. Métricas de la llamada de 30 minutos

### ⚠ Estado: pendiente de ejecutar

La medición del criterio 3 **requiere una cuenta de Daily con `DAILY_API_KEY`
cargada y dos personas en la llamada durante 30 minutos**. El código para
ejecutarla y para recolectar los números está terminado y probado; los valores
todavía no están tomados.

Se deja el protocolo completo para que la corrida dé números comparables y
repetibles, y no una anécdota.

### Protocolo

1. Cargar `DAILY_API_KEY` en el `.env` del backend y levantar backend + web.
2. Entrar a `/spike/daily` con un usuario logueado y crear la sala.
3. Persona A queda en el iframe (rol profesional). Persona B abre
   *"Entrar como paciente"* **en otra máquina y en otra red** — dos pestañas de la
   misma computadora comparten conexión y no miden nada útil.
4. Sostener la llamada **30 minutos**, y a los minutos 5, 15 y 25 anotar lo que
   muestra el indicador de red del Prebuilt (arriba a la derecha).
5. Durante la llamada, hacer al menos una vez: compartir pantalla, silenciar y
   volver a activar el micrófono, y apagar y prender la cámara.
6. Salir los dos de la sala. Esperar ~1 minuto y tocar *"Ver métricas de la
   sesión"*: Daily publica los datos de la sesión recién cuando termina.
7. Borrar la sala con el botón *"Borrar sala"*.

### Tabla a completar

| Métrica | Persona A | Persona B | De dónde sale |
|---|---|---|---|
| Fecha y hora de la prueba | | | — |
| Conexión (fibra / 4G / WiFi compartido) | | | — |
| Duración efectiva | | | `GET /video/spike/rooms/:name/sessions` |
| Minutos de participante | | | idem (es lo que factura Daily) |
| Calidad de red min. 5 / 15 / 25 | | | indicador del Prebuilt |
| Latencia percibida (audio ida y vuelta) | | | subjetiva: contar en voz alta y cronometrar |
| Cortes de video (cuántos, cuánto) | | | observación |
| Cortes de audio | | | observación |
| ¿Funcionó compartir pantalla? | | | observación |
| ¿Se cayó y reconectó solo? | | | observación |
| CPU del navegador durante la llamada | | | administrador de tareas del navegador |

### Qué se considera aprobado

El spike valida la integración si, en la corrida:

- la llamada se sostiene los 30 minutos sin que ninguno tenga que recargar;
- el audio nunca se corta más de 2 segundos seguidos;
- el indicador de red se mantiene en verde/amarillo en las tres mediciones;
- compartir pantalla funciona en los dos sentidos.

Si algo de esto falla **en una conexión razonable**, hay que revisar la elección
del ADR-010 antes de que ENG-56 se apoye en ella.

### El número que importa para el costo

Daily factura por **minuto de participante**, no por minuto de sala: una consulta
de 30 minutos entre dos personas consume **60**. El endpoint de métricas lo
devuelve calculado (`participantMinutes`) justamente para poder proyectar:

```
minutos/mes = consultas/mes × duración promedio × 2 participantes
```

Los umbrales y el precio del plan Free hay que **confirmarlos en el pricing
vigente** (se mueven), pero la fórmula y de dónde sale cada número quedan fijados
acá. Con la cuota conocida, `minutos/mes` dice directamente cuántas consultas
entran gratis.

---

## Riesgos identificados

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Sala olvidada abierta consumiendo minutos | Costo | `exp` + `eject_at_room_exp` en toda sala; ninguna se crea sin expiración. |
| API key filtrada al bundle del front | Alto (cuenta comprometida) | El front nunca llama a Daily; la key solo existe en el backend. |
| URL de consulta filtrada | Alto (privacidad médica) | Sala privada + meeting token con `exp`; `max_participants: 2`. |
| Demo sobre HTTP plano | La cámara no arranca | Desplegar la web con HTTPS; en local, usar `localhost`. |
| Daily caído el día de la demo | Bloqueante | El backend ya distingue 502/503; ENG-56 debería mostrar un mensaje claro y no un spinner infinito. |

## Conclusiones para ENG-56

1. **Usar sala privada + meeting token por participante**, emitido al momento de
   entrar y con `exp` acotado a la ventana del turno. Nunca salas públicas.
2. **Crear la sala al confirmarse el turno**, no al reservarlo: un turno en
   `RESERVADO_SIN_PAGAR` que se libera a los 15 minutos (ENG-101) no debería haber
   creado nada en Daily.
3. **Persistir `daily_room_name` y `daily_room_url` en `video_sessions`** — las
   columnas ya existen en el modelo de datos — y derivar el token en cada entrada
   en vez de guardarlo: el token es una credencial con vencimiento, no un dato.
4. **Reusar `DailyService`**: ya está exportado por `VideoModule` y probado.
5. **Evaluar `@daily-co/daily-js`** solo si ENG-56 necesita saber desde React
   cuándo entra o sale alguien, o cerrar la llamada por código (ver la tabla de la
   sección 2). Para mostrar la sala, el iframe alcanza.
6. **Borrar `/video/spike/*` y `/spike/daily`** cuando ENG-56 esté mergeado. Son
   andamio, no producto.

## Cómo correr

```bash
# backend
cd mediconnect-backend
echo 'DAILY_API_KEY="<key del dashboard de Daily>"' >> .env
pnpm run start:dev
pnpm test src/video        # 29 unitarios, sin red
pnpm run test:e2e video    # 7 e2e del borde HTTP

# web
cd mediconnect-web
pnpm run dev               # entrar a /spike/daily con sesión iniciada
pnpm run test:run src/features/video
```

Sin `DAILY_API_KEY` todo compila, los tests pasan y la página muestra el 503
explicando qué falta.

{{references}}
Daily REST API — Create room, https://docs.daily.co/reference/rest-api/rooms/create-room
Daily REST API — Meeting tokens, https://docs.daily.co/reference/rest-api/meeting-tokens
Daily REST API — Meetings (analytics), https://docs.daily.co/reference/rest-api/meetings
Daily Prebuilt — Embedding, https://docs.daily.co/guides/products/prebuilt
Permissions Policy — allow attribute on iframes, https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy
MediaDevices.getUserMedia — secure context requirement, https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
Daily Pricing, https://www.daily.co/pricing
{{/references}}
