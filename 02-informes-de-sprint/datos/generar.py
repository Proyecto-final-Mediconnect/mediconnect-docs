"""Genera los informes de sprint de MediConnect (ENG-154).

Uso, desde la raíz de mediconnect-docs:

    python 02-informes-de-sprint/datos/generar.py

Lee la foto de Linear (`linear-AAAA-MM-DD.tsv`) y los PRs mergeados de los
cuatro repos (`prs-*.json`, sacados con `gh pr list --state merged --json
number,title,headRefName,mergedAt,author,url`) y escribe un informe por sprint
y el índice. Solo usa la biblioteca estándar. Si cambian los datos, se vuelve a
correr y los números se recalculan: nada se carga a mano.

La metodología, en particular de dónde sale la fecha de entrega de cada issue,
está en el README que este script genera.
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATOS = Path(__file__).resolve().parent
SALIDA = DATOS.parent
SNAPSHOT = sorted(DATOS.glob("linear-*.tsv"))[-1]
FECHA_SNAPSHOT = SNAPSHOT.stem.removeprefix("linear-")
REPOS = ["backend", "web", "mobile", "docs"]

# Lunes 22/06/2026 a las 00:00 de Argentina (UTC-3), como los ciclos de Linear.
INICIO_SPRINT_1 = datetime(2026, 6, 22, 3, 0, tzinfo=timezone.utc)
DURACION = timedelta(days=14)
SPRINTS = range(1, 12)
HOY = datetime.fromisoformat(f"{FECHA_SNAPSHOT}T23:59:59+00:00")

# Release de cada sprint según el Plan de Proyecto §3.2.
RELEASE = {**{n: "R1 · Core" for n in range(1, 6)},
           **{n: "R2 · Cobro" for n in range(6, 9)},
           **{n: "R3 · Chat y MediPass" for n in range(9, 12)}}

# Objetivo de cada sprint: el del Plan de Proyecto, y desde el Sprint 7 el
# replanificado para cerrar el 18/11.
OBJETIVO = {
    1: "Setup técnico (repos, CI/CD, base de datos) y autenticación base.",
    2: "Perfiles de paciente y profesional, y cimientos del catálogo.",
    3: "Turnos y agenda; observabilidad con Sentry.",
    4: "Catálogo, reservas y videoconsulta, y los spikes de la historia clínica.",
    5: "Historia clínica funcional con cadena de hash, y decisión del alcance mobile.",
    6: "Cobro con MercadoPago, rate limiting, backup y primeros pasos de la app mobile.",
    7: "Cierre del Release 2 (cancelaciones, reembolsos, emails) y la app mobile del paciente.",
    8: "MediPass para la jornada del 06/10, chat y auditoría de accesos.",
    9: "Ronda de merges del 20/10, release 2.0.0 de mobile y MediPass contra la API real.",
    10: "Completar MediPass, reseñas, documentos del paciente, seguridad del Sprint 0 y ARCO.",
    11: "Cierre del proyecto: release final, documentación y presentación del 18/11.",
}

# Lo que pasó y no se ve en los números. Solo hechos verificables en los repos
# o en Linear.
NOTAS = {
    1: ["El 04/07 se versionó el modelo de datos (DER y normalización, ENG-89).",
        "La release 1.0.0 del backend salió el 06/07, el primer día del Sprint 2: casi todo lo comprometido acá entró esa semana."],
    2: ["Se corrigió una escalada de privilegios: el rol de alta salía de `user_metadata`, que escribe el cliente (ENG-91)."],
    3: ["Fue el sprint con menos actividad del Release 1: tres PRs en dos semanas.",
        "Sentry, comprometido acá, entró el 11/08, en el Sprint 4 (ENG-97, ENG-98)."],
    4: ["Los spikes de cadena de hash (ENG-45), Realtime (ENG-52) y Expo EAS (ENG-46) se cerraron antes de construir sobre ellos."],
    5: ["**Desvío de alcance:** se recortó la app mobile al flujo del paciente y se documentó en el addendum (ENG-111).",
        "**Desvío de testing:** Detox quedó fuera del proyecto por ADR-017, y la evidencia mobile pasa a ser el checklist de emulador (ENG-121)."],
    6: ["El pago con MercadoPago, el centro de este sprint, entró recién el 20/10, en el Sprint 9 (ENG-63)."],
    7: ["**No se mergeó ningún PR en los cuatro repos entre el 14/09 y el 27/09.** Lo comprometido acá (la app mobile del paciente, cancelaciones y emails) entró entre los sprints 8 y 10."],
    8: ["**Jornada del 06/10:** el MediPass se mostró en el stand con el juego \"Médico de guardia\" (ENG-141)."],
    9: ["**20/10, ronda de merges:** entraron 14 PRs en una noche y `release/2.0.0` de mobile llegó a `main`.",
        "**Incidente:** web#36 (MediPass contra la API) se mergeó antes que su backend, y la pantalla falló en producción hasta backend#68.",
        "Tres PRs verdes por separado dejaron rojo el árbol combinado: es el caso de ENG-128, que sigue abierto."],
    10: ["**03/11, segunda ronda:** se revisaron y mergearon 24 PRs de los cuatro repos.",
         "Se activó Dependabot (ENG-166). Sus PRs de dependencias npm se cerraron sin mergear porque no respetan los `pnpm.overrides`.",
         "En revisión al cierre de la foto: tarjeta de emergencia (ENG-176), derechos ARCO (ENG-86) y rol mínimo de la base (ENG-138)."],
    11: ["El 18/11 es la presentación de regularización, dentro de este sprint."],
}


@dataclass
class Issue:
    id: str
    sp: int | None
    sprint: int | None
    tipo: str
    estado: str
    completado: datetime | None
    titulo: str
    prs: list[dict] = field(default_factory=list)
    entrega: datetime | None = None

    @property
    def numero(self) -> int:
        return int(self.id.split("-")[1])


def fecha(s: str) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def inicio(n: int) -> datetime:
    return INICIO_SPRINT_1 + DURACION * (n - 1)


def sprint_de(d: datetime) -> int | None:
    n = (d - INICIO_SPRINT_1) // DURACION + 1
    return n if n >= 1 else None


def cargar() -> tuple[list[Issue], list[dict]]:
    with SNAPSHOT.open(encoding="utf-8") as f:
        issues = [
            Issue(
                id=r["id"],
                sp=int(r["sp"]) if r["sp"] else None,
                sprint=int(r["sprint"]) if r["sprint"] else None,
                tipo=r["tipo"],
                estado=r["estado"],
                completado=fecha(r["completado"]),
                titulo=r["titulo"],
            )
            for r in csv.DictReader(f, delimiter="\t")
        ]
    prs = []
    for repo in REPOS:
        for pr in json.loads((DATOS / f"prs-{repo}.json").read_text(encoding="utf-8")):
            pr["repo"] = repo
            pr["merged"] = fecha(pr["mergedAt"])
            prs.append(pr)
    return issues, prs


def asociar(issues: list[Issue], prs: list[dict]) -> None:
    """Cada PR va a los issues que nombra en el título o en la rama."""
    por_numero = {i.numero: i for i in issues}
    for pr in prs:
        texto = f"{pr['title']} {pr['headRefName']}"
        for n in {int(m) for m in re.findall(r"(?i)\beng-(\d+)(?!\d)", texto)}:
            if n in por_numero:
                por_numero[n].prs.append(pr)

    for i in issues:
        if i.estado != "Done":
            continue
        # La fecha de entrega es la del último PR mergeado hasta el cierre en
        # Linear (con un día de margen). Corrige los cierres en tanda —el 13/10,
        # el 20/10 y el 03/11 se cerraron decenas de issues en minutos— sin
        # dejar que un arreglo posterior corra la entrega meses.
        tope = i.completado + timedelta(days=1)
        previos = [p["merged"] for p in i.prs if p["merged"] <= tope]
        i.entrega = max(previos) if previos else i.completado


def sp(issues: list[Issue]) -> int:
    return sum(i.sp or 0 for i in issues)


def burndown(n: int, comprometidos: list[Issue]) -> str:
    """Pendiente del compromiso, día por día. En SP; en issues si no hay estimaciones."""
    por_sp = sp(comprometidos) > 0
    peso = (lambda i: i.sp or 0) if por_sp else (lambda i: 1)
    total = sum(peso(i) for i in comprometidos)
    if total == 0:
        return "_Sin compromiso cargado: no hay burndown que dibujar._"
    dias = 14
    real, ideal = [], []
    for d in range(dias + 1):
        corte = inicio(n) + timedelta(days=d)
        if corte > HOY + timedelta(days=1):
            break
        hecho = sum(peso(i) for i in comprometidos if i.entrega and i.entrega <= corte)
        real.append(total - hecho)
        ideal.append(round(total - total * d / dias, 1))
    unidad = "SP" if por_sp else "issues"
    eje = ", ".join(f'"D{d}"' for d in range(len(real)))
    return "\n".join([
        "```mermaid",
        "xychart-beta",
        f'  title "Sprint {n}: {unidad} comprometidos pendientes"',
        f"  x-axis [{eje}]",
        f'  y-axis "{unidad} pendientes" 0 --> {total}',
        f"  line [{', '.join(str(v) for v in ideal)}]",
        f"  line [{', '.join(str(v) for v in real)}]",
        "```",
        "",
        f"La línea que baja en recta es la ideal; la otra, lo que quedaba pendiente al final de cada día"
        f" ({unidad}, según la fecha de entrega). Lo que se entregó después del sprint queda como pendiente hasta el día 14.",
    ])


def fila(i: Issue) -> str:
    entrega = i.entrega.strftime("%d/%m") if i.entrega else "—"
    sprint_entrega = sprint_de(i.entrega) if i.entrega else None
    cuando = f"Sprint {sprint_entrega}" if sprint_entrega else i.estado
    return f"| {i.id} | {i.titulo} | {i.tipo} | {i.sp or '—'} | {entrega} | {cuando} |"


def informe(n: int, issues: list[Issue], prs: list[dict]) -> tuple[str, dict]:
    desde, hasta = inicio(n), inicio(n) + DURACION
    en_curso = desde <= HOY < hasta
    futuro = HOY < desde
    comprometidos = [i for i in issues if i.sprint == n]
    entregados = [i for i in issues if i.entrega and desde <= i.entrega < hasta]
    cumplidos = [i for i in comprometidos if i.entrega and i.entrega < hasta]
    prs_sprint = sorted((p for p in prs if desde <= p["merged"] < hasta), key=lambda p: p["merged"])

    metricas = {
        "n": n,
        "comprometidos": len(comprometidos),
        "sp_comprometidos": sp(comprometidos),
        "cumplidos": len(cumplidos),
        "sp_cumplidos": sp(cumplidos),
        "entregados": len(entregados),
        "velocity": sp(entregados),
        "prs": len(prs_sprint),
        "estado": "en curso" if en_curso else ("planificado" if futuro else "cerrado"),
    }
    pct = (f"{round(100 * len(cumplidos) / len(comprometidos))} %" if comprometidos else "—")

    tipos = defaultdict(int)
    for i in entregados:
        tipos[i.tipo or "Sin tipo"] += 1

    L = [
        f"# Informe del Sprint {n}",
        "",
        f"**Fechas:** {desde:%d/%m/%Y} al {(hasta - timedelta(days=1)):%d/%m/%Y} · "
        f"**Release:** {RELEASE[n]} · **Estado:** {metricas['estado']}"
        + (f" (foto del {datetime.fromisoformat(FECHA_SNAPSHOT):%d/%m/%Y})" if en_curso or futuro else ""),
        "",
        "## Objetivo",
        "",
        OBJETIVO[n],
        "",
        "## Métricas",
        "",
        "| Métrica | Valor |",
        "|---|---|",
        f"| Comprometido | {len(comprometidos)} issues · {sp(comprometidos)} SP |",
        f"| Comprometido y entregado en el sprint | {len(cumplidos)} issues · {sp(cumplidos)} SP ({pct} de los issues) |",
        f"| Entregado en el sprint (comprometido o no) | {len(entregados)} issues |",
        f"| **Velocity** (SP entregados en el sprint) | **{sp(entregados)} SP** |",
        f"| PRs mergeados | {len(prs_sprint)} |",
        f"| Entregado por tipo | {', '.join(f'{k}: {v}' for k, v in sorted(tipos.items())) or '—'} |",
        "",
        "## Burndown del compromiso",
        "",
        burndown(n, comprometidos) if not futuro else "_El sprint todavía no empezó._",
        "",
        "## Historias comprometidas",
        "",
    ]
    if comprometidos:
        L += ["| Issue | Título | Tipo | SP | Entrega | Entregado en |", "|---|---|---|---|---|---|"]
        L += [fila(i) for i in sorted(comprometidos, key=lambda i: i.numero)]
    else:
        L.append("_Ninguna issue tiene asignado este sprint._")

    extra = [i for i in entregados if i.sprint != n]
    L += ["", "## Entregado fuera de lo comprometido", ""]
    if extra:
        L.append("Entraron en este sprint, pero estaban comprometidas en otro o no tenían sprint:")
        L += ["", "| Issue | Título | Tipo | SP | Entrega | Comprometida en |", "|---|---|---|---|---|---|"]
        for i in sorted(extra, key=lambda i: i.numero):
            L.append(f"| {i.id} | {i.titulo} | {i.tipo} | {i.sp or '—'} | {i.entrega:%d/%m} | "
                     f"{'Sprint ' + str(i.sprint) if i.sprint else 'sin sprint'} |")
    else:
        L.append("_Nada._")

    L += ["", "## Incremento: PRs mergeados", ""]
    if prs_sprint:
        for repo in REPOS:
            del_repo = [p for p in prs_sprint if p["repo"] == repo]
            if not del_repo:
                continue
            L.append(f"**{repo}** ({len(del_repo)})")
            L.append("")
            L += [f"- [#{p['number']}]({p['url']}) {p['title']} · {p['merged']:%d/%m}" for p in del_repo]
            L.append("")
    else:
        L += ["_No se mergeó ningún PR en estas fechas._", ""]

    L += ["## Desvíos, impedimentos y decisiones", ""]
    L += [f"- {nota}" for nota in NOTAS.get(n, [])] or ["- Sin desvíos registrados."]
    pendientes = [i for i in comprometidos if not (i.entrega and i.entrega < hasta)]
    if pendientes and not futuro:
        L += ["", "**No se completó en el sprint:** " +
              ", ".join(f"{i.id}" + (f" (entregada en el Sprint {sprint_de(i.entrega)})" if i.entrega else f" ({i.estado})")
                        for i in sorted(pendientes, key=lambda i: i.numero)) + "."]
    L += ["", "---", "",
          f"_Generado con `datos/generar.py` a partir de la foto de Linear del {datetime.fromisoformat(FECHA_SNAPSHOT):%d/%m/%Y}"
          " y de los PRs mergeados de los cuatro repos. Metodología en el [índice](README.md)._", ""]
    return "\n".join(L), metricas


def indice(metricas: list[dict], issues: list[Issue]) -> str:
    total_sp = sp([i for i in issues if i.sp])
    filas, acumulado, avance = [], 0, []
    for m in metricas:
        acumulado += m["velocity"]
        avance.append(round(100 * acumulado / total_sp) if total_sp else 0)
        pct = f"{round(100 * m['cumplidos'] / m['comprometidos'])} %" if m["comprometidos"] else "—"
        filas.append(
            f"| [Sprint {m['n']}](sprint-{m['n']:02d}.md) | {inicio(m['n']):%d/%m} | {RELEASE[m['n']]} | {m['estado']} | "
            f"{m['comprometidos']} · {m['sp_comprometidos']} SP | {m['cumplidos']} · {m['sp_cumplidos']} SP ({pct}) | "
            f"{m['entregados']} | **{m['velocity']}** | {m['prs']} | {avance[-1]} % |")

    cerrados = [m for m in metricas if m["estado"] == "cerrado"]
    promedio = round(sum(m["velocity"] for m in cerrados) / len(cerrados), 1) if cerrados else 0
    hechas = [i for i in issues if i.estado == "Done"]
    abiertas = [i for i in issues if i.estado != "Done"]

    return "\n".join([
        "# Informes de sprint",
        "",
        "Un informe por sprint, del 1 al 11, con las métricas que compromete el Plan de Proyecto §2.4: "
        "velocity, burndown, avance por release y Story Points completados. Los genera "
        f"`datos/generar.py` a partir de la foto de Linear del **{datetime.fromisoformat(FECHA_SNAPSHOT):%d/%m/%Y}** "
        "y de los PRs mergeados de los cuatro repos.",
        "",
        "## Resumen",
        "",
        "| Sprint | Inicio | Release | Estado | Comprometido | Cumplido | Entregado (issues) | Velocity (SP) | PRs | Avance acumulado |",
        "|---|---|---|---|---|---|---|---|---|---|",
        *filas,
        "",
        f"- **Velocity promedio de los sprints cerrados:** {promedio} SP por sprint.",
        f"- **Backlog:** {len(hechas)} issues terminadas y {len(abiertas)} abiertas, de {len(issues)}.",
        f"- **Avance acumulado:** SP entregados sobre los {total_sp} SP estimados del backlog completo (Releases 1 a 4).",
        "",
        "```mermaid",
        "xychart-beta",
        '  title "Velocity por sprint (SP entregados)"',
        f"  x-axis [{', '.join(str(m['n']) for m in metricas)}]",
        f'  y-axis "SP" 0 --> {max(m["velocity"] for m in metricas) + 5}',
        f"  bar [{', '.join(str(m['velocity']) for m in metricas)}]",
        "```",
        "",
        "## Metodología",
        "",
        "### De dónde sale cada número",
        "",
        "- **Comprometido:** las issues con la label `Sprint N` en Linear. Desde el Sprint 10 el equipo dejó "
        "de usar labels y planificó con el ciclo de Linear, así que para el 10 el compromiso es el ciclo.",
        "- **Fecha de entrega:** la del **último PR mergeado** que nombra a la issue (en el título o en la "
        "rama, `ENG-XX`) hasta su cierre en Linear, con un día de margen. Si no hay PR, la fecha de cierre en Linear.",
        "- **Velocity:** los Story Points de las issues entregadas dentro de las fechas del sprint, "
        "estuvieran comprometidas o no. Las issues sin estimar cuentan como entregadas pero no suman SP.",
        "- **Burndown:** lo que quedaba pendiente del compromiso al final de cada día, en SP. Si nada de lo "
        "comprometido estaba estimado, en cantidad de issues.",
        "",
        "### Las dos decisiones que hubo que tomar",
        "",
        "**1. Fuente de verdad del sprint: la fecha, no el ciclo.** En Linear, las labels `Sprint N` y los ciclos "
        "se contradicen: el ciclo de Sprint 8 figura con 37 issues y 0 completadas, y muchas issues de los primeros "
        "sprints apuntan al ciclo de Sprint 9. Además, los sprints 1 a 4 no tienen ciclo. Por eso cada informe usa "
        "las fechas del calendario (14 días desde el lunes 22/06/2026) y no el ciclo. La label es lo que se comprometió "
        "y la fecha de entrega es lo que pasó.",
        "",
        "**2. La fecha de entrega sale del PR, no del cierre en Linear.** El 13/10, el 20/10 y el 03/11 se cerraron "
        "decenas de issues en minutos, al poner el tablero al día. Usar esa fecha concentraría en tres días el trabajo "
        "de semanas. El merge del PR es cuándo el incremento llegó de verdad a la rama.",
        "",
        "### Limitaciones, dichas en voz alta",
        "",
        "- **Story Points:** las issues creadas desde octubre casi no tienen estimación, así que la velocity de los "
        "sprints 9 y 10 subestima el trabajo. Para esos sprints la cantidad de issues y de PRs dice más.",
        "- **Issues sin PR propio** (decisiones, documentación, configuración): su fecha es la de Linear, incluso "
        "si fue un cierre en tanda.",
        "- **El Sprint 10 está en curso y el 11 no empezó:** sus informes son una foto, no un cierre.",
        "",
        "## Cómo regenerarlos",
        "",
        "```sh",
        "# 1. Foto de Linear: exportar las issues del equipo ENG a datos/linear-AAAA-MM-DD.tsv",
        "#    (columnas: id, sp, sprint, tipo, estado, completado, titulo).",
        "# 2. PRs mergeados de cada repo:",
        "for r in backend web mobile docs; do",
        "  gh pr list -R Proyecto-final-Mediconnect/mediconnect-$r --state merged --limit 400 \\",
        "    --json number,title,headRefName,mergedAt,author,url > 02-informes-de-sprint/datos/prs-$r.json",
        "done",
        "# 3. Generar:",
        "python 02-informes-de-sprint/datos/generar.py",
        "```",
        "",
        "La [plantilla](plantilla.md) describe la estructura de cada informe.",
        "",
    ])


def main() -> None:
    issues, prs = cargar()
    asociar(issues, prs)
    metricas = []
    for n in SPRINTS:
        texto, m = informe(n, issues, prs)
        (SALIDA / f"sprint-{n:02d}.md").write_text(texto, encoding="utf-8")
        metricas.append(m)
    (SALIDA / "README.md").write_text(indice(metricas, issues), encoding="utf-8")
    for m in metricas:
        print(f"Sprint {m['n']:>2}: comprometido {m['sp_comprometidos']:>3} SP, velocity {m['velocity']:>3} SP, "
              f"{m['entregados']:>2} issues, {m['prs']:>3} PRs ({m['estado']})")


if __name__ == "__main__":
    main()
