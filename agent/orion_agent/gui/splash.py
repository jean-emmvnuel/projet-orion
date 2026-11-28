"""Ouverture de l'app desktop : la ceinture d'Orion devient le logo ORION.

Même animation que l'app mobile (app/src/components/SplashOverlay.tsx), mêmes positions,
couleurs et minutage :
  1. les trois étoiles de la ceinture scintillent dans un ciel étoilé ;
  2. les étoiles extérieures glissent sur la diagonale et deviennent les nœuds du « O réciproque » ;
  3. les arcs se dessinent depuis les nœuds, le logo fait un tour, le nom apparaît ;
  4. zoom à travers le logo vers la fenêtre.
"""

import asyncio
import math
import random
import time

import flet as ft
import flet.canvas as cv

SIZE = 220
DURATION = 2.0  # s, de START à 1
EXIT = 0.48  # s
START = 0.3  # ceinture déjà allumée, comme le splash natif du téléphone

COLORS = {
    "light": {"bg": "#f4f2f7", "arc": "#16131b", "node": "#8a0fd1", "star": "#3b1a66", "glow": "#8a0fd1", "sky": "#8f7fae"},
    "dark": {"bg": "#0b0a0e", "arc": "#f5f3f8", "node": "#b878f5", "star": "#ffffff", "glow": "#9d7bff", "sky": "#cfc6ff"},
}

# Positions dans une boîte de 256 (comme le logo).
BELT = [
    {"from": (34, 60, 7), "to": (70.99, 70.99, 23.44), "appear": 0.04},
    {"from": (128, 123, 8.5), "to": (128, 128, 0), "appear": 0.11},
    {"from": (222, 194, 7), "to": (185.01, 185.01, 23.44), "appear": 0.18},
]
ARC_R = 80.63
ARC_STARTS = (225, 45)  # degrés, sens horaire ; chaque arc couvre 140°


def _clamp(v: float) -> float:
    return min(1.0, max(0.0, v))


def _ease(v: float) -> float:
    x = _clamp(v)
    return 4 * x * x * x if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def _phase(p: float, a: float, b: float) -> float:
    return _clamp((p - a) / (b - a))


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _alpha(color: str, a: float) -> str:
    return ft.Colors.with_opacity(round(_clamp(a), 3), color)


class Splash:
    def __init__(self, dark: bool):
        self.c = COLORS["dark" if dark else "light"]
        rand = random.Random(42)
        # Ciel : petites étoiles autour de la ceinture (boîte élargie -100…356).
        self.sky = [
            (-100 + rand.random() * 456, -100 + rand.random() * 456, 0.6 + rand.random() * 1.4, START + rand.random() * 0.08)
            for _ in range(26)
        ]
        self.k = SIZE / 256
        self.canvas = cv.Canvas(width=SIZE, height=SIZE)
        self.logo = ft.Container(self.canvas, width=SIZE, height=SIZE, rotate=ft.Rotate(0), scale=ft.Scale(1))
        self.word = ft.Text("ORION", size=22, font_family="InterBold", color=self.c["arc"], opacity=0, style=ft.TextStyle(letter_spacing=6))
        self.control = ft.Container(
            ft.Column(
                [self.logo, ft.Container(self.word, margin=ft.Margin.only(top=12))],
                horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                alignment=ft.MainAxisAlignment.CENTER,
                spacing=0,
            ),
            bgcolor=self.c["bg"],
            alignment=ft.Alignment.CENTER,
            left=0, top=0, right=0, bottom=0,
        )
        self.draw(START)

    # ------------------------------------------------------------------ dessin d'une image
    def draw(self, p: float) -> None:
        k, c = self.k, self.c
        shapes: list[cv.Shape] = []
        fade_sky = 1 - _phase(p, 0.5, 0.62)
        for x, y, r, delay in self.sky:
            o = _phase(p, delay, delay + 0.08) * fade_sky * (0.45 + 0.35 * math.sin(p * 30 + x))
            if o > 0.01:
                shapes.append(cv.Circle(x * k, y * k, r * k, paint=ft.Paint(color=_alpha(c["sky"], o))))

        arc_t = _ease(_phase(p, 0.58, 0.82))
        arc_o = _phase(p, 0.56, 0.6)
        if arc_t > 0 and arc_o > 0:
            stroke = ft.Paint(color=_alpha(c["arc"], arc_o), stroke_width=22.5 * k, style=ft.PaintingStyle.STROKE, stroke_cap=ft.StrokeCap.ROUND)
            box = ((128 - ARC_R) * k, (128 - ARC_R) * k, 2 * ARC_R * k, 2 * ARC_R * k)
            for start in ARC_STARTS:
                shapes.append(cv.Arc(*box, start_angle=math.radians(start), sweep_angle=math.radians(140 * arc_t), paint=stroke))

        move = _ease(_phase(p, 0.45, 0.68))
        tw = _phase(p, 0.25, 0.32) * (1 - _phase(p, 0.42, 0.5))
        for i, b in enumerate(BELT):
            (fx, fy, fr), (tx, ty, tr) = b["from"], b["to"]
            on = _ease(_phase(p, b["appear"], b["appear"] + 0.1))
            cx, cy = _lerp(fx, tx, move) * k, _lerp(fy, ty, move) * k
            wave = math.sin(p * 38 + i * 2.1)
            # halo
            glow_r = _lerp(fr, max(tr, 2), move) * (1 + 0.28 * wave * tw) * 3.2 * on * k
            glow_o = on * (1 - _phase(p, 0.62, 0.78))
            if glow_r > 0.5 and glow_o > 0.01:
                shapes.append(cv.Circle(cx, cy, glow_r, paint=ft.Paint(gradient=ft.PaintRadialGradient(
                    center=ft.Offset(cx, cy), radius=glow_r,
                    colors=[_alpha(c["glow"], 0.75 * glow_o), _alpha(c["glow"], 0.25 * glow_o), _alpha(c["glow"], 0)],
                    color_stops=[0, 0.35, 1]))))
            # nœud violet du logo qui prend le relais
            node_o = _phase(p, 0.56, 0.7)
            if tr > 0 and node_o > 0:
                shapes.append(cv.Circle(cx, cy, _lerp(fr, tr, move) * k, paint=ft.Paint(color=_alpha(c["node"], node_o))))
            # étoile
            star_o = on * (1 - _phase(p, 0.6, 0.72))
            star_r = _lerp(fr, tr, move) * (1 + 0.22 * wave * tw) * on * k
            if star_o > 0.01 and star_r > 0.2:
                shapes.append(cv.Circle(cx, cy, star_r, paint=ft.Paint(color=_alpha(c["star"], star_o))))

        self.canvas.shapes = shapes
        self.logo.rotate.angle = 2 * math.pi * _ease(_phase(p, 0.8, 1))
        w = _ease(_phase(p, 0.82, 0.96))
        self.word.opacity = w
        self.word.offset = ft.Offset(0, (1 - w) * 0.35)

    # ------------------------------------------------------------------ lecture
    async def play(self) -> None:
        t0 = time.perf_counter()
        while (el := time.perf_counter() - t0) < DURATION:
            self.draw(START + (1 - START) * el / DURATION)
            self.control.update()
            await asyncio.sleep(1 / 60)
        self.draw(1)
        self.control.update()
        await asyncio.sleep(0.15)
        # Sortie : zoom à travers le logo, le fond s'efface.
        t0 = time.perf_counter()
        while (el := time.perf_counter() - t0) < EXIT:
            e = el / EXIT
            e = e * e  # accélération (cubic-bezier 0.4,0,1,1 approchée)
            self.logo.scale.scale = 1 + 1.4 * e
            self.logo.opacity = _clamp(1 - e / 0.7)
            self.word.opacity = 1 - e
            self.control.bgcolor = _alpha(self.c["bg"], 1 - e)
            self.control.update()
            await asyncio.sleep(1 / 60)
