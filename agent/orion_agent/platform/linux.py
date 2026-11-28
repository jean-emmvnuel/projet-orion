"""Linux (GNOME/KDE, Wayland ou X11). Repris et durci depuis Bot/services."""

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

name = "linux"


def os_version() -> str:
    try:
        for line in Path("/etc/os-release").read_text().splitlines():
            if line.startswith("PRETTY_NAME="):
                return line.split("=", 1)[1].strip('"')
    except OSError:
        pass
    return "Linux"


def desktop_env() -> dict:
    """Variables de la session graphique (indispensables quand l'agent tourne en service systemd)."""
    env = os.environ.copy()
    run = f"/run/user/{os.getuid()}"
    env.setdefault("XDG_RUNTIME_DIR", run)
    if not env.get("DBUS_SESSION_BUS_ADDRESS") and os.path.exists(f"{run}/bus"):
        env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={run}/bus"
    if not env.get("WAYLAND_DISPLAY") and os.path.exists(f"{run}/wayland-0"):
        env["WAYLAND_DISPLAY"] = "wayland-0"
    env.setdefault("DISPLAY", ":0")
    return env


def _run(cmd: list[str], timeout: float = 5) -> bool:
    try:
        return subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, env=desktop_env()).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


_PORTAL_SCRIPT = r"""
import sys
from urllib.parse import unquote, urlparse
try:
    import dbus, dbus.mainloop.glib
    from gi.repository import GLib
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus(); loop = GLib.MainLoop(); out = []
    def on_response(code, results, object_path=None):
        if code == 0 and 'uri' in results:
            out.append(unquote(urlparse(str(results['uri'])).path))
        loop.quit()
    bus.add_signal_receiver(on_response, signal_name='Response', dbus_interface='org.freedesktop.portal.Request',
                            bus_name='org.freedesktop.portal.Desktop', path_keyword='object_path')
    proxy = bus.get_object('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')
    dbus.Interface(proxy, 'org.freedesktop.portal.Screenshot').Screenshot('', {'interactive': False})
    GLib.timeout_add_seconds(6, loop.quit); loop.run()
    if out: print(out[0]); sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(2)
"""


# Identité fixe de l'agent auprès du portail XDG : sans elle, GNOME identifie l'app d'après le
# terminal ou le service qui l'a lancée, et redemande l'autorisation de capture à chaque changement.
APP_ID = "io.orion.Agent"
_permission_ready = False


def ensure_screenshot_permission() -> None:
    """Autorise une fois pour toutes la capture silencieuse pour io.orion.Agent (magasin de permissions GNOME)."""
    global _permission_ready
    if _permission_ready:
        return
    _permission_ready = _run(
        [
            "gdbus", "call", "--session",
            "--dest", "org.freedesktop.impl.portal.PermissionStore",
            "--object-path", "/org/freedesktop/impl/portal/PermissionStore",
            "--method", "org.freedesktop.impl.portal.PermissionStore.SetPermission",
            "screenshot", "true", "screenshot", APP_ID, "['yes']",
        ]
    )


def _portal_command(py: str) -> list[str]:
    """Lance l'assistant du portail dans une « scope » systemd nommée d'après APP_ID."""
    if shutil.which("systemd-run"):
        unit = f"app-{APP_ID}-{os.getpid()}-{int(time.time() * 1000)}.scope"
        return ["systemd-run", "--user", "--scope", "--quiet", f"--unit={unit}", py, "-c", _PORTAL_SCRIPT]
    return [py, "-c", _PORTAL_SCRIPT]


def capture_screen(dest: Path) -> None:
    """Capture silencieuse, sans fenêtre de confirmation : portail XDG (GNOME Wayland), puis grim, puis X11."""
    py = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable
    ensure_screenshot_permission()
    try:
        res = subprocess.run(_portal_command(py), check=False, capture_output=True, text=True, timeout=8, env=desktop_env())
        src = Path(res.stdout.strip().splitlines()[-1]) if res.returncode == 0 and res.stdout.strip() else None
        if src and src.exists() and src.stat().st_size > 0:
            shutil.move(str(src), dest)
            return
    except (OSError, subprocess.SubprocessError):
        pass
    for cmd in (["grim", str(dest)], ["gnome-screenshot", "-f", str(dest)], ["spectacle", "-b", "-n", "-o", str(dest)], ["scrot", str(dest)], ["import", "-window", "root", str(dest)]):
        if shutil.which(cmd[0]) and _run(cmd, 8) and dest.exists() and dest.stat().st_size > 0:
            return
    raise RuntimeError("Aucune session graphique compatible pour la capture d'écran.")


def lock() -> None:
    if _run(["loginctl", "lock-session"]):
        return
    if _run(["gdbus", "call", "--session", "--dest", "org.gnome.ScreenSaver", "--object-path", "/org/gnome/ScreenSaver", "--method", "org.gnome.ScreenSaver.Lock"]):
        return
    if _run(["xdg-screensaver", "lock"]):
        return
    raise RuntimeError("Impossible de verrouiller la session.")


def _graphical_session() -> str | None:
    """Session graphique de l'utilisateur (celle de l'écran), via logind."""
    try:
        out = subprocess.run(["loginctl", "show-user", str(os.getuid()), "-p", "Display", "--value"], check=False, capture_output=True, text=True, timeout=5)
        sid = out.stdout.strip()
        return sid or os.environ.get("XDG_SESSION_ID") or None
    except (OSError, subprocess.SubprocessError):
        return os.environ.get("XDG_SESSION_ID") or None


def is_locked() -> bool | None:
    sid = _graphical_session()
    if not sid:
        return None
    try:
        out = subprocess.run(["loginctl", "show-session", sid, "-p", "LockedHint", "--value"], check=False, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    v = out.stdout.strip()
    return {"yes": True, "no": False}.get(v)


def unlock() -> bool:
    """Déverrouille la session graphique (signal logind « Unlock », que GNOME/KDE écoutent).
    Possible sans mot de passe pour sa propre session ; renvoie True si l'écran est bien déverrouillé."""
    import time

    sid = _graphical_session()
    if not sid:
        raise RuntimeError("Session graphique introuvable.")
    if not _run(["loginctl", "unlock-session", sid]):
        raise RuntimeError("Le système a refusé le déverrouillage (règles polkit).")
    for _ in range(20):  # GNOME met quelques centaines de ms à retirer l'écran de verrouillage
        if is_locked() is False:
            return True
        time.sleep(0.15)
    return is_locked() is not True


def sleep() -> None:
    if not _run(["systemctl", "suspend"], 10):
        raise RuntimeError("La mise en veille a été refusée par le système.")


def notify(title: str, body: str) -> None:
    if not _run(["notify-send", "--app-name=ORION", title, body]):
        raise RuntimeError("notify-send indisponible.")


# ───────────── Presse-papiers, liens, son, lecture, alimentation ─────────────


def _out(cmd: list[str], timeout: float = 5, stdin: str | None = None) -> str | None:
    try:
        res = subprocess.run(cmd, check=False, input=stdin, capture_output=True, text=True, timeout=timeout, env=desktop_env())
        return res.stdout if res.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


_CLIP_MISSING = "Installe l'outil de presse-papiers sur le PC : sudo apt install wl-clipboard (Wayland) ou xclip (X11)."


def clipboard_get() -> str:
    for cmd in (["wl-paste", "--no-newline"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]):
        if shutil.which(cmd[0]):
            text = _out(cmd)
            if text is not None:
                return text
    raise RuntimeError(_CLIP_MISSING)


def clipboard_set(text: str) -> None:
    for cmd in (["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]):
        if shutil.which(cmd[0]):
            try:
                # wl-copy / xclip restent en arrière-plan pour servir le contenu : on ne les attend pas.
                p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=desktop_env(), start_new_session=True)
                p.communicate(text.encode(), timeout=3)
            except subprocess.TimeoutExpired:
                pass
            except OSError:
                continue
            return
    raise RuntimeError(_CLIP_MISSING)


def open_url(url: str) -> None:
    if not _run(["xdg-open", url], 8):
        raise RuntimeError("Impossible d'ouvrir le lien sur le PC.")


def _volume_state() -> dict:
    out = _out(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"]) or ""
    # « Volume: 0.45 [MUTED] »
    try:
        level = round(float(out.split()[1]) * 100)
    except (IndexError, ValueError):
        level = None
    return {"level": level, "muted": "MUTED" in out}


def volume(op: str, value: int | None = None) -> dict:
    if not shutil.which("wpctl"):
        raise RuntimeError("Contrôle du son indisponible (wpctl / PipeWire introuvable).")
    sink = "@DEFAULT_AUDIO_SINK@"
    cmd = {
        "up": ["wpctl", "set-volume", "-l", "1.0", sink, "5%+"],
        "down": ["wpctl", "set-volume", sink, "5%-"],
        "mute": ["wpctl", "set-mute", sink, "1"],
        "unmute": ["wpctl", "set-mute", sink, "0"],
        "toggle": ["wpctl", "set-mute", sink, "toggle"],
        "set": ["wpctl", "set-volume", sink, f"{max(0, min(100, value or 0))}%"],
    }.get(op)
    if cmd and not _run(cmd):
        raise RuntimeError("Le réglage du son a échoué.")
    if op == "set":
        _run(["wpctl", "set-mute", sink, "0"])
    return _volume_state()


def _mpris_players() -> list[str]:
    out = _out(["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.ListNames"]) or ""
    return [n.strip(" '") for n in out.replace("(", "").replace(")", "").replace("[", "").replace("]", "").split(",") if "org.mpris.MediaPlayer2." in n]


def _mpris_prop(player: str, prop: str) -> str:
    return _out(["gdbus", "call", "--session", "--dest", player, "--object-path", "/org/mpris/MediaPlayer2", "--method", "org.freedesktop.DBus.Properties.Get", "org.mpris.MediaPlayer2.Player", prop]) or ""


def media_status() -> dict:
    """Lecteur en cours : titre, artiste, état (lecture/pause), d'après MPRIS."""
    import re

    players = _mpris_players()
    if not players:
        return {"player": None, "playing": False, "title": None, "artist": None}
    # Préfère un lecteur en cours de lecture.
    chosen, status = players[0], ""
    for p in players:
        st = _mpris_prop(p, "PlaybackStatus")
        if "Playing" in st:
            chosen, status = p, st
            break
        status = status or st
    meta = _mpris_prop(chosen, "Metadata")
    title = re.search(r"'xesam:title': <'((?:[^'\\]|\\.)*)'>", meta)
    artist = re.search(r"'xesam:artist': <\['((?:[^'\\]|\\.)*)'", meta)
    return {
        "player": chosen.removeprefix("org.mpris.MediaPlayer2.").split(".")[0],
        "playing": "Playing" in (_mpris_prop(chosen, "PlaybackStatus") if chosen != players[0] or not status else status),
        "title": title.group(1) if title else None,
        "artist": artist.group(1) if artist else None,
    }


def open_path(path: Path) -> None:
    if not _run(["xdg-open", str(path)], 8):
        raise RuntimeError("Aucune application du PC ne sait ouvrir ce fichier.")


def media(op: str) -> dict:
    if op == "status":
        return media_status()
    method = {"play-pause": "PlayPause", "next": "Next", "previous": "Previous", "pause": "Pause", "play": "Play"}.get(op)
    if not method:
        raise RuntimeError(f"Commande de lecture inconnue : {op}")
    players = _mpris_players()
    if not players:
        raise RuntimeError("Aucun lecteur multimédia ouvert sur le PC (Spotify, navigateur, VLC…).")
    player = players[0]
    status = media_status()
    if status["player"]:
        player = next((p for p in players if status["player"] in p), player)
    _run(["gdbus", "call", "--session", "--dest", player, "--object-path", "/org/mpris/MediaPlayer2", "--method", f"org.mpris.MediaPlayer2.Player.{method}"])
    time.sleep(0.4)
    return media_status()


def power(op: str) -> None:
    cmd = {"shutdown": ["systemctl", "poweroff"], "restart": ["systemctl", "reboot"]}.get(op)
    if not cmd or not _run(cmd, 10):
        raise RuntimeError("Le système a refusé l'opération.")


# --- Veille légère : écran éteint, PC éveillé et joignable -------------------------------------------
_MUTTER = ["busctl", "--user", "set-property", "org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig", "org.gnome.Mutter.DisplayConfig", "PowerSaveMode", "i"]


def display_off() -> None:
    """Éteint l'écran tout de suite (GNOME/Mutter), sinon via l'économiseur d'écran."""
    if _run([*_MUTTER, "3"]):
        return
    if _run(["xset", "dpms", "force", "off"]):
        return
    if not _run(["gdbus", "call", "--session", "--dest", "org.gnome.ScreenSaver", "--object-path", "/org/gnome/ScreenSaver", "--method", "org.gnome.ScreenSaver.SetActive", "true"]):
        raise RuntimeError("Impossible d'éteindre l'écran.")


def display_on() -> None:
    if _run([*_MUTTER, "0"]):
        return
    _run(["xset", "dpms", "force", "on"])


def keep_awake():
    """Empêche la vraie mise en veille (le PC doit rester joignable). Renvoie le processus à arrêter."""
    return subprocess.Popen(
        ["systemd-inhibit", "--what=sleep", "--who=ORION", "--why=Veille légère : joignable depuis le téléphone", "--mode=block", "sleep", "infinity"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=desktop_env(), start_new_session=True,
    )
