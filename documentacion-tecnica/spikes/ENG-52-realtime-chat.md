# ENG-52 — Spike: Exploración de Supabase Realtime para chat

**Épica:** EP-08 (Comunicación) · **Sprint 4** (planificado en el Sprint 3) · **2 SP** · **Tipo:** Spike
**Autor:** Becerra

## Objetivo

Validar —antes de implementar el chat— que Supabase Realtime con RLS activo
entrega los mensajes **solo a los participantes de cada conversación**, y dejar
decidido qué mecanismo usa ENG-70.

La pregunta de fondo es si el chat puede apoyarse en Realtime hablando directo
con el cliente, o si hace falta que el backend intermedie cada mensaje. Si RLS
sostiene el aislamiento, el backend se saca de encima el camino caliente del
chat; si no lo sostiene, no hay chat directo posible con datos de salud.

La validación es **empírica**: proyecto real de Supabase, tres usuarios
autenticados, cinco suscripciones simultáneas y seis corridas.

## Qué se construyó

| Artefacto | Dónde |
|---|---|
| Tablas de prueba, GRANTs, políticas RLS y publicación | `mediconnect-backend/prisma/spikes/eng52_realtime_chat.sql` |
| Script de validación (5 escenarios) | `mediconnect-backend/scripts/spike-eng52-realtime.ts` |

El SQL vive **fuera de `prisma/migrations`** a propósito: crea
`spike_realtime_conversations` y `spike_realtime_messages`, y no toca
`conversations` ni `messages` reales. El script no importa nada de `src/`: es un
proceso suelto que habla con Supabase por HTTPS y WebSocket. ENG-70 se lleva el
diseño, no los archivos.

## Por qué no es un test de CI

En ENG-45 las pruebas corren en CI contra un Postgres en Docker. Acá no se puede:
**Realtime no es Postgres**, es un servicio aparte que lee el WAL y lo reparte por
WebSocket. El contenedor de `docker-compose` no lo tiene, así que la validación
exige un proyecto real de Supabase y se corre a mano.

Tiene consecuencia para ENG-70: **el aislamiento del chat no se va a poder cubrir
con tests de CI** como se hizo con la cadena de hash. O se acepta esa brecha, o se
cubre con un test contra el proyecto de desarrollo fuera del pipeline.

## Cómo se sostiene el aislamiento

Realtime evalúa las políticas RLS de la tabla **por cada suscriptor, antes de
entregarle un cambio**. Si la política no deja leer la fila con un `select`
normal, tampoco llega por el WebSocket. La política del prototipo es la que va a
usar el chat:

```sql
create policy spike_messages_select_participants
  on spike_realtime_messages for select to authenticated
  using (
    exists (
      select 1
        from spike_realtime_conversations c
       where c.id = spike_realtime_messages.conversation_id
         and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
    )
  );
```

Dos requisitos que no son obvios y que rompen el mecanismo en silencio si faltan:

- **La tabla tiene que estar en la publicación `supabase_realtime`.** Si no está,
  nadie recibe nada — y el síntoma se lee como "el aislamiento funciona
  perfecto", que es la conclusión más peligrosa posible.
- **El cliente tiene que publicar su JWT al socket** (`realtime.setAuth(token)`).
  Sin eso el socket va como `anon`, `auth.uid()` es null, y otra vez nadie recibe
  nada por el motivo equivocado.

## 🔴 El filtro de Realtime NO es un control de acceso

Es el malentendido que este spike existe para descartar. Suscribirse con
`filter: conversation_id=eq.<id>` **no** protege nada: es una comodidad para no
recibir de más, y lo elige el cliente. Un cliente malicioso pone el filtro que
quiera, o directamente no pone ninguno.

Quien decide qué se entrega es RLS. Por eso el prototipo prueba explícitamente el
caso de un cliente que **pide el canal ajeno**, y el de uno que **escucha la tabla
entera sin filtro**. Un spike que solo probara "dos clientes en canales distintos
no se cruzan" estaría validando el filtro, no la seguridad.

## Resultados

Los cinco escenarios, contra el proyecto real:

| # | Escenario | Esperado | Resultado |
|---|---|---|---|
| 1 | A escucha su propia conversación (**control positivo**) | recibe | ✅ |
| 2 | C escucha su propia conversación, canal distinto | recibe solo lo suyo | ✅ |
| 3 | C se suscribe al canal de A, con el mismo filtro | nada | ✅ |
| 4 | C escucha la tabla entera, sin filtro | solo lo suyo | ✅ |
| 5 | Cliente sin sesión, solo con la anon key | nada | ✅ |

**Los criterios de aceptación se cumplen.** El 2 cubre "dos clientes suscritos a
canales distintos"; el 3 y el 4 son los que realmente prueban que un cliente no
recibe lo del otro, y el 5 cubre al atacante más realista: alguien que saca la
anon key del bundle del frontend, donde viaja por diseño.

El escenario 1 no es decorativo. Es lo que evita firmar un aislamiento falso: si
Realtime no estuviera funcionando, los escenarios 3, 4 y 5 darían verde igual.

## 🔴 Hallazgo — la entrega no está garantizada

En **1 de 6 corridas**, el escenario 1 falló: A no recibió un mensaje de su propia
conversación. El diagnóstico del script descarta que sea un problema de permisos —
en la misma corrida, A leyó ese mensaje por HTTP con las mismas políticas.

O sea: **RLS lo autorizaba y Realtime no se lo entregó.**

Se intentó reproducirlo dirigidamente (sacar la tabla de la publicación,
recrearla y suscribirse de inmediato, por si era propagación del cambio de
publicación) y **no se reprodujo**: esa corrida pasó 5/5. La causa quedó sin
determinar.

No alcanza para rechazar Realtime, pero sí para fijar una regla en ENG-70:

> **El stream no es la fuente de verdad.** Al abrir una conversación hay que traer
> el historial por HTTP *después* de suscribirse y reconciliar por `id`, y no
> asumir que todo lo que se envió llegó por el canal.

Aplicado al chat, un mensaje perdido en silencio es que el paciente no ve lo que
le contestó el profesional. La reconciliación no es una optimización, es
corrección.

## Postgres Changes vs Broadcast

El prototipo usa **Postgres Changes**, que es lo que asume el ticket. La
documentación de Supabase recomienda lo contrario:

> Broadcast. This is the recommended method for scalability and security.
> Postgres Changes […] does not scale as well as Broadcast.

El motivo es concreto: Postgres Changes corre en **un solo hilo** para preservar
el orden de los cambios, así que aumentar el compute casi no mueve el techo. Y
cada cambio se evalúa contra la política RLS **una vez por suscriptor**: el costo
crece con la cantidad de gente conectada, no con la cantidad de mensajes.

La política del chat, además, tiene un `exists` con subconsulta — la forma más
cara de política. La documentación avisa:

> Increased RLS complexity can impact database performance and connection time,
> leading to higher connection latency and decreased join rates.

Con Broadcast la autorización se hace distinto: RLS sobre `realtime.messages` más
canales con `private: true`, y el mensaje se emite desde la base con
`realtime.send()` en un trigger. La autorización se evalúa **al unirse al canal**,
no por cada mensaje y por cada suscriptor.

**Para el volumen de MediConnect, Postgres Changes alcanza** y es marcadamente más
simple. Pero la decisión hay que tomarla a ojos abiertos y dejarla registrada,
porque migrar el chat de un mecanismo al otro más adelante toca cliente, base y
políticas a la vez.

## Límites del plan Free

Datos de la [documentación oficial](https://supabase.com/docs/guides/realtime/limits):

| | Free | Pro |
|---|---|---|
| **Conexiones concurrentes** | **200** | 500 |
| Mensajes por segundo | 100 | 500 |
| Channel joins por segundo | 100 | 500 |
| Canales por conexión | 100 | 100 |
| Payload de Broadcast | 256 KB | 3 MB |
| Payload de Postgres Changes | 1 MB | 1 MB |

Traducido a MediConnect:

- **200 conexiones concurrentes se cuentan por socket, no por usuario.** Una
  persona con la web en dos pestañas más la app mobile son tres conexiones. El
  techo realista está bastante por debajo de 200 personas simultáneas.
- **Canales por conexión (100)** no aprieta: el patrón es un canal por
  conversación abierta, y nadie tiene 100 chats abiertos a la vez.
- **100 mensajes por segundo** es holgado para chat entre dos personas. Ojo si
  alguna vez se usa Realtime para notificaciones masivas, que es otro perfil.
- El límite que primero se toca en una demo con jurado y varios dispositivos
  conectados es el de **conexiones**, no el de mensajes.

Para la defensa del proyecto esto no es un riesgo: 200 conexiones concurrentes
sobran para cualquier demo. Es un riesgo si el producto crece, y la salida es el
plan Pro, no un rediseño.

## Lo que este spike NO valida

- **Solo se probó `INSERT`.** El chat va a necesitar `UPDATE` para `read_at`. La
  tabla quedó con `replica identity full` (necesario para que RLS pueda evaluarse
  sobre la fila completa en UPDATE/DELETE), pero **el caso no se ejercitó**.
  `replica identity full` además infla el WAL, porque cada cambio escribe la fila
  entera.
- **No se probó bajo carga.** Cinco suscripciones no dicen nada sobre el
  comportamiento con decenas de suscriptores concurrentes, que es justo donde la
  evaluación de RLS por suscriptor se vuelve cara.
- **No se probó reconexión.** Qué pasa con los mensajes emitidos mientras el
  cliente estaba desconectado (túnel, cambio de red) no se exploró, y es el caso
  más común en mobile. Se resuelve con la misma reconciliación por HTTP.
- **No se probó la escritura.** Quién puede insertar un mensaje en qué
  conversación es decisión de ENG-70; acá solo se validó quién puede **leer**.

## Recomendaciones para ENG-70

ENG-70 (*enviar y recibir mensajes fuera de la consulta*, Sprint 8) es quien
implementa el chat. Del mismo mecanismo cuelgan **ENG-71** (push por mensajes
nuevos) y **ENG-102** (archivos en el chat), así que lo que se decida acá los
condiciona a los tres.

1. **Traer el historial por HTTP después de suscribirse, y reconciliar por `id`.**
   Es la consecuencia directa del hallazgo: hubo una entrega perdida en 6 corridas
   y la causa no se determinó. Sin esto, un mensaje perdido es invisible.
2. Portar las políticas RLS del prototipo a una migración de verdad sobre
   `messages` y `conversations`, junto con los GRANT. Hoy esas tablas **no tienen
   RLS ni GRANT**: existen desde la migración de EP-02/EP-10 y nunca se
   aseguraron.
3. Agregar `messages` a la publicación `supabase_realtime` **en la migración**, no
   a mano desde el dashboard. Es la clase de paso manual que funciona en
   desarrollo y falta en producción.
4. Publicar el JWT al socket con `realtime.setAuth()` y volver a llamarlo al
   refrescar el token. Un token vencido en un socket abierto es una fuente de
   fallos difíciles de leer.
5. Decidir explícitamente sobre `read_at`: si se actualiza por cada mensaje leído,
   cada update viaja por el WAL con la fila completa. Conviene agrupar.
6. Dejar registrada la elección de Postgres Changes sobre Broadcast, con el
   límite conocido, para no volver a discutirlo cada vez que aparezca la
   recomendación de la documentación.

## Cómo reproducirlo

1. En el SQL editor del proyecto de Supabase, ejecutar
   `mediconnect-backend/prisma/spikes/eng52_realtime_chat.sql`.
2. Con `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` en el
   `.env`:

```bash
cd mediconnect-backend
pnpm run spike:eng52
```

El script crea sus tres usuarios de prueba y los borra al terminar, incluso si
falla. Al cerrar el spike, el teardown está al pie del archivo SQL.
