# ADR-016 — Tecnología de navegación de la app mobile

- **Estado:** Propuesto
- **Fecha:** 2026-08-25
- **Issue:** [ENG-110](https://linear.app/summercamp-pasantes/issue/ENG-110) · Épica EP-10 (Plataforma e Infraestructura)
- **Autor:** Ignacio Patriarca
- **Aceptado por:** _pendiente — requiere un segundo desarrollador (Sprint 0 §1.7.4)_
- **Reemplaza / es reemplazado por:** —
- **Relacionado:** ADR-003 (React Native + Expo), ENG-111 (addendum de alcance mobile), ENG-113 (shell mobile)

## Contexto y planteo del problema

El Sprint 0 §3.4.6 dejó esta decisión explícitamente diferida:

> La carpeta `navigation/` contiene la configuración de routing, cuya tecnología
> específica (Expo Router file-based o React Navigation tradicional) **se define en
> el ADR-016 al inicio del Sprint 1**.

Estamos en el Sprint 5 y el ADR-016 no existía. El repositorio se bloquea a sí
mismo: `src/navigation/README.md` dice *"No elegir la librería de navegación antes
de que el ADR-016 esté aprobado"*, y `src/App.tsx` tiene un `TODO(ADR-016)` que
renderiza `HomeScreen` directo en lugar de un navegador raíz. El último commit de
producto de `mediconnect-mobile` es del 27/06/2026.

Mientras esto no se cierre, **ninguna pantalla mobile se puede construir**: ENG-113
(shell), ENG-114 (login), ENG-115, ENG-116, ENG-117 y ENG-118 dependen todas de
que exista un navegador raíz.

Este es además el **primer ADR versionado del proyecto**: los ADR-001 a ADR-015
viven únicamente dentro del Google Doc del Sprint 0.

### Qué cambió respecto del Sprint 0

ENG-111 recorta el alcance mobile: **la app no se publica en App Store ni en Google
Play**. Se distribuye como build interno (APK vía EAS) para la demo y la defensa.
Eso elimina de la ecuación los universal links / App Links, que son uno de los
argumentos habituales a favor de un router basado en URLs.

## Impulsores de la decisión

Los cuatro primeros son los que fija ENG-110. El quinto y el sexto aparecieron al
verificar la decisión contra el repositorio y son, en la práctica, los que más
pesan.

1. **Deep linking**, por el QR del MediPass.
2. **Compatibilidad con Expo SDK 56** (`expo ~56.0.12`, `react-native 0.85.3`, `react 19.2.3`).
3. **Curva de aprendizaje**: 5 desarrolladores, ninguno con experiencia previa en
   React Native, y 5 sprints hasta la defensa.
4. **Reutilización de patrones con el React Router 7 de la web.**
5. **Compatibilidad con el runner de tests que ya tiene el repo** (Sprint 0 §3.4.10:
   Vitest + React Testing Library, *no* Jest), y con el mínimo de 50 % de cobertura
   en features mobile (§4.9).
6. **Cantidad de módulos nativos que arrastra**, con EAS todavía sin inicializar
   (`app.json` → `extra.eas.projectId: "TODO-set-on-eas-init"`, ENG-112 pendiente).

## Opciones consideradas

- **A. Expo Router** (file-based routing)
- **B. React Navigation** (configuración declarativa por componentes)

Conviene aclarar algo que no siempre es obvio: **no son dos motores distintos**.
Expo Router está construido *sobre* React Navigation; es una capa de convención
file-based encima del mismo runtime. La decisión real no es "qué librería de
navegación", sino **"¿agregamos la capa file-based por encima?"**.

## Resultado de la decisión

**Se elige la opción B: React Navigation 7**, con `@react-navigation/native` +
`@react-navigation/native-stack`, y el navegador raíz expuesto desde
`src/navigation/`.

### Por qué

**1. El argumento principal a favor de Expo Router no aplica a este proyecto.**

ENG-110 asume que el deep linking es *"necesario para el QR del MediPass"*. Los
criterios de aceptación de las historias dicen otra cosa:

- **ENG-118** (escanear MediPass): el QR se lee **dentro de la app con `expo-camera`**,
  y *"el consultante externo no tiene cuenta"*. El QR transporta un token que la app
  lee y valida contra el backend; no es una URL que el sistema operativo abra.
- **ENG-117** (mostrar MediPass): genera el QR, no lo consume.

O sea: el flujo del MediPass es *cámara → token → navegación interna*, y eso no
necesita deep linking en absoluto. Donde sí hace falta es al **tocar una notificación
push** (ENG-71) para abrir una pantalla concreta — un caso que con React Navigation
se resuelve con el objeto `linking` y una llamada a `navigate`, del orden de 20
líneas, no con un cambio de arquitectura de routing.

Sumado al recorte de ENG-111 (sin publicación en tiendas ⇒ sin universal links),
el impulsor n.º 1 queda prácticamente neutralizado.

**2. Expo Router pelea con el runner de tests que el proyecto ya eligió.**

`vitest.config.ts` corre los componentes en jsdom mapeando `react-native` →
`react-native-web`. Expo Router construye su árbol de rutas con **Metro** (un
`require.context` sobre el directorio `app/`) y declara entre sus peers
`@expo/metro-runtime`, `react-server-dom-webpack` y **`@testing-library/react-native >= 13.2`**
— es decir, el runner del ecosistema RN, que no es el que el equipo eligió en el
Sprint 0 §3.4.10. Bajo Vite no hay Metro, así que el árbol de rutas no existe y
habría que o mockear el router en cada test o rehacer el stack de testing, lo que
además arrastraría a ENG-120 (Detox) y ENG-121 (checklist manual).

React Navigation, en cambio, es un árbol de componentes React común. **Verificado
empíricamente** — ver §Verificación.

**3. En el impulsor de "reutilización de patrones" gana B, no A.**

Es contraintuitivo, así que conviene ser explícito. La web usa
`react-router-dom@7.18.0` en **modo declarativo**, no file-based:

```tsx
// mediconnect-web/src/App.tsx
<Routes>
  <Route path="/mis-turnos" element={
    <RequireAuth allow={['PACIENTE', 'PROFESIONAL']}>
      <MyAppointmentsPage />
    </RequireAuth>
  } />
</Routes>
```

`<Stack.Navigator>` / `<Stack.Screen>` es exactamente el mismo modelo mental, y el
patrón de guarda por rol (`RequireAuth`) se traslada como navegadores condicionales.
La convención file-based de Expo Router es un modelo **distinto** del que el equipo
ya escribió y mantiene.

**4. Menos superficie nativa, con EAS todavía sin inicializar.**

Peer dependencies reales, consultadas en npm el 25/08/2026:

| | Expo Router `56.2.19` (tag `sdk-56`) | React Navigation `7.3.17` |
| --- | --- | --- |
| peerDependencies | **15** | **2** (+2 en `native-stack`) |
| Módulos nativos que exige | `react-native-screens`, `react-native-reanimated`, `react-native-gesture-handler` | `react-native-screens`, `react-native-safe-area-context` |
| Runner de tests que declara | `@testing-library/react-native >= 13.2` | ninguno |
| Soporte SDK 56 | ✅ tag `sdk-56` | ✅ sin acoplamiento al SDK |

Los dos exigen un rebuild nativo, así que la diferencia es de **magnitud, no de
naturaleza**: `reanimated` y `gesture-handler` son dos dependencias nativas más que
mantener y actualizar, en un proyecto donde el primer build de EAS todavía no se
generó nunca.

**5. Curva de aprendizaje.** Con nadie del equipo con experiencia previa en RN,
pesa más el modelo que ya conocen de la web (impulsor 3) que la comodidad de la
convención file-based, que rinde sobre todo en apps con muchas rutas. La app son
~8 pantallas.

## Consecuencias

### Positivas

- Desbloquea ENG-113 y toda la cadena de historias mobile.
- El modelo de routing es el mismo que el de la web: un desarrollador que tocó
  `mediconnect-web` puede leer `src/navigation/` sin aprender una convención nueva.
- El stack de testing del Sprint 0 se conserva sin cambios.
- Dos dependencias nativas en lugar de cuatro.

### Negativas, aceptadas

- **Registro manual de rutas.** Agregar una pantalla implica tocar el archivo del
  navegador. Con ~8 pantallas es irrelevante; con más de ~25 la convención
  file-based empieza a rendir.
- **Deep linking manual.** El objeto `linking` se escribe y se mantiene a mano.
  Necesario para ENG-71.
- **Tipado manual.** Expo Router genera los tipos de rutas automáticamente; acá hay
  que mantener `RootStackParamList` a mano. Se mitiga con `native-stack` tipado
  genéricamente, como en la sonda de §Verificación.
- **Si el proyecto quisiera una build web de la app mobile**, Expo Router habría
  sido la mejor opción. Está fuera de alcance (ENG-111).

### Cuándo reconsiderar esta decisión

- Si las rutas superan las ~25.
- Si se decide publicar en tiendas y hacen falta universal links / App Links.
- Si el stack de testing mobile migra a Jest + `@testing-library/react-native`, que
  es lo que el ecosistema RN asume por defecto.

## Verificación

La decisión **no se tomó sobre el papel**. Se levantaron las dependencias en
`mediconnect-mobile` (`b9772c8`) y se montó un navegador real bajo el runner
existente: `NavigationContainer` + `createNativeStackNavigator`, navegando de una
pantalla a otra con parámetros tipados y afirmando sobre la pantalla destino.

```
✓ src/navigation/__probe.spec.tsx (1 test) 158ms
  Test Files  1 passed (1)
       Tests  1 passed (1)
```

### Hallazgo: el setup de Vitest necesita tres ajustes

La sonda **no pasa** con el `vitest.config.ts` actual. Los tres problemas son del
stack de testing, no del router, y **ENG-113 tiene que resolverlos**:

1. **`@react-navigation/*` importa sin extensión** en su build ESM. Node no lo
   resuelve; hay que dejar que Vite los transforme:

   ```ts
   test: { server: { deps: { inline: [/@react-navigation/] } } }
   ```

2. **`react-native-screens` y `react-native-safe-area-context` publican fuente sin
   transpilar** (sintaxis Flow: `SyntaxError: Unexpected token 'typeof'`). Hay que
   aliasearlos a stubs **a nivel de config** — `vi.mock` corre demasiado tarde:

   ```ts
   resolve: { alias: [
     { find: /^react-native-screens$/, replacement: '/test-stubs/react-native-screens.tsx' },
     { find: /^react-native-safe-area-context$/, replacement: '/test-stubs/react-native-safe-area-context.tsx' },
     { find: /^react-native$/, replacement: 'react-native-web' },
   ] }
   ```

   Se bisectó paquete por paquete: `@react-navigation/native` importa limpio; los
   tres que fallan son exactamente los que traen código nativo.

3. **jsdom no implementa `ResizeObserver`**, que `@react-navigation/elements` usa en
   su camino web. Alcanza con un polyfill de tres métodos vacíos en `vitest.setup.ts`.

Esto vale la pena decirlo con todas las letras: **el costo no es del router elegido,
es del stack de testing mobile del Sprint 0.** Vitest + `react-native-web` es una
elección poco habitual en React Native, y cualquier librería con código nativo va a
chocar con ella. Con Expo Router el choque habría sido mayor, no menor, porque
además depende de Metro para construir el árbol de rutas.

## Pros y contras de las opciones

### A. Expo Router

- ➕ Deep linking automático: cada archivo es una URL.
- ➕ Tipado de rutas generado.
- ➕ Mismo código de routing si algún día se quiere una build web.
- ➕ Es la recomendación por defecto de Expo para proyectos nuevos.
- ➖ Depende de Metro para construir el árbol de rutas; incompatible con el runner
  Vitest del proyecto sin rehacerlo.
- ➖ 15 peer dependencies, incluidas `reanimated` y `gesture-handler`.
- ➖ Declara `@testing-library/react-native` como peer, que el proyecto no usa.
- ➖ Modelo distinto del de la web, que es declarativo.
- ➖ Sus mayores ventajas (deep linking automático, universal links, web) son
  justamente las que este proyecto no va a usar.

### B. React Navigation

- ➕ Es el runtime que Expo Router usa por debajo: no se pierde nada del motor.
- ➕ 2 peer dependencies; ninguna sorpresa.
- ➕ Mismo modelo declarativo que el React Router 7 de la web.
- ➕ Funciona con el runner de tests existente (verificado).
- ➖ Rutas y tipos se registran a mano.
- ➖ Deep linking se configura a mano (necesario para ENG-71).

## Enlaces

- Sprint 0 §3.4.6 (estructura de `mediconnect-mobile`), §3.4.10 (runner de tests), §1.7.4 (decisiones de arquitectura), §4.9 (cobertura mobile)
- ADR-003 — React Native + Expo como stack mobile
- [ENG-110](https://linear.app/summercamp-pasantes/issue/ENG-110) · [ENG-111](https://linear.app/summercamp-pasantes/issue/ENG-111) · [ENG-113](https://linear.app/summercamp-pasantes/issue/ENG-113) · [ENG-117](https://linear.app/summercamp-pasantes/issue/ENG-117) · [ENG-118](https://linear.app/summercamp-pasantes/issue/ENG-118)
