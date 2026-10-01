# Checklist de testing manual en emulador Android

**Ticket:** [ENG-121](https://linear.app/summercamp-pasantes/issue/ENG-121) · Épica EP-10 (Plataforma e Infraestructura)
**Exigido por:** Sprint 0 §4.2.3
**Aplica a:** toda historia de `mediconnect-mobile`

---

## Por qué existe

El Sprint 0 §4.2.3 dice, hasta que Detox esté configurado:

> Durante los primeros cinco sprints el testing de la app mobile se realiza de forma
> manual en el emulador de Android con Android Studio, **documentando los resultados
> en el checklist de la Definition of Done de cada historia**.

Ese checklist nunca se escribió, porque hasta el Sprint 5 no había ninguna historia
mobile que cerrar. Ahora que arranca el bloque mobile, es lo que hace verificables los
criterios de aceptación de ENG-113 a ENG-119: sin él, "funciona en el emulador" es
una afirmación sin evidencia.

Detox (ENG-120) queda en el backlog, así que esto no es un puente de dos semanas: es
el mecanismo de verificación mobile del proyecto. Ver el
[addendum de alcance mobile](../../02-sprint-0/addendum-alcance-mobile.md), que llega
con ENG-111 — si ese PR todavía no mergeó, el enlace no resuelve.

## Entorno de referencia

**Todo se verifica sobre el mismo AVD**, y eso es la mitad del valor del checklist: si
cada uno prueba en un emulador distinto, "a mí me funciona" no significa nada.

| | |
| --- | --- |
| **Dispositivo** | **Pixel 6** (1080 × 2400, 411 dpi, con notch) |
| **Versión de Android** | **Android 14 — API 34** |
| **Imagen** | Google APIs (x86_64). No "Google Play": no hace falta y arranca más lento |
| **RAM del AVD** | 2048 MB o más |
| **Cómo se corre** | `npx expo start` + `a`, o el APK del perfil `development` (ENG-112) |

Por qué ese par:

- **Pixel 6** es el AVD que viene por defecto en Android Studio, así que nadie tiene
  que configurar nada raro, y tiene notch — que es donde aparecen los problemas de
  safe area que un emulador sin notch esconde.
- **API 34 es el piso**, no lo más nuevo: es una versión que la mayoría de los
  teléfonos en uso ya alcanzó o superó, así que lo que anda ahí anda en casi todos.
  Trae el modelo de permisos moderno (incluido el permiso de notificaciones, que desde API 33 se pide en
  runtime y antes no).

> **Pendiente de confirmar:** el API mínimo que soporta Expo SDK 56. Cuando ENG-112
> produzca el primer build, conviene agregar un segundo AVD en ese mínimo y correr al
> menos los puntos 1, 2 y 5 sobre él — es donde aparecen las diferencias de permisos.
> Hasta entonces, la referencia es una sola y está bien que sea así: un checklist con
> dos entornos que nadie corre es peor que uno con uno que sí se corre.

## Los seis puntos

Se corren **todos** en cada historia mobile, no solo los que parecen relacionados. Son
seis y llevan pocos minutos; el que se saltea es siempre el que falla.

### 1. Arranque en frío

Cerrar la app desde la bandeja de recientes (no solo mandarla al fondo) y abrirla de
nuevo.

- [ ] La app abre sin pantalla en blanco ni flash de contenido sin estilo.
- [ ] Si había sesión, sigue habiendo sesión (no vuelve al login).
- [ ] La pantalla que abre es la que corresponde al estado: login si no hay sesión, la
      pantalla inicial del paciente si la hay.

### 2. Permisos denegados

Denegar el permiso que la pantalla necesita —cámara para el MediPass, notificaciones
para los recordatorios— y usarla igual. Si hace falta reiniciar el estado del permiso:
Ajustes → Apps → MediConnect → Permisos.

- [ ] La app **no se cierra** ni queda en una pantalla vacía.
- [ ] Explica qué no puede hacer y cómo habilitarlo.
- [ ] Denegar con "No volver a preguntar" tampoco la deja en un callejón sin salida
      (el segundo pedido ya no muestra el diálogo del sistema: la app tiene que
      mandar a Ajustes).

### 3. Sin conexión

Modo avión, o Extended controls → Cellular → Data status: `Denied`.

- [ ] La pantalla dice que no hay conexión, y lo dice **en la pantalla** — no en un
      toast que desaparece.
- [ ] Hay forma de reintentar sin cerrar la app.
- [ ] Al volver la conexión, el reintento funciona y no quedan datos a medias.
- [ ] **Nada que el usuario escribió se perdió** mientras no había red.

### 4. Sesión vencida

Con la app abierta, invalidar la sesión del lado del servidor (cerrar sesión desde la
web con el mismo usuario, o borrar el token del secure storage) y después tocar algo
que pegue al backend.

- [ ] Manda al login, no a una pantalla de error genérica.
- [ ] Dice que la sesión venció, así el usuario entiende por qué volvió al login.
- [ ] No quedan datos del usuario anterior en pantalla al volver a entrar.

### 5. Rotación de pantalla

`app.json` fija `orientation: "portrait"`, así que la app **no debería** rotar. Igual
hay que verificarlo: la rotación forzada del sistema y las pantallas partidas la
producen de todos modos.

- [ ] Rotar el emulador (Ctrl+F11 / Ctrl+F12) no rota la app ni la rompe.
- [ ] Si algo se redibuja, no se pierde lo escrito en un formulario a medio llenar.

### 6. Volver desde segundo plano

Mandar la app al fondo, abrir otra, esperar **un minuto largo** y volver.

- [ ] Vuelve a la misma pantalla, con el mismo estado.
- [ ] No se perdió lo escrito en un formulario a medio llenar.
- [ ] Si el sistema mató el proceso, al volver se comporta como el punto 1 (arranque
      en frío) y no como una pantalla a medias.

## Qué evidencia se adjunta al PR

**Capturas, y grabación de pantalla cuando el punto es una secuencia.** Una captura
del estado final no prueba nada sobre los puntos 3, 4 y 6, que son transiciones.

| Punto | Evidencia mínima |
| --- | --- |
| 1. Arranque en frío | 1 captura de la pantalla con la que abre |
| 2. Permisos denegados | 1 captura del mensaje que muestra la app |
| 3. Sin conexión | **Grabación**: sin red → mensaje → vuelve la red → reintento OK |
| 4. Sesión vencida | **Grabación**: acción → login con el aviso de sesión vencida |
| 5. Rotación | 1 captura después de rotar |
| 6. Segundo plano | **Grabación**: fondo → vuelta, con el estado intacto |

Cómo se sacan:

```bash
# captura (queda en el directorio actual)
adb exec-out screencap -p > punto-1-arranque.png

# grabación (máx. 3 min; Ctrl+C para cortar)
adb shell screenrecord /sdcard/punto-3.mp4
adb pull /sdcard/punto-3.mp4
```

Reglas:

- Se pega en el PR, en la sección de pasos para reproducirlo. Un link a un archivo
  fuera de GitHub no sirve: el PR tiene que poder leerse solo en seis meses.
- **Datos sintéticos siempre.** Nada de historias clínicas, nombres o matrículas
  reales en una captura de un PR público.
- Un punto que **no aplica** se marca igual, con una línea de por qué. "No aplica"
  escrito es información; el casillero vacío no se distingue de olvidarse.
- Si un punto **falla** y se decide mergear igual, va con su ticket de seguimiento
  enlazado. Sin ticket, no se mergea.

## Bloque para pegar en el PR

```markdown
### Checklist de emulador Android (ENG-121)

Entorno: Pixel 6 · Android 14 (API 34) · perfil `development`

- [ ] 1. Arranque en frío
- [ ] 2. Permisos denegados
- [ ] 3. Sin conexión
- [ ] 4. Sesión vencida
- [ ] 5. Rotación de pantalla
- [ ] 6. Volver desde segundo plano

Evidencia: <capturas y grabaciones>
No aplica: <punto y por qué>
```

---

## Anexo — Fila para la Definition of Done del Working Agreement

> El Working Agreement está en el Drive. Esta fila queda versionada acá para que el
> texto que se pegó allá sea revisable, mismo criterio que el
> [addendum de alcance mobile](../../02-sprint-0/addendum-alcance-mobile.md).

```
| Verificación manual en emulador (solo historias de mediconnect-mobile)
|
| La historia se verificó en el emulador Android de referencia
| (Pixel 6, Android 14 / API 34) corriendo los seis puntos del
| checklist de testing manual, y el PR incluye la evidencia:
| capturas para los puntos estáticos y grabación de pantalla para
| los que son una secuencia.
|
| Los puntos que no aplican se marcan con el motivo. Un punto que
| falla y se mergea igual requiere ticket de seguimiento enlazado
| en el PR.
|
| Referencia: documentacion-tecnica/testing/checklist-emulador-android.md
| Aplica desde: Sprint 5. Reemplazable por Detox cuando ENG-120 se
| implemente.
```
