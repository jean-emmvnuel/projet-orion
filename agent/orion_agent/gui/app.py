"""Fenêtre de l'agent ORION : appairage, état de la connexion, tableau de bord du PC, journal et réglages."""

import asyncio
import contextlib
import logging
import socket
from collections import deque
from datetime import datetime
from pathlib import Path

import flet as ft
import flet.canvas as cv
import psutil

from .. import __version__
from ..config import CONFIG_FILE, Preferences
from ..pairing import PairingError, normalize_server, pair_async, update_device
from ..platform import current as osmod
from ..services import system
from . import orb as orbmod
from . import screen, service
from .runtime import LABELS, AgentRuntime
from .splash import Splash
from .theme import DARK, FONTS, LIGHT, ORB, RADIUS, Palette

ASSETS = Path(__file__).with_name("assets")
log = logging.getLogger("orion.gui")

# Libellé et icône de chaque action (catalogue de l'agent, voir actions.py).
ACTIONS = {
    "status": ("Statut du PC", ft.Icons.MONITOR_HEART_ROUNDED),
    "screenshot": ("Capture d'écran", ft.Icons.SCREENSHOT_MONITOR_ROUNDED),
    "lock": ("Verrouillage", ft.Icons.LOCK_ROUNDED),
    "unlock": ("Déverrouillage", ft.Icons.LOCK_OPEN_ROUNDED),
    "standby": ("Veille légère / réveil", ft.Icons.NIGHTLIGHT_ROUNDED),
    "sleep": ("Mise en veille", ft.Icons.BEDTIME_ROUNDED),
    "notify": ("Notification", ft.Icons.NOTIFICATIONS_ROUNDED),
    "files.list": ("Parcourir les fichiers", ft.Icons.FOLDER_OPEN_ROUNDED),
    "files.search": ("Recherche de fichiers", ft.Icons.SEARCH_ROUNDED),
    "files.get": ("Envoi d'un fichier", ft.Icons.DOWNLOAD_ROUNDED),
    "files.zip": ("Envoi d'un dossier (zip)", ft.Icons.FOLDER_ZIP_ROUNDED),
    "files.receive": ("Fichier reçu du téléphone", ft.Icons.UPLOAD_FILE_ROUNDED),
    "files.open": ("Lancement d'un fichier", ft.Icons.PLAY_CIRCLE_ROUNDED),
    "open.url": ("Ouverture d'un lien", ft.Icons.OPEN_IN_BROWSER_ROUNDED),
    "clipboard.get": ("Lecture du presse-papiers", ft.Icons.CONTENT_PASTE_ROUNDED),
    "clipboard.set": ("Copie dans le presse-papiers", ft.Icons.CONTENT_COPY_ROUNDED),
    "volume": ("Volume", ft.Icons.VOLUME_UP_ROUNDED),
    "media": ("Lecture multimédia", ft.Icons.MUSIC_NOTE_ROUNDED),
    "power": ("Redémarrer / éteindre", ft.Icons.POWER_SETTINGS_NEW_ROUNDED),
    "capabilities": ("Liste des commandes", ft.Icons.HELP_ROUNDED),
    "apps.list": ("Liste des applications", ft.Icons.APPS_ROUNDED),
    "apps.open": ("Ouverture d'une application", ft.Icons.OPEN_IN_NEW_ROUNDED),
    "web": ("Navigation web", ft.Icons.LANGUAGE_ROUNDED),
    "keys": ("Raccourci clavier", ft.Icons.KEYBOARD_ROUNDED),
    "type": ("Texte tapé", ft.Icons.KEYBOARD_ALT_ROUNDED),
    "remote": ("Écran en direct", ft.Icons.CONNECTED_TV_ROUNDED),
}

# Autorisations réglables (le statut reste toujours permis : c'est aussi la télémétrie).
PERMISSIONS = [
    ("screenshot", "Captures d'écran", ft.Icons.SCREENSHOT_MONITOR_ROUNDED, ("screenshot",)),
    ("lock", "Verrouiller la session", ft.Icons.LOCK_ROUNDED, ("lock",)),
    ("unlock", "Déverrouiller la session depuis le téléphone", ft.Icons.LOCK_OPEN_ROUNDED, ("unlock",)),
    ("sleep", "Mettre en veille (légère ou profonde)", ft.Icons.BEDTIME_ROUNDED, ("sleep", "standby")),
    ("notify", "Afficher des notifications", ft.Icons.NOTIFICATIONS_ROUNDED, ("notify",)),
    ("browse", "Parcourir et rechercher", ft.Icons.FOLDER_OPEN_ROUNDED, ("files.list", "files.search")),
    ("send", "Envoyer des fichiers au téléphone", ft.Icons.DOWNLOAD_ROUNDED, ("files.get", "files.zip")),
    ("receive", "Recevoir des fichiers du téléphone", ft.Icons.UPLOAD_FILE_ROUNDED, ("files.receive",)),
    ("open", "Lancer des fichiers et des liens", ft.Icons.PLAY_CIRCLE_ROUNDED, ("files.open", "open.url")),
    ("clipboard", "Partager le presse-papiers", ft.Icons.CONTENT_PASTE_ROUNDED, ("clipboard.get", "clipboard.set")),
    ("media", "Télécommande (son et lecture)", ft.Icons.MUSIC_NOTE_ROUNDED, ("volume", "media")),
    ("power", "Redémarrer et éteindre", ft.Icons.POWER_SETTINGS_NEW_ROUNDED, ("power",)),
    ("apps", "Ouvrir des applications", ft.Icons.APPS_ROUNDED, ("apps.list", "apps.open")),
    ("remote", "Écran en direct, souris et clavier", ft.Icons.CONNECTED_TV_ROUNDED, ("remote", "keys", "type", "web")),
]

# Créateur du projet (page « À propos »).
CREATOR = {
    "name": "Jean Emmanuel Ahossi Koua",
    "initials": "JE",
    "role": "Créateur et développeur d'ORION",
    "portfolio": "https://jeanemmanuel-portfolio-gamma.vercel.app/",
}

NAV = [
    ("Accueil", ft.Icons.HOME_ROUNDED),
    ("Journal", ft.Icons.RECEIPT_LONG_ROUNDED),
    ("Appareil", ft.Icons.LINK_ROUNDED),
    ("Réglages", ft.Icons.SETTINGS_ROUNDED),
    ("À propos", ft.Icons.INFO_ROUNDED),
]

STATUS_TEXT = {"running": "En cours", "done": "Terminé", "failed": "Échec"}


def fmt_duration(seconds: float) -> str:
    s = int(seconds)
    d, h, m = s // 86400, s % 86400 // 3600, s % 3600 // 60
    if d:
        return f"{d} j {h} h"
    if h:
        return f"{h} h {m:02d} min"
    return f"{m} min" if m else f"{s} s"


class OrionApp:
    def __init__(self, page: ft.Page, compact: bool = False):
        self.page = page
        self.compact = compact  # petit écran : mise en page resserrée
        self.prefs = Preferences.load()
        self.rt = AgentRuntime(self.refresh)
        self.rt.on_command = self._on_command
        self.nav = 0
        self.metrics: dict | None = None
        self.cpu_hist: deque[float] = deque(maxlen=60)
        self.ram_hist: deque[float] = deque(maxlen=60)
        self.orb = orbmod.ConstellationOrb(size=190 if compact else 250)
        self.p: Palette = DARK
        self._busy = False
        self.remote_state: dict | None = None
        self._installing = False
        # Champs persistants (le texte saisi survit aux rafraîchissements)
        self.f_server = ft.TextField(value=self.prefs.last_server or (self.rt.cfg.server if self.rt.cfg else ""))
        self.f_code = ft.TextField(max_length=6, input_filter=ft.NumbersOnlyInputFilter())
        self.f_name = ft.TextField(value=socket.gethostname())
        self.pair_error = ft.Text(visible=False)

    # ================================================================ éléments de base
    def txt(self, value: str, size: float = 15, weight: str = "regular", color: str | None = None, **kw) -> ft.Text:
        family = {"regular": "Inter", "medium": "InterMedium", "semibold": "InterSemiBold", "bold": "InterBold"}[weight]
        return ft.Text(value, size=size, font_family=family, color=color or self.p.text, **kw)

    def tile(self, icon: str, color: str | None = None, bg: str | None = None, size: int = 30) -> ft.Container:
        return ft.Container(
            ft.Icon(icon, size=size * 0.58, color=color or self.p.accent_text),
            width=size,
            height=size,
            border_radius=size * 0.3,
            bgcolor=bg or self.p.violet_soft,
            alignment=ft.Alignment.CENTER,
        )

    def card(self, content: ft.Control, padding: int = 18, radius: int = RADIUS["lg"], **kw) -> ft.Container:
        return ft.Container(content, bgcolor=self.p.surface, border_radius=radius, padding=padding, **kw)

    def group(self, title: str | None, rows: list[ft.Control], footer: str | None = None) -> ft.Column:
        """Liste groupée façon iOS : titre discret, rangées séparées par un filet, note en pied."""
        body: list[ft.Control] = []
        for i, r in enumerate(rows):
            if i:
                body.append(ft.Container(height=1, bgcolor=self.p.separator, margin=ft.Margin.only(left=58)))
            body.append(r)
        parts: list[ft.Control] = []
        if title:
            parts.append(ft.Container(self.txt(title, 13, "medium", self.p.text_faint), padding=ft.Padding.only(left=18, bottom=2)))
        parts.append(ft.Container(ft.Column(body, spacing=0), bgcolor=self.p.surface, border_radius=RADIUS["lg"], clip_behavior=ft.ClipBehavior.ANTI_ALIAS))
        if footer:
            parts.append(ft.Container(self.txt(footer, 12.5, color=self.p.text_faint), padding=ft.Padding.only(left=18, right=18, top=2)))
        return ft.Column(parts, spacing=6)

    def row(self, icon: str | None, title: str, subtitle: str | None = None, trailing: ft.Control | None = None,
            on_click=None, icon_color: str | None = None, icon_bg: str | None = None, title_color: str | None = None) -> ft.Container:
        texts: list[ft.Control] = [self.txt(title, 15, "medium", title_color)]
        if subtitle:
            texts.append(self.txt(subtitle, 13, color=self.p.text_muted, selectable=on_click is None))
        items: list[ft.Control] = []
        if icon:
            items.append(self.tile(icon, icon_color, icon_bg))
        items.append(ft.Column(texts, spacing=1, expand=True))
        if trailing:
            items.append(trailing)
        return ft.Container(
            ft.Row(items, spacing=14, vertical_alignment=ft.CrossAxisAlignment.CENTER),
            padding=ft.Padding.symmetric(horizontal=16, vertical=11),
            on_click=on_click,
            ink=on_click is not None,
        )

    def button(self, label: str, icon: str | None = None, on_click=None, kind: str = "primary", disabled: bool = False) -> ft.Control:
        p = self.p
        bg, fg = {
            "primary": (p.violet, p.on_violet),
            "secondary": (p.fill_strong, p.text),
            "danger": (p.danger_soft, p.danger),
        }[kind]
        return ft.FilledButton(
            content=self.txt(label, 15, "semibold", fg),
            icon=ft.Icon(icon, color=fg, size=18) if icon else None,
            on_click=on_click,
            disabled=disabled,
            style=ft.ButtonStyle(
                bgcolor=bg,
                shape=ft.RoundedRectangleBorder(radius=999),
                padding=ft.Padding.symmetric(horizontal=22, vertical=16),
                overlay_color=ft.Colors.with_opacity(0.08, fg),
                elevation=0,
            ),
            opacity=0.5 if disabled else 1,
        )

    def pill(self, label: str, color: str, bg: str) -> ft.Container:
        return ft.Container(
            ft.Row([ft.Container(width=7, height=7, border_radius=4, bgcolor=color), self.txt(label, 12.5, "semibold", color)], spacing=7, tight=True),
            bgcolor=bg,
            border_radius=999,
            padding=ft.Padding.symmetric(horizontal=11, vertical=5),
        )

    def field(self, f: ft.TextField, label: str, hint: str = "", big: bool = False) -> ft.TextField:
        p = self.p
        f.label = label
        f.hint_text = hint
        f.filled = True
        f.fill_color = p.fill
        f.border_radius = RADIUS["md"]
        f.border_color = ft.Colors.TRANSPARENT
        f.focused_border_color = p.violet
        f.color = p.text
        f.cursor_color = p.violet
        f.label_style = ft.TextStyle(color=p.text_muted, font_family="InterMedium")
        f.hint_style = ft.TextStyle(color=p.text_faint, font_family="Inter")
        f.counter = ft.Text("") if big else None
        f.text_style = (
            ft.TextStyle(size=28, letter_spacing=12, font_family="InterSemiBold", color=p.text)
            if big
            else ft.TextStyle(size=15, font_family="Inter", color=p.text)
        )
        f.text_align = ft.TextAlign.CENTER if big else ft.TextAlign.START
        return f

    # ================================================================ état → apparence
    def state_style(self) -> tuple[str, str, str]:
        """(libellé, couleur, fond) de l'état courant."""
        p, rt = self.p, self.rt
        st = rt.state
        label = LABELS.get(st, st)
        if rt.service_mode and st == "online":
            label = "Connecté (service)"
        if st == "online":
            return label, p.online, p.online_soft
        if st in ("connecting", "offline"):
            return label, p.warning, p.warning_soft
        if st == "revoked":
            return label, p.danger, p.danger_soft
        return label, p.text_muted, p.fill

    def sync_orb(self) -> None:
        st, rt = self.rt.state, self.rt
        if st == "online":
            mode, colors = (orbmod.ACTIVE if rt.activity else orbmod.IDLE), ORB["orion"]
        elif st in ("connecting", "offline"):
            mode, colors = orbmod.CONNECTING, ORB["aurore"]
        elif st == "revoked":
            mode, colors = orbmod.STOPPED, ORB["braise"]
        else:
            mode, colors = orbmod.STOPPED, ORB["glace"]
        self.orb.set_state(mode, colors, self.p.dark)

    def _on_command(self, entry: dict) -> None:
        self.orb.pulse(0.7 if entry["status"] == "running" else 0.3)

    # ================================================================ construction
    def resolve_palette(self) -> Palette:
        theme = self.prefs.theme
        if theme == "system":
            return LIGHT if self.page.platform_brightness == ft.Brightness.LIGHT else DARK
        return LIGHT if theme == "light" else DARK

    def build(self) -> None:
        """(Re)construit toute la fenêtre — au lancement et au changement de thème."""
        self.p = p = self.resolve_palette()
        page = self.page
        page.bgcolor = p.bg
        page.theme_mode = ft.ThemeMode.DARK if p.dark else ft.ThemeMode.LIGHT
        page.window.bgcolor = p.bg
        for f in (self.f_server, self.f_code, self.f_name):
            f.label = None
        self.field(self.f_server, "Adresse du Core", "https://orion-core.onrender.com")
        self.field(self.f_code, "Code à 6 chiffres", "000000", big=True)
        self.field(self.f_name, "Nom affiché dans l'app")
        self.pair_error.color = p.danger
        self.pair_error.font_family = "InterMedium"
        self.pair_error.size = 13

        k = self.compact
        self.sidebar = ft.Container(width=210 if k else 232, padding=ft.Padding.only(left=14, right=10, top=18 if k else 22, bottom=14))
        self.content = ft.Container(expand=True, padding=ft.Padding.only(left=8, right=22 if k else 28, top=18 if k else 26, bottom=0))
        page.controls = [ft.Row([self.sidebar, self.content], spacing=0, expand=True, vertical_alignment=ft.CrossAxisAlignment.STRETCH)]
        self.render()

    def build_sidebar(self) -> ft.Control:
        p = self.p
        items: list[ft.Control] = []
        for i, (label, icon) in enumerate(NAV):
            sel = i == self.nav
            items.append(
                ft.Container(
                    ft.Row(
                        [ft.Icon(icon, size=20, color=p.accent_text if sel else p.text_muted), self.txt(label, 15, "semibold" if sel else "medium", p.text if sel else p.text_muted)],
                        spacing=12,
                    ),
                    bgcolor=p.violet_soft if sel else None,
                    border_radius=RADIUS["md"],
                    padding=ft.Padding.symmetric(horizontal=14, vertical=9 if self.compact else 11),
                    on_click=lambda _e, i=i: self.go(i),
                    ink=True,
                )
            )
        label, color, bg = self.state_style()
        name = self.rt.cfg.name if self.rt.cfg else socket.gethostname()
        return ft.Column(
            [
                ft.Row([orbmod.logo(p, 30), ft.Column([self.txt("ORION", 19, "bold"), self.txt("Agent PC", 12, "medium", p.text_faint)], spacing=0)], spacing=12),
                ft.Container(height=18),
                *items,
                ft.Container(expand=True),
                ft.Container(
                    ft.Column([self.txt(name, 13.5, "semibold", max_lines=1, overflow=ft.TextOverflow.ELLIPSIS), self.pill(label, color, bg)], spacing=8),
                    bgcolor=p.surface,
                    border_radius=RADIUS["lg"],
                    padding=14,
                ),
            ],
            spacing=4,
            horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
        )

    def go(self, i: int) -> None:
        self.nav = i
        self.render()

    def render(self) -> None:
        """Reconstruit la barre latérale et la page affichée à partir de l'état courant."""
        self.sync_orb()
        self.sidebar.content = self.build_sidebar()
        builders = [self.page_home, self.page_log, self.page_device, self.page_settings, self.page_about]
        title, body = builders[self.nav]()
        self.content.content = ft.Column(
            [self.txt(title, 28 if self.compact else 34, "bold", style=ft.TextStyle(letter_spacing=-1.0)), *body, ft.Container(height=20)],
            spacing=14 if self.compact else 18,
            scroll=ft.ScrollMode.AUTO,
            horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
        )
        if self.nav == 0:
            self.orb.start()
        else:
            self.orb.stop()
        self.page.update()

    def refresh(self) -> None:
        """Rappel du runtime : l'état a changé."""
        with contextlib.suppress(RuntimeError, AssertionError):
            self.render()

    # ================================================================ Accueil
    def page_home(self) -> tuple[str, list[ft.Control]]:
        p, rt = self.p, self.rt
        label, color, bg = self.state_style()
        if not rt.cfg:
            info = [
                self.txt("Ce PC n'est pas encore associé", 22, "bold"),
                self.txt("Associe-le à ton compte avec le code à 6 chiffres affiché dans l'app ORION (Appareils → Associer un PC).", 15, color=p.text_muted),
                ft.Row([self.button("Associer ce PC", ft.Icons.LINK_ROUNDED, lambda _e: self.go(2))]),
            ]
        else:
            if rt.service_mode:
                sub = "L'agent tourne en arrière-plan (service systemd). Arrête-le pour le piloter depuis cette fenêtre."
                actions = [self.button("Arrêter le service", ft.Icons.STOP_ROUNDED, self.on_service_stop, "secondary")]
            elif rt.running:
                sub = rt.detail or ("Connecté depuis " + rt.since.strftime("%H:%M") if rt.since else "Connexion au Core…")
                actions = [self.button("Arrêter l'agent", ft.Icons.STOP_ROUNDED, self.on_stop, "secondary")]
            else:
                sub = rt.detail or "L'app ne peut pas joindre ce PC tant que l'agent est arrêté."
                actions = [self.button("Démarrer l'agent", ft.Icons.PLAY_ARROW_ROUNDED, self.on_start, disabled=rt.state == "revoked")]
            if rt.state == "revoked":
                actions.append(self.button("Réassocier", ft.Icons.LINK_ROUNDED, lambda _e: self.go(2), "secondary"))
            info = [
                self.pill(label, color, bg),
                self.txt(rt.cfg.name, 26, "bold", style=ft.TextStyle(letter_spacing=-0.6)),
                self.txt(sub, 14.5, color=p.text_muted),
                ft.Row(
                    [ft.Icon(ft.Icons.CLOUD_ROUNDED, size=16, color=p.text_faint), self.txt(rt.cfg.server, 13, color=p.text_faint, max_lines=1, overflow=ft.TextOverflow.ELLIPSIS, expand=True)],
                    spacing=6,
                ),
                ft.Container(height=4),
                ft.Row(actions, spacing=10, wrap=True),
            ]
        hero = ft.Container(
            ft.Row(
                [self.orb.control, ft.Column(info, spacing=10, expand=True, alignment=ft.MainAxisAlignment.CENTER)],
                spacing=22,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            bgcolor=p.surface,
            border_radius=RADIUS["xl"],
            padding=ft.Padding.only(left=10, right=26, top=10, bottom=10),
        )
        self.metric_row = ft.ResponsiveRow(self.metric_cards(), spacing=14, run_spacing=14)
        recent = list(rt.log)[:4]
        body: list[ft.Control] = [hero, self.section("Ce PC", self.uptime_text()), self.metric_row]
        if recent:
            body.append(self.group("Dernières commandes", [self.log_row(e) for e in recent]))
        return ("Bonjour" if not rt.cfg else "Accueil"), body

    def section(self, title: str, extra: str | None = None) -> ft.Control:
        items = [self.txt(title, 20, "bold", style=ft.TextStyle(letter_spacing=-0.4))]
        if extra:
            items.append(self.txt(extra, 13, color=self.p.text_faint))
        return ft.Row(items, spacing=10, vertical_alignment=ft.CrossAxisAlignment.END)

    def uptime_text(self) -> str:
        m = self.metrics
        up = f" · allumé depuis {fmt_duration(m['uptimeS'])}" if m else ""
        return f"{osmod.os_version()}{up}"

    def sparkline(self, values: deque[float], color: str, w: int = 180, h: int = 34) -> ft.Control:
        """Historique (2 min) qui se remplit par la droite, à l'échelle 0–100 %."""
        if len(values) < 2:
            return ft.Container(height=h)
        cap = values.maxlen or len(values)
        off = cap - len(values)
        pts = [((off + i) * w / (cap - 1), h - 2 - (v / 100) * (h - 4)) for i, v in enumerate(values)]
        fill = [*pts, (w, h), (pts[0][0], h)]
        return cv.Canvas(
            shapes=[
                cv.Points(fill, point_mode=cv.PointMode.POLYGON, paint=ft.Paint(color=ft.Colors.with_opacity(0.14, color), style=ft.PaintingStyle.FILL)),
                cv.Points(pts, point_mode=cv.PointMode.POLYGON, paint=ft.Paint(color=color, stroke_width=1.8, stroke_join=ft.StrokeJoin.ROUND, style=ft.PaintingStyle.STROKE)),
            ],
            width=w,
            height=h,
        )

    def metric_card(self, icon: str, label: str, value: str, sub: str, pct: float | None = None,
                    spark: deque[float] | None = None, bar_color: str | None = None) -> ft.Container:
        p = self.p
        if spark is not None:
            zone: ft.Control = self.sparkline(spark, p.accent_text)
        elif pct is not None:
            color = bar_color or (p.danger if pct >= 90 else p.warning if pct >= 75 else p.violet)
            zone = ft.ProgressBar(value=max(0, min(1, pct / 100)), bar_height=6, border_radius=3, color=color, bgcolor=p.fill_strong)
        else:
            zone = ft.Container()
        items: list[ft.Control] = [
            ft.Row([self.tile(icon, size=28), self.txt(label, 14, "semibold", p.text_muted)], spacing=10),
            self.txt(value, 30, "bold", style=ft.TextStyle(letter_spacing=-0.8)),
            # Zone graphique de hauteur fixe : toutes les cartes ont la même taille.
            ft.Container(zone, height=34, alignment=ft.Alignment.CENTER_LEFT, clip_behavior=ft.ClipBehavior.HARD_EDGE),
            self.txt(sub, 12.5, color=p.text_faint, max_lines=1, overflow=ft.TextOverflow.ELLIPSIS),
        ]
        return self.card(ft.Column(items, spacing=8), col={"xs": 6, "lg": 3})

    def metric_cards(self) -> list[ft.Control]:
        m = self.metrics
        if not m:
            return [self.metric_card(i, label, "—", "Mesure…") for i, label in (
                (ft.Icons.SPEED_ROUNDED, "Processeur"), (ft.Icons.MEMORY_ROUNDED, "Mémoire"),
                (ft.Icons.STORAGE_ROUNDED, "Disque"), (ft.Icons.BATTERY_FULL_ROUNDED, "Batterie"))]
        p, b = self.p, m.get("battery")
        cores = psutil.cpu_count() or 0
        cards = [
            self.metric_card(ft.Icons.SPEED_ROUNDED, "Processeur", f"{m['cpu']} %", f"{cores} cœurs logiques", spark=self.cpu_hist),
            self.metric_card(ft.Icons.MEMORY_ROUNDED, "Mémoire", f"{m['ram']} %", f"{m['ramUsedGb']} / {m['ramTotalGb']} Go", spark=self.ram_hist),
            self.metric_card(ft.Icons.STORAGE_ROUNDED, "Disque", f"{m['disk']} %", f"{m['diskFreeGb']} Go libres", pct=m["disk"]),
        ]
        if b:
            icon = ft.Icons.BATTERY_CHARGING_FULL_ROUNDED if b["charging"] else ft.Icons.BATTERY_FULL_ROUNDED
            color = p.online if b["charging"] or b["percent"] > 25 else p.warning if b["percent"] > 12 else p.danger
            cards.append(self.metric_card(icon, "Batterie", f"{b['percent']} %", "En charge" if b["charging"] else "Sur batterie", pct=b["percent"], bar_color=color))
        else:
            cards.append(self.metric_card(ft.Icons.POWER_ROUNDED, "Alimentation", "Secteur", "Pas de batterie détectée"))
        return cards

    async def metrics_loop(self) -> None:
        psutil.cpu_percent(interval=None)
        while True:
            await asyncio.sleep(2)
            try:
                self.metrics = await asyncio.to_thread(system.metrics)
            except (OSError, RuntimeError, ValueError):
                log.debug("Métriques indisponibles", exc_info=True)
                continue
            self.cpu_hist.append(self.metrics["cpu"])
            self.ram_hist.append(self.metrics["ram"])
            if self.nav == 0:
                with contextlib.suppress(RuntimeError, AssertionError, AttributeError):
                    self.metric_row.controls = self.metric_cards()
                    self.metric_row.update()

    # ================================================================ Journal
    def log_row(self, e: dict) -> ft.Control:
        p = self.p
        label, icon = ACTIONS.get(e["action"], (e["action"], ft.Icons.BOLT_ROUNDED))
        status = e.get("status") or "running"
        color, bg = {"running": (p.warning, p.warning_soft), "done": (p.online, p.online_soft), "failed": (p.danger, p.danger_soft)}.get(status, (p.text_muted, p.fill))
        t: datetime = e["time"]
        when = t.strftime("%H:%M:%S") if t.date() == datetime.now().date() else t.strftime("%d/%m %H:%M")
        sub = f"{when} · {e['error']}" if status == "failed" and e.get("error") else when
        return self.row(icon, label, sub, self.pill(STATUS_TEXT.get(status, status), color, bg))

    def page_log(self) -> tuple[str, list[ft.Control]]:
        p, rt = self.p, self.rt
        entries = list(rt.log)
        head = ft.Row(
            [
                self.txt(
                    "Commandes reçues du téléphone" + (" (lues dans le journal du service)" if rt.service_mode else " depuis l'ouverture de la fenêtre"),
                    14, color=p.text_muted, expand=True,
                ),
                self.button("Effacer", ft.Icons.DELETE_SWEEP_ROUNDED, self.on_clear_log, "secondary", disabled=not entries or rt.service_mode),
            ]
        )
        if not entries:
            empty = self.card(
                ft.Column(
                    [
                        self.tile(ft.Icons.INBOX_ROUNDED, size=44),
                        self.txt("Aucune commande pour l'instant", 17, "semibold"),
                        self.txt("Elles s'afficheront ici dès que l'app enverra une action à ce PC.", 14, color=p.text_muted, text_align=ft.TextAlign.CENTER),
                    ],
                    horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                    spacing=10,
                ),
                padding=36,
            )
            return "Journal", [head, empty]
        return "Journal", [head, self.group(None, [self.log_row(e) for e in entries])]

    def on_clear_log(self, _e) -> None:
        self.rt.log.clear()
        self.render()

    # ================================================================ Appareil
    def page_device(self) -> tuple[str, list[ft.Control]]:
        p, cfg = self.p, self.rt.cfg
        if cfg:
            rows = [
                self.row(ft.Icons.COMPUTER_ROUNDED, "Nom dans l'app", cfg.name, self.edit_button(lambda _e: self.edit_device("name")), on_click=lambda _e: self.edit_device("name")),
                self.row(ft.Icons.CLOUD_ROUNDED, "Adresse du Core", cfg.server, self.edit_button(lambda _e: self.edit_device("server")), on_click=lambda _e: self.edit_device("server")),
                self.row(ft.Icons.FINGERPRINT_ROUNDED, "Identifiant de l'appareil", cfg.device_id),
                self.row(ft.Icons.DEVELOPER_BOARD_ROUNDED, "Système", f"{osmod.os_version()} · {socket.gethostname()}"),
            ]
            danger = self.group(
                None,
                [self.row(ft.Icons.LINK_OFF_ROUNDED, "Dissocier ce PC", None, None, self.on_unpair, p.danger, p.danger_soft, p.danger)],
                "Le jeton est effacé de ce PC. Pense aussi à retirer l'appareil dans l'app (Appareils).",
            )
            state = self.group(
                "Association",
                rows,
                f"Le nom s'affiche aussi dans l'app mobile. Change l'adresse si l'IP du Core a changé : elle est vérifiée avant d'être enregistrée. Jeton dans {CONFIG_FILE}, lisible par toi seul.",
            )
            return "Appareil", [state, danger]

        steps = self.group(
            "Comment faire",
            [
                self.row(ft.Icons.SMARTPHONE_ROUNDED, "1. Dans l'app ORION", "Appareils → Associer un PC : un code à 6 chiffres s'affiche (valable 10 min)."),
                self.row(ft.Icons.DNS_ROUNDED, "2. Ici", "Saisis l'adresse du Core et ce code, puis « Associer »."),
            ],
        )
        form = self.card(
            ft.Column(
                [
                    self.f_server,
                    self.f_code,
                    self.f_name,
                    self.pair_error,
                    ft.Row([self.button("Associer ce PC", ft.Icons.LINK_ROUNDED, self.on_pair, disabled=self._busy)]),
                ],
                spacing=14,
                horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
            ),
            padding=22,
            radius=RADIUS["xl"],
            width=520,
        )
        return "Associer ce PC", [steps, ft.Row([form])]

    def edit_button(self, on_click) -> ft.Control:
        p = self.p
        return ft.Container(
            ft.Row([ft.Icon(ft.Icons.EDIT_ROUNDED, size=15, color=p.accent_text), self.txt("Modifier", 13.5, "semibold", p.accent_text)], spacing=6, tight=True),
            bgcolor=p.violet_soft,
            border_radius=999,
            padding=ft.Padding.symmetric(horizontal=12, vertical=7),
            on_click=on_click,
            ink=True,
        )

    def edit_device(self, key: str) -> None:
        """Fenêtre de modification du nom ou de l'adresse du Core, validée par le Core."""
        p, cfg = self.p, self.rt.cfg
        if not cfg:
            return
        is_name = key == "name"
        field = self.field(
            ft.TextField(value=cfg.name if is_name else cfg.server, autofocus=True, max_length=60 if is_name else None),
            "Nom affiché dans l'app" if is_name else "Adresse du Core",
            "Bureau, PC portable…" if is_name else "http://192.168.1.20:3001",
        )
        error = ft.Text("", color=p.danger, size=13, font_family="InterMedium", visible=False)
        save_btn = self.button("Enregistrer", ft.Icons.CHECK_ROUNDED, None)

        async def save(_e=None) -> None:
            value = (field.value or "").strip()
            unchanged = value == (cfg.name if is_name else cfg.server)
            if unchanged:
                self.page.pop_dialog()
                return
            save_btn.disabled, error.visible = True, False
            self.page.update()
            try:
                updated = await update_device(cfg, name=value if is_name else None, server=None if is_name else value)
            except PairingError as err:
                error.value, error.visible, save_btn.disabled = str(err), True, False
                self.page.update()
                return
            self.page.pop_dialog()
            await self.rt.reconfigure(updated)
            if not is_name:
                self.prefs.last_server = updated.server
                self.prefs.save()
            self.toast(f"Nom mis à jour : « {updated.name} »." if is_name else "Adresse du Core mise à jour, reconnexion…")

        save_btn.on_click = save
        field.on_submit = save
        self.page.show_dialog(
            ft.AlertDialog(
                title=self.txt("Renommer ce PC" if is_name else "Adresse du Core", 20, "bold"),
                content=ft.Container(
                    ft.Column(
                        [
                            self.txt(
                                "Le nouveau nom apparaît aussitôt dans l'app ORION." if is_name
                                else "Utile si l'adresse IP du serveur a changé. ORION vérifie que ce Core reconnaît bien ce PC.",
                                14, color=p.text_muted,
                            ),
                            field,
                            error,
                        ],
                        spacing=14,
                        tight=True,
                        horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
                    ),
                    width=420,
                ),
                bgcolor=p.surface_raised,
                shape=ft.RoundedRectangleBorder(radius=RADIUS["xl"]),
                actions=[self.button("Annuler", None, lambda _e: self.page.pop_dialog(), "secondary"), save_btn],
            )
        )

    async def on_pair(self, _e) -> None:
        server, code = normalize_server(self.f_server.value or ""), (self.f_code.value or "").strip()
        error = None
        if not server:
            error = "Indique l'adresse du Core."
        elif len(code) != 6 or not code.isdigit():
            error = "Le code doit comporter 6 chiffres."
        if error:
            self.show_pair_error(error)
            return
        self._busy = True
        self.show_pair_error(None)
        try:
            cfg = await pair_async(server, code, self.f_name.value)
        except PairingError as err:
            self._busy = False
            self.show_pair_error(str(err))
            return
        self._busy = False
        self.prefs.last_server = server
        self.prefs.save()
        self.f_code.value = ""
        self.rt.paired(cfg)
        self.toast(f"« {cfg.name} » est associé à ton compte ORION.")
        self.go(0)
        self.rt.start()

    def show_pair_error(self, msg: str | None) -> None:
        self.pair_error.value = msg or ""
        self.pair_error.visible = bool(msg)
        self.render()

    def on_unpair(self, _e) -> None:
        p = self.p

        async def confirm(_e) -> None:
            self.page.pop_dialog()
            await self.rt.unpair()
            self.toast("Association supprimée sur ce PC.")

        self.page.show_dialog(
            ft.AlertDialog(
                title=self.txt("Dissocier ce PC ?", 20, "bold"),
                content=self.txt("L'agent s'arrête et ce PC ne sera plus joignable depuis l'app jusqu'à un nouvel appairage.", 15, color=p.text_muted),
                bgcolor=p.surface_raised,
                shape=ft.RoundedRectangleBorder(radius=RADIUS["xl"]),
                actions=[
                    self.button("Annuler", None, lambda _e: self.page.pop_dialog(), "secondary"),
                    self.button("Dissocier", ft.Icons.LINK_OFF_ROUNDED, confirm, "danger"),
                ],
            )
        )

    # ================================================================ Réglages
    def page_settings(self) -> tuple[str, list[ft.Control]]:
        body: list[ft.Control] = [self.group("Apparence", [self.row(ft.Icons.DARK_MODE_ROUNDED, "Thème", None, self.theme_picker())])]

        svc = self.rt.service
        if service.supported():
            if svc["active"]:
                svc_sub, svc_btn = "Actif en arrière-plan", self.button("Arrêter", None, self.on_service_stop, "secondary")
            else:
                svc_sub = "Inactif" + (" (installé)" if svc["installed"] else "")
                svc_btn = self.button("Démarrer", None, self.on_service_start, "secondary", disabled=not svc["installed"] or not self.rt.cfg)
            body.append(
                self.group(
                    "Démarrage",
                    [
                        self.row(ft.Icons.ROCKET_LAUNCH_ROUNDED, "Lancer au démarrage", "Service systemd utilisateur orion-agent",
                                 self.switch(svc["enabled"], self.on_autostart, disabled=not self.rt.cfg)),
                        self.row(ft.Icons.POWER_SETTINGS_NEW_ROUNDED, "Service en arrière-plan", svc_sub, svc_btn),
                    ],
                    "Le service garde ORION joignable même fenêtre fermée. Pendant qu'il tourne, cette fenêtre le suit sans ouvrir de seconde connexion.",
                )
            )
        else:
            body.append(self.group("Démarrage", [self.row(ft.Icons.ROCKET_LAUNCH_ROUNDED, "Lancer au démarrage", "Disponible sur Linux (systemd) pour l'instant.")]))

        body.append(self.remote_group())

        disabled = set(self.prefs.disabled_actions)
        perms = [
            self.row(icon, label, None, self.switch(not any(a in disabled for a in actions), lambda e, a=actions: self.on_permission(a, e.control.value)))
            for _key, label, icon, actions in PERMISSIONS
        ]
        body.append(self.group("Autorisations", perms, "Une action désactivée est refusée par ce PC, même si l'app la demande. Le statut reste toujours disponible."))

        return "Réglages", body

    # ================================================================ À propos
    def page_about(self) -> tuple[str, list[ft.Control]]:
        p = self.p
        avatar = ft.Container(
            self.txt(CREATOR["initials"], 30, "bold", p.on_violet),
            width=84,
            height=84,
            border_radius=42,
            alignment=ft.Alignment.CENTER,
            gradient=ft.LinearGradient(begin=ft.Alignment.TOP_LEFT, end=ft.Alignment.BOTTOM_RIGHT, colors=["#b85cff", p.violet]),
        )
        creator = ft.Container(
            ft.Row(
                [
                    avatar,
                    ft.Column(
                        [
                            self.txt("Créateur", 12.5, "semibold", p.accent_text),
                            self.txt(CREATOR["name"], 22, "bold", style=ft.TextStyle(letter_spacing=-0.5)),
                            self.txt(CREATOR["role"], 14, color=p.text_muted),
                            ft.Container(height=6),
                            ft.Row(
                                [
                                    self.button("Voir mon portfolio", ft.Icons.OPEN_IN_NEW_ROUNDED, self.on_portfolio),
                                    self.txt(CREATOR["portfolio"].removeprefix("https://").rstrip("/"), 13, color=p.text_faint, selectable=True),
                                ],
                                spacing=14,
                                wrap=True,
                                vertical_alignment=ft.CrossAxisAlignment.CENTER,
                            ),
                        ],
                        spacing=3,
                        expand=True,
                    ),
                ],
                spacing=22,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            bgcolor=p.surface,
            border_radius=RADIUS["xl"],
            padding=24,
        )
        project = self.group(
            "Le projet",
            [
                self.row(ft.Icons.AUTO_AWESOME_ROUNDED, "ORION", "Assistant multi-appareils : depuis le téléphone, ORION pilote tes PC Linux, macOS et Windows."),
                self.row(ft.Icons.INFO_ROUNDED, "Agent PC", f"Version {__version__} · {osmod.os_version()}"),
                self.row(ft.Icons.BADGE_ROUNDED, "Configuration", str(CONFIG_FILE.parent)),
            ],
        )
        return "À propos", [creator, project]

    async def on_portfolio(self, _e) -> None:
        await ft.UrlLauncher().launch_url(CREATOR["portfolio"])

    def remote_group(self) -> ft.Control:
        """État de l'écran en direct / contrôle à distance sur ce PC, avec l'installation de ce qui manque."""
        p, st = self.p, self.remote_state
        if st is None:
            row = self.row(ft.Icons.CONNECTED_TV_ROUNDED, "Écran en direct et contrôle", "Vérification…")
        elif st["available"]:
            row = self.row(ft.Icons.CONNECTED_TV_ROUNDED, "Écran en direct et contrôle", "Prêt : le téléphone peut voir et piloter ce PC.",
                           self.pill("Prêt", p.online, p.online_soft))
        elif st["permissions"]:
            row = self.row(ft.Icons.CONNECTED_TV_ROUNDED, "Autorisations macOS à donner",
                           "Réglages système > Confidentialité et sécurité > " + " et ".join(st["permissions"]) + " : coche ORION Agent.",
                           self.pill("À faire", p.warning, p.warning_soft))
        else:
            trailing = self.button("Installer", ft.Icons.DOWNLOAD_ROUNDED, self.on_install_remote, disabled=self._installing) if st["canInstall"] else None
            row = self.row(ft.Icons.CONNECTED_TV_ROUNDED, "Composants manquants", ", ".join(st["missing"]), trailing)
        return self.group("Écran en direct", [row], "ORION installe lui-même ce qu'il faut selon ton système. Sous Linux, ton mot de passe administrateur est demandé une fois.")

    async def refresh_remote_state(self) -> None:
        from ..services import requirements

        self.remote_state = await asyncio.to_thread(requirements.remote_status)
        self.render()

    async def on_install_remote(self, _e=None) -> None:
        from ..services import requirements

        self._installing = True
        self.render()
        self.toast("Installation des composants… valide la demande d'administration qui s'affiche.")
        ok, msg = await asyncio.to_thread(requirements.install, True)
        self._installing = False
        self.toast(msg, error=not ok)
        await self.refresh_remote_state()

    async def offer_remote_setup(self) -> None:
        """Premier lancement : si des composants manquent, proposer de les installer tout de suite."""
        await self.refresh_remote_state()
        st = self.remote_state
        if not st or st["available"] or self.prefs.remote_setup_dismissed:
            return
        p = self.p

        async def install(_e) -> None:
            self.page.pop_dialog()
            await self.on_install_remote()

        def later(_e) -> None:
            self.prefs.remote_setup_dismissed = True
            self.prefs.save()
            self.page.pop_dialog()

        detail = (
            "Pour voir et contrôler ce PC depuis le téléphone, ORION a besoin de : " + ", ".join(st["missing"]) + "."
            if st["missing"]
            else "macOS demande deux autorisations : " + " et ".join(st["permissions"]) + " (Réglages système > Confidentialité et sécurité)."
        )
        actions = [self.button("Plus tard", None, later, "secondary")]
        if st["canInstall"]:
            actions.append(self.button("Installer maintenant", ft.Icons.DOWNLOAD_ROUNDED, install))
        self.page.show_dialog(
            ft.AlertDialog(
                title=self.txt("Préparer l'écran en direct", 20, "bold"),
                content=ft.Container(self.txt(detail, 15, color=p.text_muted), width=440),
                bgcolor=p.surface_raised,
                shape=ft.RoundedRectangleBorder(radius=RADIUS["xl"]),
                actions=actions,
            )
        )

    def switch(self, value: bool, on_change, disabled: bool = False) -> ft.Control:
        return ft.CupertinoSwitch(value=value, on_change=on_change, disabled=disabled, active_track_color=self.p.violet, inactive_track_color=self.p.fill_strong)

    def theme_picker(self) -> ft.Control:
        p = self.p
        opts = [("dark", "Sombre"), ("light", "Clair"), ("system", "Système")]
        segs = [
            ft.Container(
                self.txt(label, 13.5, "semibold" if key == self.prefs.theme else "medium", p.text if key == self.prefs.theme else p.text_muted),
                bgcolor=p.surface_raised if key == self.prefs.theme else None,
                shadow=ft.BoxShadow(blur_radius=6, color=ft.Colors.with_opacity(0.18, "#000000")) if key == self.prefs.theme else None,
                border_radius=999,
                padding=ft.Padding.symmetric(horizontal=14, vertical=7),
                on_click=lambda _e, k=key: self.set_theme(k),
            )
            for key, label in opts
        ]
        return ft.Container(ft.Row(segs, spacing=2, tight=True), bgcolor=p.fill_strong, border_radius=999, padding=3)

    def set_theme(self, key: str) -> None:
        self.prefs.theme = key
        self.prefs.save()
        self.build()

    def on_permission(self, actions: tuple[str, ...], allowed: bool) -> None:
        disabled = [a for a in self.prefs.disabled_actions if a not in actions]
        if not allowed:
            disabled += list(actions)
        self.prefs.disabled_actions = disabled
        self.prefs.save()

    # ================================================================ commandes
    async def on_start(self, _e) -> None:
        self.rt.start()

    async def on_stop(self, _e) -> None:
        await self.rt.stop()

    async def on_service_start(self, _e) -> None:
        await self.rt.stop()  # une seule connexion à la fois
        await self.service_call(service.start, "Service démarré.")

    async def on_service_stop(self, _e) -> None:
        await self.service_call(service.stop, "Service arrêté.")

    async def on_autostart(self, e) -> None:
        if e.control.value:
            await self.rt.stop()
            await self.service_call(service.enable, "ORION se lancera au démarrage de la session.")
        else:
            await self.service_call(service.disable, "Lancement au démarrage désactivé.")

    async def service_call(self, fn, ok: str) -> None:
        try:
            await asyncio.to_thread(fn)
            self.toast(ok)
        except (RuntimeError, OSError) as err:
            self.toast(f"systemd : {err}", error=True)
        await self.rt.refresh_service()

    async def service_loop(self) -> None:
        while True:
            with contextlib.suppress(Exception):
                await self.rt.refresh_service()
            await asyncio.sleep(4)

    def toast(self, msg: str, error: bool = False) -> None:
        p = self.p
        self.page.show_dialog(
            ft.SnackBar(
                self.txt(msg, 14, "medium", p.danger if error else p.text),
                bgcolor=p.surface_raised,
                behavior=ft.SnackBarBehavior.FLOATING,
                shape=ft.RoundedRectangleBorder(radius=RADIUS["md"]),
                width=440,
            )
        )

    async def on_window(self, e: ft.WindowEvent) -> None:
        if e.type == ft.WindowEventType.CLOSE:
            self.orb.stop()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self.rt.stop(), 4)
            await self.page.window.destroy()


async def main(page: ft.Page) -> None:
    page.title = "ORION — Agent PC"
    page.fonts = FONTS
    page.theme = ft.Theme(font_family="Inter", color_scheme_seed="#9810e6")
    page.dark_theme = ft.Theme(font_family="Inter", color_scheme_seed="#9810e6")
    page.padding = 0
    area = await asyncio.to_thread(screen.workarea)
    page.window.width, page.window.height = screen.window_size(area)
    page.window.min_width, page.window.min_height = 820, 560
    page.window.prevent_close = True
    await page.window.center()

    app = OrionApp(page, compact=bool(area and area[1] < 1000))
    page.data = app
    page.window.on_event = app.on_window
    page.on_platform_brightness_change = lambda _e: app.build() if app.prefs.theme == "system" else None
    app.build()
    # Ouverture : la même animation que l'app mobile (ceinture d'Orion → logo).
    splash = Splash(app.p.dark)
    page.overlay.append(splash.control)
    page.update()

    async def intro() -> None:
        try:
            await splash.play()
        finally:
            with contextlib.suppress(ValueError):
                page.overlay.remove(splash.control)
            page.update()

    page.run_task(intro)

    async def setup_after_intro() -> None:
        await asyncio.sleep(3)
        await app.offer_remote_setup()

    page.run_task(setup_after_intro)
    page.run_task(app.metrics_loop)
    page.run_task(app.service_loop)
    if app.rt.cfg:
        await app.rt.refresh_service()
        if not app.rt.service.get("active"):
            app.rt.start()  # comme « orion-agent run », sauf si le service tourne déjà
