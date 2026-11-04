# Plantilla del informe de sprint

Todos los informes tienen esta estructura. Los genera `datos/generar.py`: para
cambiar el formato se cambia el script, no los informes a mano, así los once
siguen iguales.

## Encabezado

Fechas (lunes a domingo, 14 días), release del Plan de Proyecto §3.2 y estado
(cerrado, en curso o planificado).

## Objetivo

El objetivo del sprint según el Plan de Proyecto. Desde el Sprint 7, el
replanificado para cerrar el 18/11.

## Métricas

| Métrica | De dónde sale |
|---|---|
| Comprometido | Issues con la label `Sprint N` (desde el Sprint 10, el ciclo de Linear) |
| Comprometido y entregado | Las comprometidas cuya fecha de entrega cae dentro del sprint |
| Entregado | Todas las issues entregadas en las fechas del sprint, comprometidas o no |
| Velocity | SP de lo entregado |
| PRs mergeados | PRs de los cuatro repos mergeados en las fechas del sprint |
| Entregado por tipo | Historia de usuario, tarea técnica, spike, bug |

## Burndown del compromiso

Lo comprometido que quedaba pendiente al final de cada día, contra la línea
ideal. En SP, o en cantidad de issues si nada estaba estimado.

## Historias comprometidas

Cada issue con su tipo, SP, fecha de entrega y en qué sprint se entregó de
verdad.

## Entregado fuera de lo comprometido

Lo que entró sin estar comprometido en este sprint: adelantos, arrastres de
sprints anteriores y trabajo no planificado.

## Incremento

Los PRs mergeados, por repo, con enlace. Es la evidencia del incremento.

## Desvíos, impedimentos y decisiones

Lo que no se ve en los números, escrito a mano en `NOTAS` del script y solo con
hechos verificables, más la lista de lo comprometido que no se completó.
