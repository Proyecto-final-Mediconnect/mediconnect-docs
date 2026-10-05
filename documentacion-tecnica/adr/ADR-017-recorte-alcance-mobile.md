# ADR-017 — Distribución mobile sin publicación en App Store ni Google Play

- **Estado:** Propuesto
- **Fecha:** 2026-08-27
- **Issue:** [ENG-111](https://linear.app/summercamp-pasantes/issue/ENG-111) · Épica EP-10 (Plataforma e Infraestructura)
- **Autor:** juan cruz garcía amadey
- **Aceptado por:** _pendiente — requiere un segundo desarrollador (Sprint 0 §1.7.4)_
- **Reemplaza / es reemplazado por:** reemplaza **parcialmente al ADR-003**, solo en lo referido a distribución en stores. La decisión de stack (React Native + Expo) se mantiene y sigue vigente.
- **Relacionado:** ADR-016 (navegación mobile), ENG-112 (primer build de EAS), [addendum de alcance mobile](../../02-sprint-0/addendum-alcance-mobile.md)

> **Nota sobre el índice.** La fila de este ADR en [`README.md`](README.md) se agrega
> cuando ENG-110 mergee, que es el PR que crea ese archivo. Si este PR entra segundo,
> la fila va acá; si entra primero, va en el de ENG-110.

## Contexto y planteo del problema

ADR-003 (Sprint 0 §3.3.3, Aceptado el 17/05/2026) eligió React Native + Expo, y
justificó la decisión con este contexto textual:

> MediConnect requiere una app mobile descargable desde App Store y Google Play

y listó como primera consecuencia positiva:

> Apps descargables reales en stores oficiales, **requisito explícito del cliente**

La Planning del 15/08/2026 acordó recortar el alcance mobile: **la app cubre
únicamente el rol paciente —turnos, historia clínica, MediPass y push— y no se
publica en App Store ni en Google Play.** El 01/10/2026 se propuso sumar, dentro del
mismo rol, la reserva y la cancelación de turnos y el ingreso a la videoconsulta (ver
el [addendum](../../02-sprint-0/addendum-alcance-mobile.md)); no cambia nada de esta
decisión, que es sobre distribución.

Eso deja a ADR-003 con la premisa caída. La decisión de stack puede seguir siendo la
correcta, pero eso hay que argumentarlo y no darlo por hecho: un ADR cuyo contexto ya
no aplica no sostiene nada por sí solo, y en la defensa la pregunta va a ser
exactamente esa.

Las razones del recorte son de capacidad y presupuesto, no técnicas:

- Quedan 11 sprints y el core web todavía tiene historias abiertas en EP-06 y EP-07.
- Publicar en stores no es trabajo de desarrollo: son cuentas de developer, fichas de
  tienda, capturas, política de privacidad y ciclos de revisión que se miden en días
  y que no dependen del equipo.
- Apple Developer cuesta **USD 99/año** y exige renovación; Google Play, **USD 25**
  únicos. Están en el presupuesto del Plan de Proyecto §6 y el proyecto no tiene
  fondos asignados.

## Decisión

**Se mantiene React Native + Expo.** **No se publica en stores durante el proyecto.**
La distribución es interna:

| Canal | Para qué | Cómo |
| --- | --- | --- |
| **Expo Go** | Desarrollo día a día | `npx expo start`, sin build nativo |
| **EAS Build, perfil `development`** | Lo que Expo Go no cubre: módulos nativos, push real | APK instalable (ENG-112) |
| **EAS Build, perfil `preview`** | Demo y defensa | APK por link interno de EAS |

**Solo Android.** Un build de iOS instalable exige cuenta de Apple Developer paga
incluso para distribución interna —ad-hoc o TestFlight—, así que sin ese gasto no hay
build propio que se instale en un iPhone. Queda Expo Go (está en la App Store y no
pide cuenta paga), que corre la app en modo desarrollo mientras su versión del SDK
coincida con la del proyecto: alcanza para mostrarla en un iPhone, no para
distribuirla. Los tres perfiles ya existen en `eas.json`; esto
no agrega configuración, define cuáles se usan.

## Por qué el stack sigue siendo la decisión correcta

Sin la publicación en stores, el argumento de ADR-003 cambia de forma pero no de
conclusión:

1. **EAS Build era el motivo principal y ahora pesa más.** Genera builds nativos en la
   nube sin Xcode ni Android Studio configurados en la máquina de nadie. Es lo que
   hace posible tener un APK para la defensa con el equipo trabajando en Linux y
   Windows.
2. **Expo Go es lo que hace viable el desarrollo mobile con este calendario.** Probar
   en un teléfono real sin compilar nada es la diferencia entre que el bloque mobile
   entre en los sprints que quedan y que no entre.
3. **El SDK cubre las cuatro cosas que piden las historias mobile**: cámara y lectura
   de QR (MediPass), secure storage (sesión), notificaciones push y file system. Con
   React Native puro cada una es una librería de terceros con su propia configuración
   nativa.
4. **Ninguna alternativa mejora al quitar las stores.** Flutter tendría el mismo límite
   de distribución y costaría un lenguaje más. Una PWA evitaría el problema de
   distribución por completo, pero el MediPass necesita cámara con lectura de QR
   fluida y push confiable, que es donde una PWA se cae en iOS — y entonces el recorte
   sería de producto, no de distribución.

Dicho de otra forma: **las stores nunca fueron la razón por la que se eligió Expo.**
Eran una consecuencia que el ADR listaba, y es esa la que se cae.

## Consecuencias

### Positivas

- El costo monetario del proyecto baja de USD 124 a **USD 0–20**.
- Se elimina del camino crítico la dependencia de los ciclos de revisión de Apple y
  Google, que estaban fuera del control del equipo.
- El bloque mobile arranca en el Sprint 5 sin esperar ninguna cuenta paga.
- La decisión es reversible sin deuda técnica: el perfil `production` ya existe y
  `eas submit` es el único paso que falta.

### Negativas, y hay que decirlas

- **No hay build instalable en iOS.** No es "no está en la store": no hay APK
  equivalente para iPhone. Se puede mostrar con Expo Go, pero eso depende de que
  Expo Go soporte el SDK del proyecto el día de la defensa —solo soporta el último—,
  así que no es un plan B confiable.
- **La demo depende de un APK y de un Android.** Si la defensa se hace sin
  dispositivo ni emulador Android a mano, no hay app que mostrar. Conviene tener el
  APK descargado de antemano y no depender del link de EAS en el momento.
- **El paper y el póster ya entregados dicen otra cosa**, y no se pueden cambiar. La
  diferencia queda registrada en el
  [addendum de alcance mobile](../../02-sprint-0/addendum-alcance-mobile.md).
- **Queda un ADR-003 vigente con una premisa que ya no aplica.** Su estado pasa a
  `Reemplazado parcialmente por ADR-017` cuando se lo toque en el documento de
  Sprint 0; hasta entonces hay que leerlo junto con este.

### Neutras

- `app.json` mantiene los identificadores `ar.mediconnect.app` en iOS y Android
  aunque no se publiquen. Es deliberado: si algún día se publica, el identificador ya
  es el correcto.
- Detox (E2E mobile) sigue fuera del alcance por la misma razón de capacidad. Mientras
  no exista, el testing mobile es manual en emulador con el checklist de ENG-121.

## Qué haría falta para revertirla

Una cuenta de Apple Developer (USD 99/año) y una de Google Play (USD 25). Del lado
técnico no hay nada que rehacer. Es una decisión de presupuesto, no de código.
