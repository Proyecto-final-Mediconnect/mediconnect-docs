# Addendum — Alcance de la aplicación mobile

**Fecha del acuerdo:** 15/08/2026 (Planning del Sprint 5)
**Redactado:** 27/08/2026
**Ticket:** [ENG-111](https://linear.app/summercamp-pasantes/issue/ENG-111) · Épica EP-10 (Plataforma e Infraestructura)
**Enmienda a:** documento de **Sprint 0** y **Plan de Proyecto** (los dos en el Drive)
**Decisión técnica asociada:** [ADR-017](../documentacion-tecnica/adr/ADR-017-recorte-alcance-mobile.md)

---

## Por qué existe este documento

Los documentos entregados y el backlog dicen cosas distintas sobre la app mobile.
Este addendum los pone de acuerdo y deja por escrito la diferencia con lo que ya se
entregó y no se puede cambiar.

No es un cambio de rumbo: es registrar uno que ya se tomó. El riesgo de no hacerlo es
concreto — en la defensa, la pregunta "¿por qué la app no está en las stores si el
paper dice que es una plataforma web y mobile?" llega igual, y conviene que no sea una
sorpresa.

## 1. El alcance mobile acordado

**La app mobile cubre únicamente el rol paciente.**

### Pantallas comprometidas

| Bloque | Qué incluye | Historias |
| --- | --- | --- |
| Shell y navegación | Navegación raíz, tema, layout base | ENG-113 |
| Autenticación | Login con sesión persistida | ENG-114 |
| Turnos | Ver los turnos propios y cancelar uno futuro | ENG-115 |
| Reserva | Buscar profesionales, ver su disponibilidad y reservar un turno (sin pago) | ENG-132, ENG-133 |
| Videoconsulta | Entrar a la consulta propia desde el celular | ENG-131 |
| Historia clínica | Lectura de la HC propia | ENG-116 |
| MediPass | Ver el propio y generar el QR | ENG-117 |
| Notificaciones push | EP-09 · en mobile hoy está ticketeado el push por mensajes nuevos | ENG-71 |
| Build distribuible | El APK con el que se hace la demo | ENG-119 |

> **Ampliación propuesta el 01/10/2026, a confirmar por el equipo.** El acuerdo del
> 15/08 dejaba la reserva y la cancelación de turnos en la web. Se suman a la app,
> junto con entrar a la videoconsulta, porque son lo que el paciente hace con el
> celular en la mano: sacar un turno, cancelarlo si no puede ir y atenderse donde
> esté. Siguen siendo **solo del rol paciente** y no agregan trabajo de backend: los
> endpoints son los mismos que usa la web (catálogo, disponibilidad, reserva,
> cancelación y videoconsulta).
>
> - La **cancelación** ya está hecha dentro de ENG-115.
> - **Buscar y reservar** son ENG-132 y ENG-133. La reserva deja el turno sin pagar:
>   el pago con MercadoPago (ENG-63) sigue en la web hasta que haya una historia
>   mobile para eso, y la app avisa que hay que pagar antes de que ENG-101 libere el
>   turno.
> - **Entrar a la videoconsulta** es ENG-131.

> **Punto abierto: ENG-118.** "Escanear un MediPass como consultante externo desde la
> app mobile" es la única historia mobile del backlog que **no es del rol paciente**:
> el que escanea es un profesional externo. O queda fuera de este alcance, o el
> acuerdo se enuncia como "rol paciente **más** el escaneo de MediPass", que es la
> otra mitad de la razón de ser del MediPass. Hay que resolverlo en una Planning; está
> en `Backlog`, así que no bloquea nada todavía.

### Lo que queda explícitamente afuera

- **El rol profesional entero.** Agenda, la videoconsulta del lado del profesional,
  carga de historia clínica y cobros son web. No hay pantalla mobile para
  profesionales, y no la va a haber en este proyecto.
- **El rol moderador**, que tampoco tiene pantalla en web (ver el procedimiento manual
  de validación de matrículas, ENG-109).
- **El rol profesional entero.** Agenda, videoconsulta, carga de historia clínica y
  cobros son web. No hay pantalla mobile para profesionales, y no la va a haber en
  este proyecto.
- **El rol moderador.** La validación de matrículas no tiene pantalla en web: es un
  procedimiento manual (ENG-109). La única pantalla de moderador en web es la de
  reseñas (ENG-81), y tampoco va a mobile.
- **La publicación en App Store y Google Play.** Ver ADR-017.
- **Build instalable de iOS.** No es solo la store: sin cuenta de Apple Developer paga
  no hay build propio que se instale en un iPhone, ni siquiera para distribución
  interna. Lo que sí funciona es **Expo Go** desde la App Store, que corre la app en
  modo desarrollo mientras su versión del SDK coincida con la del proyecto — sirve
  para mostrarla, no para entregarla.
- **Detox (E2E mobile) no se implementa en este proyecto.** La historia existe
  (ENG-120) y **queda en el backlog**, sin sprint asignado: el Sprint 0 §4.2.3 ya
  preveía que durante los primeros cinco sprints el testing mobile fuera manual en
  emulador Android, y el checklist que lo hace verificable es ENG-121. Si alguien
  pregunta por qué la planilla de catalogación lista Detox, la respuesta es que la
  herramienta está elegida y la tarea escrita; lo que no hay es capacidad para
  ejecutarla.

### Cómo se distribuye

Internamente, con EAS Build: **Expo Go** para desarrollo, perfil `development` para
probar lo que Expo Go no cubre y perfil `preview` para la demo y la defensa. Solo
Android. El detalle está en ADR-017.

## 2. Los tres conflictos con lo ya entregado, y cómo se resuelve cada uno

### 2.1 ADR-003 justifica el stack con una premisa que ya no aplica

ADR-003 (Aceptado, 17/05/2026) dice textualmente que *"MediConnect requiere una app
mobile descargable desde App Store y Google Play"* y lista como primera consecuencia
positiva *"Apps descargables reales en stores oficiales, requisito explícito del
cliente"*.

**Resolución:** ADR-017 lo reemplaza **parcialmente**, solo en lo referido a
distribución, y argumenta por qué React Native + Expo sigue siendo la decisión
correcta sin publicación — el motivo real siempre fue EAS Build y el SDK, no las
stores. El estado de ADR-003 pasa a `Reemplazado parcialmente por ADR-017` la próxima
vez que se toque el documento de Sprint 0.

### 2.2 La WBS del Plan de Proyecto no tiene ningún módulo mobile

La WBS §3.1.1 descompone Desarrollo en 12 módulos y ninguno es mobile. El mismo
documento dice: *"Todo trabajo que no esté en la WBS se considera fuera del alcance."*
O sea que, formalmente, **todo el trabajo mobile del proyecto está hoy fuera del
alcance**, incluido el que ya se hizo.

**Resolución:** se agrega el paquete de trabajo **1.3.13 Aplicación Mobile** a la WBS.
El texto exacto para pegar en el Plan de Proyecto está en el [Anexo A](#anexo-a--texto-para-el-plan-de-proyecto).

### 2.3 El presupuesto incluye las cuentas de developer

El presupuesto §6 tiene Apple Developer (USD 99/año) y Google Play (USD 25). Con este
recorte no se compra ninguna de las dos.

**Resolución:** se quitan las dos líneas. El costo monetario del proyecto pasa de
**USD 124** a **USD 0–20**. El texto exacto está en el [Anexo A](#anexo-a--texto-para-el-plan-de-proyecto).

## 3. La diferencia con el paper y el póster

**El paper y el póster ya están entregados y no se pueden modificar.** Dicen:

| Documento | Qué dice | Qué es en realidad |
| --- | --- | --- |
| Paper y póster | "plataforma web y mobile" | Correcto, pero la app mobile es solo del rol paciente y no se publica |
| Planilla de catalogación | "Expo Go y EAS Build" | Correcto y sin cambios |
| Planilla de catalogación | "Detox (E2E mobile)" | **No se ejecuta en este proyecto.** La tarea existe (ENG-120) y queda en el backlog; el testing mobile es manual en emulador con el checklist de ENG-121 |

### La justificación, para decirla igual en todas partes

El recorte es de **capacidad**, no de diseño ni de viabilidad técnica:

1. **Quedan 11 sprints** y el core web todavía tiene historias abiertas en EP-06
   (Historia Clínica) y EP-07 (IA Clínica), que son los dos diferenciales del
   proyecto.
2. **El equipo es de cinco personas** y ninguna tenía experiencia previa en React
   Native. El bloque mobile arrancó en el Sprint 5.
3. **Publicar en stores no es trabajo de desarrollo**: son cuentas pagas, fichas de
   tienda, capturas, política de privacidad y ciclos de revisión que se miden en días
   y que no dependen del equipo. Poner eso en el camino crítico de la entrega era
   aceptar un riesgo que no controlamos.
4. **La prioridad es el core web**, que es donde están las 48 historias del backlog y
   donde se demuestra lo que el proyecto propone: la historia clínica inalterable y el
   MediPass.

Lo que **no** cambia: la app mobile existe, funciona, se instala y se puede mostrar
funcionando. Lo que no hay es una app publicada en una tienda.

---

## Anexo A — Texto para el Plan de Proyecto

> Estas dos secciones hay que **pegarlas en el Plan de Proyecto del Drive**: son
> documentos formales que no viven en el repositorio. Quedan acá versionadas para que
> el texto que se pegó sea revisable y para que el repositorio y el Drive no digan
> cosas distintas.

### A.1 — WBS §3.1.1: paquete de trabajo nuevo

```
1.3.13  Aplicación Mobile (rol paciente)

  1.3.13.1  Configuración del proyecto y toolchain
            Bootstrap de Expo + TypeScript, ESLint/Prettier, Vitest,
            CI en GitHub Actions.

  1.3.13.2  Builds y distribución interna
            Inicialización de EAS, perfiles development/preview/production,
            generación del primer build de desarrollo Android.

  1.3.13.3  Shell de la aplicación
            Navegación raíz (ADR-016), tema y layout base.

  1.3.13.4  Autenticación del paciente
            Login, sesión persistente en secure storage, logout.

  1.3.13.5  Turnos del paciente
            Listado de los turnos propios y cancelación de un turno futuro.
            Búsqueda de profesionales, disponibilidad y reserva. El pago
            se hace por web.

  1.3.13.6  Videoconsulta del paciente
            Ingreso a la sala de la consulta propia.

  1.3.13.7  Historia clínica del paciente
            Lectura de la HC propia.

  1.3.13.8  MediPass
            Visualización del MediPass propio y generación del código QR.

  1.3.13.9  Notificaciones push
            Registro del dispositivo y recepción de notificaciones (EP-09).

  1.3.13.10 Verificación manual en emulador
            Ejecución del checklist de testing manual en emulador Android
            por cada historia mobile.

Exclusiones explícitas de este paquete:
  - Pantallas del rol profesional y del rol moderador.
  - Pago de turnos (se hace por web).
  - Publicación en App Store y Google Play (ADR-017).
  - Build instalable de iOS.
  - Suite E2E automatizada con Detox: la tarea queda en el backlog.
```

### A.2 — Presupuesto §6: líneas a quitar

```
QUITAR:
  Apple Developer Program ......... USD 99 / año
  Google Play Developer ........... USD 25 (único)

MOTIVO:
  ADR-017 — la app no se publica en App Store ni en Google Play.
  La distribución es interna con EAS Build (Android).

COSTO MONETARIO DEL PROYECTO:
  antes ..... USD 124
  ahora ..... USD 0 a 20
```

El rango **0 a 20** y no cero fijo: el plan gratuito de EAS Build tiene una cuota
mensual de builds, y si en algún sprint hay que pasarla el costo es por build. Hasta
hoy no pasó.
