"""Taille utile de l'écran principal, en pixels logiques (ceux que Flet utilise pour la fenêtre)."""

import contextlib
import json
import subprocess
import sys

_GDK = """
import gi, json
gi.require_version('Gdk', '3.0')
from gi.repository import Gdk
d = Gdk.Display.get_default()
m = d.get_primary_monitor() or d.get_monitor(0)
g = m.get_workarea()
print(json.dumps([g.width, g.height]))
"""


def workarea() -> tuple[int, int] | None:
    """(largeur, hauteur) disponibles, ou None si inconnu."""
    with contextlib.suppress(Exception):
        if sys.platform.startswith("linux"):
            # GTK n'est pas dans le venv : on interroge le Python du système.
            out = subprocess.run(["/usr/bin/python3", "-c", _GDK], check=False, capture_output=True, text=True, timeout=4)
            w, h = json.loads(out.stdout)
            return int(w), int(h)
        if sys.platform == "win32":
            import ctypes
            from ctypes import wintypes

            rect = wintypes.RECT()
            ctypes.windll.user32.SystemParametersInfoW(0x30, 0, ctypes.byref(rect), 0)  # SPI_GETWORKAREA
            scale = ctypes.windll.shcore.GetScaleFactorForDevice(0) / 100
            return round((rect.right - rect.left) / scale), round((rect.bottom - rect.top) / scale)
        if sys.platform == "darwin":
            out = subprocess.run(
                ["osascript", "-e", 'tell application "Finder" to get bounds of window of desktop'],
                check=False, capture_output=True, text=True, timeout=4,
            )
            _x, _y, w, h = (int(v) for v in out.stdout.split(","))
            return w, h - 25  # barre des menus
    return None


def window_size(area: tuple[int, int] | None) -> tuple[int, int]:
    """Fenêtre confortable : environ 3/4 de l'écran, bornée pour rester lisible."""
    if not area:
        return 1100, 720
    w, h = area
    return max(860, min(1280, round(w * 0.74))), max(600, min(880, round(h * 0.84)))
