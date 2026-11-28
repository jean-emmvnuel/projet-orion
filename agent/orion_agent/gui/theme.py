"""Palette ORION, reprise de l'app mobile (app/src/theme/index.ts), en clair et en sombre."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Palette:
    dark: bool
    bg: str
    surface: str
    surface_raised: str
    fill: str
    fill_strong: str
    separator: str
    border_strong: str
    text: str
    text_muted: str
    text_faint: str
    violet: str
    on_violet: str
    accent_text: str
    violet_soft: str
    online: str
    online_soft: str
    warning: str
    warning_soft: str
    danger: str
    danger_soft: str
    logo_arc: str
    logo_node: str


def _rgba(r: int, g: int, b: int, a: float) -> str:
    """Couleur Flet au format #AARRGGBB."""
    return f"#{round(a * 255):02x}{r:02x}{g:02x}{b:02x}"


DARK = Palette(
    dark=True,
    bg="#0b0a0e",
    surface="#17151c",
    surface_raised="#1f1c26",
    fill=_rgba(235, 225, 255, 0.07),
    fill_strong=_rgba(235, 225, 255, 0.12),
    separator=_rgba(235, 225, 255, 0.09),
    border_strong=_rgba(235, 225, 255, 0.16),
    text="#f5f3f8",
    text_muted="#a7a1b2",
    text_faint="#857f90",
    violet="#9810e6",
    on_violet="#ffffff",
    accent_text="#c18cf7",
    violet_soft=_rgba(184, 120, 245, 0.16),
    online="#46d39a",
    online_soft=_rgba(70, 211, 154, 0.14),
    warning="#f5b03a",
    warning_soft=_rgba(245, 176, 58, 0.14),
    danger="#ff6475",
    danger_soft=_rgba(255, 100, 117, 0.15),
    logo_arc="#f5f5f7",
    logo_node="#b15cf0",
)

LIGHT = Palette(
    dark=False,
    bg="#f4f2f7",
    surface="#ffffff",
    surface_raised="#ffffff",
    fill=_rgba(48, 22, 92, 0.06),
    fill_strong=_rgba(48, 22, 92, 0.10),
    separator=_rgba(48, 22, 92, 0.10),
    border_strong=_rgba(48, 22, 92, 0.12),
    text="#16131b",
    text_muted="#5c5566",
    text_faint="#6f6879",
    violet="#8a0fd1",
    on_violet="#ffffff",
    accent_text="#7a12c4",
    violet_soft=_rgba(138, 15, 209, 0.10),
    online="#0f9e66",
    online_soft=_rgba(15, 158, 102, 0.12),
    warning="#b86e00",
    warning_soft=_rgba(184, 110, 0, 0.12),
    danger="#d92c43",
    danger_soft=_rgba(217, 44, 67, 0.10),
    logo_arc="#1a1919",
    logo_node="#9810e6",
)

# Familles déclarées dans page.fonts (une par graisse, polices statiques Inter).
FONTS = {
    "Inter": "fonts/Inter_400Regular.ttf",
    "InterMedium": "fonts/Inter_500Medium.ttf",
    "InterSemiBold": "fonts/Inter_600SemiBold.ttf",
    "InterBold": "fonts/Inter_700Bold.ttf",
}

RADIUS = {"sm": 10, "md": 14, "lg": 22, "xl": 28}


@dataclass(frozen=True)
class OrbColors:
    glow: str
    core: str
    particles: tuple[str, str, str]  # fond → milieu → devant
    ray: str


# Palettes de l'orbe (app/src/components/orb/palettes.ts) : violet quand l'agent est en ligne,
# bleu pendant la connexion, glace à l'arrêt, braise en cas d'erreur.
ORB = {
    "orion": OrbColors("#9810e6", "#f7eeff", ("#6d28d9", "#a35cf0", "#efe2ff"), "#d2acff"),
    "aurore": OrbColors("#3b5bff", "#effbff", ("#1e40af", "#38bdf8", "#dcf6ff"), "#a5e9ff"),
    "glace": OrbColors("#6ea3d0", "#ffffff", ("#5b7087", "#b7d0e6", "#ffffff"), "#dcebff"),
    "braise": OrbColors("#ff6a00", "#fff6e6", ("#c2410c", "#fb923c", "#ffe4bf"), "#ffc27d"),
}
