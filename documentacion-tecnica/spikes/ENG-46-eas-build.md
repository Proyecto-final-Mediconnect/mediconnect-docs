# ENG-46 — Spike: Exploración de Expo EAS Build y distribución mobile

**Épica:** EP-10 (Plataforma e Infraestructura) · **Sprint 2** · **3 SP** · **Tipo:** Spike
**Autor:** Felipe Becerra

## Objetivo

Entender el proceso completo de build y distribución con Expo EAS antes de
necesitar generar builds de testing, y destrabar ENG-99 (Sentry en mobile), que
requiere un rebuild nativo y hoy está bloqueada por este spike.

Este documento responde los tres criterios de aceptación de la issue:

1. Generar al menos un build de desarrollo exitoso para Android vía EAS.
2. Documentar el proceso y las variables de entorno necesarias.
3. Identificar los tiempos de espera reales en la cola de EAS Free.

> **Estado: parcial.** Los criterios 1 y 3 requieren una cuenta de Expo y builds
> reales, que al momento de escribir esto no existen (ver §5). Este documento
> cierra el criterio 2 y deja los otros dos listos para ejecutar, con los pasos
> exactos y los valores esperados contra los que comparar.

---

## 1. Estado de partida del repositorio

Verificado sobre `mediconnect-mobile` en `main` (`b9772c8`):

| Comprobación | Resultado |
| --- | --- |
| `eas-cli` disponible | ✅ `eas-cli/21.7.1` vía `npx` |
| Sesión de Expo | ❌ `Not logged in` |
| `app.json` → `extra.eas.projectId` | ❌ `"TODO-set-on-eas-init"` (placeholder) |
| `expo config` resuelve | ✅ SDK `56.0.0`, plataformas `ios`/`android` |
| Identificadores | ✅ `ar.mediconnect.app` en iOS y Android |
| `eas.json` | ✅ presente, con perfiles `development`, `preview`, `production` |
| `EXPO_TOKEN` documentado | ✅ ya está en `.env.example` |
| CI en `main` | ✅ desde el merge del PR #3 |

### 1.1 Hallazgo: falta `expo-dev-client`

`eas.json` declara el perfil de desarrollo así:

```json
"development": {
  "developmentClient": true,
  "distribution": "internal"
}
```

Pero **`expo-dev-client` no está en las dependencias del proyecto**. Las
dependencias actuales son: `expo`, `expo-camera`, `expo-notifications`,
`expo-secure-store`, `expo-status-bar`, `react`, `react-native`.

La documentación de Expo es explícita: `developmentClient: true` "indica que
este build depende de `expo-dev-client`". Sin ese paquete instalado, el perfil
`development` no puede producir un development build funcional.

**Acción requerida antes del primer build:**

```sh
npx expo install expo-dev-client
```

---

## 2. Proceso de build, paso a paso

### 2.1 Alta y configuración inicial

```sh
npm install --global eas-cli   # o usar npx eas-cli@latest
eas login                      # requiere cuenta de Expo
eas build:configure            # escribe el projectId real en app.json
npx expo install expo-dev-client
```

`eas build:configure` es el paso que reemplaza el placeholder
`"TODO-set-on-eas-init"` por el `projectId` real del proyecto en EAS. Ese valor
**sí se versiona**: es el identificador que vincula el repositorio con el
proyecto en la cuenta de Expo.

### 2.2 Primer build de desarrollo para Android

```sh
eas build --platform android --profile development
```

El primer build es el que **crea las credenciales**. Para Android, EAS genera y
guarda un keystore automáticamente; no hace falta cuenta de Google Play ni
ningún trámite previo. Es importante que este primer build se corra de forma
interactiva: la documentación de CI advierte que la creación de credenciales
debe ocurrir en un build inicial, antes de automatizar.

### 2.3 Perfiles de `eas.json`

| Perfil | Qué hace | Artefacto Android |
| --- | --- | --- |
| `development` | `developmentClient: true` — incluye herramientas de desarrollo, nunca va a una tienda | `.apk` |
| `preview` | `distribution: "internal"` — build de prueba instalable | `.apk` |
| `production` | `autoIncrement: true` — para publicación | `.aab` |

`distribution: "internal"` permite instalar directamente en dispositivos
físicos. Para Android, la distribución interna produce **`.apk`** por defecto;
si se quiere dejar explícito, se declara `"buildType": "apk"` en la sección
`android` del perfil. El `.aab` es el formato para Google Play.

---

## 3. Distribución a los dispositivos del equipo

### 3.1 Android — sin costo ni trámites

No hace falta ninguna cuenta de desarrollador. EAS firma el build con un
keystore que genera él mismo, y el `.apk` resultante se instala directamente en
el dispositivo: por descarga desde el enlace que devuelve EAS, por USB, o
pasándolo por mensajería.

**Para el proyecto esto significa que la ruta de testing en Android es gratis y
sin fricción.** Es el camino que conviene usar durante el desarrollo.

### 3.2 iOS — requiere cuenta paga

iOS es otra historia. Requiere **cuenta de Apple Developer** y registro previo
de dispositivos:

- **Ad Hoc:** hay que registrar los UDID de cada dispositivo de antemano.
  Límite de 100 dispositivos por año por app. Cada dispositivo nuevo obliga a
  correr `eas device:create` y volver a compilar.
- **Enterprise:** dispositivos ilimitados, pero exige membresía del Apple
  Developer Enterprise Program.

> **Decisión pendiente para el equipo:** la cuenta de Apple Developer tiene
> costo anual. Mientras no se pague, **no hay forma de probar en iOS**, ni
> siquiera internamente. Conviene definir si el alcance del proyecto incluye
> iOS o si se demuestra solo en Android.

---

## 4. Limitaciones del plan Free

Datos del pricing oficial de Expo:

| Aspecto | Plan Free |
| --- | --- |
| Builds incluidos | **15 Android + 15 iOS por mes** |
| Concurrencia | **1** (un build a la vez) |
| Prioridad en la cola | **Baja** |
| Espera en cola | **90+ minutos** según demanda |
| Modelo | Límite mensual, no créditos: agotados los builds, no se puede compilar hasta el siguiente ciclo |

Los planes pagos ofrecen cola de alta prioridad, que apunta a espera cero, y
concurrencia adicional a USD 50 por cada una.

### 4.1 Qué implica para el proyecto

- **15 builds de Android por mes es poco** si se usan a la ligera. Con un equipo
  de 5 personas, conviene que los builds los dispare una sola persona y solo
  cuando haga falta probar en dispositivo, no en cada push.
- **La espera de 90+ minutos desaconseja poner EAS Build en el CI de cada PR.**
  El pipeline de CI debe seguir corriendo lint, typecheck y tests, y los builds
  quedar como acción manual o por release.
- **Concurrencia 1** significa que si dos personas disparan builds, el segundo
  espera al primero además de la cola.

> **Pendiente de medición (criterio de aceptación 3):** los "90+ minutos" son el
> valor que declara Expo, no una medición nuestra. Al correr los primeros builds
> hay que registrar el tiempo real de cola y compilación, y actualizar esta
> sección con esos números.

---

## 5. Bloqueo actual: no hay cuenta de Expo

`eas whoami` devuelve `Not logged in`, y el `projectId` sigue en su valor
placeholder. **Sin una cuenta de Expo no se puede ejecutar `eas build:configure`
ni generar ningún build**, con lo cual los criterios de aceptación 1 y 3 quedan
abiertos.

Decisiones que el equipo tiene que tomar:

1. **Quién crea la cuenta de Expo** y bajo qué email. Igual que con Sentry,
   conviene que sea una cuenta del proyecto y no personal, para que no dependa
   de una sola persona.
2. **Si se paga la cuenta de Apple Developer** o el alcance se limita a Android.
3. **Quién dispara los builds**, dado el límite de 15 por mes y la concurrencia
   de 1.

---

## 6. Integración con CI

Cuando exista la cuenta, la automatización se hace con `EXPO_TOKEN`, un token de
acceso personal que se genera desde la configuración de la cuenta de Expo y se
carga como secret del repositorio. La variable **ya está documentada** en el
`.env.example` de `mediconnect-mobile`.

El workflow usa la action oficial de Expo y un build no interactivo:

```yaml
- uses: expo/expo-github-action@v8
  with:
    eas-version: latest
    token: ${{ secrets.EXPO_TOKEN }}

- name: Build on EAS
  run: eas build --platform android --profile development --non-interactive --no-wait
```

- `--non-interactive` evita cualquier prompt.
- `--no-wait` corta apenas se encola el build, en vez de quedarse esperando. Con
  colas de 90+ minutos esto es imprescindible: sin esa bandera el job de CI se
  quedaría bloqueado consumiendo minutos de runner.

**Recomendación:** que este workflow **no** corra en cada PR. Debe ser
`workflow_dispatch` (manual) o dispararse solo sobre `release/**`, por el límite
de 15 builds mensuales.

---

## 7. Conclusiones para la implementación

1. **La ruta de Android es viable y gratuita.** Instalar `expo-dev-client`,
   correr `eas build:configure` y un primer build interactivo alcanza para tener
   un `.apk` instalable en los teléfonos del equipo.
2. **`expo-dev-client` falta y hay que instalarlo** antes del primer build: el
   perfil `development` de `eas.json` ya lo da por sentado.
3. **iOS está bloqueado por costo**, no por técnica. Es una decisión de alcance
   del proyecto.
4. **EAS Build no va en el CI de cada PR.** El límite de 15 builds mensuales y
   la cola de 90+ minutos lo hacen inviable. Manual o por release.
5. **ENG-99 (Sentry en mobile) queda destrabada** en cuanto exista un build de
   desarrollo funcionando, que es lo que necesita para capturar crashes nativos:
   Expo Go no alcanza.

---

## Fuentes

- [EAS Build — Setup](https://docs.expo.dev/build/setup/)
- [EAS Build — Configuración con eas.json](https://docs.expo.dev/build/eas-json/)
- [EAS Build — Distribución interna](https://docs.expo.dev/build/internal-distribution/)
- [EAS Build — Building on CI](https://docs.expo.dev/build/building-on-ci/)
- [Expo — Pricing](https://expo.dev/pricing)
