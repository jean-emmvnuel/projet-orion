"""Orbe « Constellation » et symbole ORION, dessinés sur un canvas Flet.

Port Python de app/src/components/orb/ConstellationOrb.tsx : des nœuds répartis sur et dans une
sphère, reliés à leurs plus proches voisins, autour d'un cœur lumineux. La sphère tourne,
respire et se hérisse selon l'activité de l'agent.
"""

import asyncio
import math
import time

import flet as ft
import flet.canvas as cv

from .theme import ORB, OrbColors, Palette


def _alpha(color: str, opacity: float) -> str:
    return ft.Colors.with_opacity(max(0.0, min(1.0, opacity)), color)


def _seeded(seed: int):
    s = seed

    def rand() -> float:
        nonlocal s
        s = (s * 16807) % 2147483647
        return (s - 1) / 2147483646

    return rand


def build_graph(shell: int):
    """Nœuds (coquille + intérieur) et liaisons vers les plus proches voisins, calculés une fois."""
    rand = _seeded(7)
    pts: list[tuple[float, float, float]] = []
    phase: list[float] = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(shell):
        yy = 1 - (i / (shell - 1)) * 2
        rr = math.sqrt(1 - yy * yy)
        th = golden * i
        r = 0.86 + rand() * 0.2
        pts.append((math.cos(th) * rr * r, yy * r, math.sin(th) * rr * r))
        phase.append(rand() * math.pi * 2)
    for _ in range(round(shell * 0.6)):
        u = rand() * 2 - 1
        th = rand() * math.pi * 2
        rr = math.sqrt(1 - u * u)
        r = rand() ** 0.7 * 0.82
        pts.append((math.cos(th) * rr * r, u * r, math.sin(th) * rr * r))
        phase.append(rand() * math.pi * 2)
    n = len(pts)
    edges: set[tuple[int, int]] = set()
    for i in range(n):
        xi, yi, zi = pts[i]
        near = sorted(((xi - x) ** 2 + (yi - y) ** 2 + (zi - z) ** 2, j) for j, (x, y, z) in enumerate(pts) if j != i)
        for d, j in near[: 5 if i < shell else 4]:
            if d < 0.2 * (190 / shell) ** 0.66:  # même densité de liens avec moins de nœuds
                edges.add((min(i, j), max(i, j)))
    return pts, phase, sorted(edges)


# Modes : 0 arrêté, 1 en ligne (repos), 2 connexion en cours, 3 action en cours
STOPPED, IDLE, CONNECTING, ACTIVE = range(4)


class ConstellationOrb:
    def __init__(self, size: int = 260, shell: int = 96):
        self.size = size
        self.pts, self.phase, self.edges = build_graph(shell)
        self.mode = STOPPED
        self.colors: OrbColors = ORB["glace"]
        self.dark = True
        self.level = 0.0
        self.kick = 0.0
        self.t = 0.0
        self.spin = 0.0
        self._task: asyncio.Task | None = None

        c = size / 2
        self.halo = cv.Circle(c, c, size * 0.5)
        self.lines = [cv.Points(point_mode=cv.PointMode.LINES) for _ in range(3)]
        self.nodes = [cv.Points(point_mode=cv.PointMode.POINTS) for _ in range(2)]
        self.core_glow = cv.Circle(c, c, size * 0.1)
        self.core = cv.Circle(c, c, size * 0.05)
        self.canvas = cv.Canvas(
            shapes=[self.halo, self.lines[0], self.nodes[0], self.lines[1], self.core_glow, self.core, self.lines[2], self.nodes[1]],
            width=size,
            height=size,
        )
        self.control = ft.Container(content=self.canvas, width=size, height=size)
        self._paint()
        self._frame(0.0)

    # --- état --------------------------------------------------------------------------------------
    def set_state(self, mode: int, colors: OrbColors, dark: bool) -> None:
        changed = colors is not self.colors or dark != self.dark
        self.mode, self.colors, self.dark = mode, colors, dark
        if changed:
            self._paint()

    def pulse(self, strength: float = 1.0) -> None:
        """Sursaut ponctuel (commande reçue, connexion établie…)."""
        self.kick = max(self.kick, strength)

    def _paint(self) -> None:
        col, dark = self.colors, self.dark
        c = self.size / 2
        line = col.ray if dark else col.glow
        self.halo.paint = ft.Paint(
            gradient=ft.PaintRadialGradient(
                center=(c, c),
                radius=self.size * 0.5,
                colors=[_alpha(col.glow, 0.42 if dark else 0.26), _alpha(col.glow, 0.09), _alpha(col.glow, 0)],
                color_stops=[0, 0.5, 1],
            )
        )
        u = self.size / 300
        widths = (0.6 * u, 0.8 * u, 1.0 * u)
        alphas = (0.18, 0.38, 0.85)
        for shape, w, a in zip(self.lines, widths, alphas, strict=True):
            shape.paint = ft.Paint(color=_alpha(line, a), stroke_width=w, style=ft.PaintingStyle.STROKE)
        self.nodes[0].paint = ft.Paint(color=_alpha(col.particles[1], 0.5), stroke_width=1.8 * u, stroke_cap=ft.StrokeCap.ROUND)
        self.nodes[1].paint = ft.Paint(color=col.particles[2], stroke_width=3.2 * u, stroke_cap=ft.StrokeCap.ROUND)
        self.core.paint = ft.Paint(color=col.core, blur_image=ft.Blur(6, 6))

    # --- animation ---------------------------------------------------------------------------------
    def _frame(self, dt: float) -> None:
        mode = self.mode
        target = {STOPPED: 0.0, IDLE: 0.12, CONNECTING: 0.3, ACTIVE: 0.75}[mode]
        if mode == ACTIVE:
            target += 0.2 * math.sin(self.t * 7.3) * math.sin(self.t * 3.1)
        target = min(1.0, target + self.kick)
        self.kick = max(0.0, self.kick - dt * 1.4)
        k = 16 if target > self.level else 4.5
        self.level += (target - self.level) * min(1.0, k * dt)
        self.t += dt
        speed = {STOPPED: 0.08, IDLE: 0.28, CONNECTING: 1.4, ACTIVE: 0.6}[mode]
        self.spin += dt * (speed + self.level * 0.9)

        a, time_, size = self.level, self.t, self.size
        c, R, focal = size / 2, size * 0.36, 3.2
        breathe = 0.025 * math.sin(time_ * 1.8) if mode in (STOPPED, IDLE) else 0.0
        ry = self.spin
        rx = 0.38 + 0.18 * math.sin(time_ * 0.23)
        cy, sy, cx, sx = math.cos(ry), math.sin(ry), math.cos(rx), math.sin(rx)
        spikes = mode == ACTIVE

        proj: list[tuple[float, float, float]] = []
        for (x, y, z), ph in zip(self.pts, self.phase, strict=True):
            wob = math.sin(time_ * 2.6 + ph)
            spike = max(0.0, math.sin(time_ * 5.2 + ph * 3)) * a * 0.22 if spikes else 0.0
            s = 1 + breathe + a * 0.12 + wob * (0.015 + a * 0.05) + spike
            X, Y, Z = x * s, y * s, z * s
            x1 = X * cy + Z * sy
            z1 = -X * sy + Z * cy
            y2 = Y * cx - z1 * sx
            z2 = Y * sx + z1 * cx
            p = focal / (focal - z2)
            proj.append((round(c + x1 * R * p, 1), round(c + y2 * R * p, 1), (z2 + 1.2) / 2.4))

        layers: list[list[tuple[float, float]]] = [[], [], []]
        for i, j in self.edges:
            pi, pj = proj[i], proj[j]
            d = (pi[2] + pj[2]) / 2
            layer = layers[0 if d < 0.4 else 1 if d < 0.62 else 2]
            layer.append((pi[0], pi[1]))
            layer.append((pj[0], pj[1]))
        for shape, pts in zip(self.lines, layers, strict=True):
            shape.points = pts
        self.nodes[0].points = [(p[0], p[1]) for p in proj if p[2] < 0.5]
        self.nodes[1].points = [(p[0], p[1]) for p in proj if p[2] >= 0.5]

        glow = 0.55 + a * 0.4 + (0.15 * math.sin(time_ * 6) if mode == CONNECTING else 0)
        if mode == STOPPED:
            glow *= 0.55
        self.core_glow.radius = size * (0.1 + a * 0.06)
        blur = 10 + a * 14
        self.core_glow.paint = ft.Paint(color=_alpha(self.colors.glow, glow), blur_image=ft.Blur(blur, blur))
        self.canvas.opacity = 0.55 if mode == STOPPED else 1.0

    async def _loop(self, fps: int) -> None:
        last = time.monotonic()
        while True:
            await asyncio.sleep(1 / fps)
            now = time.monotonic()
            self._frame(min(0.08, now - last))
            last = now
            try:
                self.canvas.update()
            except (RuntimeError, AssertionError):
                return  # contrôle retiré de la page

    def start(self, fps: int = 30) -> None:
        if not self._task or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._loop(fps))

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None


def logo(p: Palette, size: int = 28) -> cv.Canvas:
    """Symbole « O réciproque » (assets/logo-symbol.svg) : deux arcs et deux nœuds."""
    k = size / 256
    stroke = ft.Paint(color=p.logo_arc, stroke_width=24 * k, style=ft.PaintingStyle.STROKE)
    node = ft.Paint(color=p.logo_node)
    box = (128 - 86) * k, (128 - 86) * k, 172 * k, 172 * k
    return cv.Canvas(
        shapes=[
            cv.Arc(*box, start_angle=math.radians(225), sweep_angle=math.radians(140), paint=stroke),
            cv.Arc(*box, start_angle=math.radians(45), sweep_angle=math.radians(140), paint=stroke),
            cv.Circle(67.19 * k, 67.19 * k, 25 * k, paint=node),
            cv.Circle(188.81 * k, 188.81 * k, 25 * k, paint=node),
        ],
        width=size,
        height=size,
    )
