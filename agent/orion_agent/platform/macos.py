"""macOS."""

import platform
import subprocess
from pathlib import Path

name = "macos"


def os_version() -> str:
    return f"macOS {platform.mac_ver()[0] or ''}".strip()


def _run(cmd: list[str], timeout: float = 8) -> bool:
    try:
        return subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def capture_screen(dest: Path) -> None:
    # Nécessite l'autorisation « Enregistrement de l'écran » pour le terminal / l'agent.
    if not _run(["screencapture", "-x", "-t", "png", str(dest)]) or not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError("Capture refusée : autorise ORION dans Réglages > Confidentialité > Enregistrement de l'écran.")


def lock() -> None:
    # Éteint l'écran ; la session se verrouille si « Exiger le mot de passe immédiatement » est actif.
    if not _run(["pmset", "displaysleepnow"]):
        raise RuntimeError("Impossible de verrouiller la session.")


def sleep() -> None:
    if not _run(["pmset", "sleepnow"]):
        raise RuntimeError("La mise en veille a échoué.")


def notify(title: str, body: str) -> None:
    script = f"display notification {body!r} with title {title!r}".replace("'", '"')
    if not _run(["osascript", "-e", script]):
        raise RuntimeError("Notification impossible.")


def _out(cmd: list[str], timeout: float = 8, stdin: str | None = None) -> str | None:
    try:
        res = subprocess.run(cmd, check=False, input=stdin, capture_output=True, text=True, timeout=timeout)
        return res.stdout if res.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def clipboard_get() -> str:
    text = _out(["pbpaste"])
    if text is None:
        raise RuntimeError("Presse-papiers illisible.")
    return text


def clipboard_set(text: str) -> None:
    if _out(["pbcopy"], stdin=text) is None:
        raise RuntimeError("Presse-papiers inaccessible.")


def open_url(url: str) -> None:
    if not _run(["open", url]):
        raise RuntimeError("Impossible d'ouvrir le lien.")


def volume(op: str, value: int | None = None) -> dict:
    script = {
        "up": "set volume output volume ((output volume of (get volume settings)) + 6)",
        "down": "set volume output volume ((output volume of (get volume settings)) - 6)",
        "mute": "set volume with output muted",
        "unmute": "set volume without output muted",
        "toggle": "set volume output muted (not (output muted of (get volume settings)))",
        "set": f"set volume output volume {max(0, min(100, value or 0))}",
    }.get(op)
    if script:
        _run(["osascript", "-e", script])
    level = _out(["osascript", "-e", "output volume of (get volume settings)"])
    muted = _out(["osascript", "-e", "output muted of (get volume settings)"])
    return {"level": int(level) if level and level.strip().isdigit() else None, "muted": (muted or "").strip() == "true"}


def open_path(path: Path) -> None:
    if not _run(["open", str(path)]):
        raise RuntimeError("Aucune application du Mac ne sait ouvrir ce fichier.")


def media(op: str) -> dict:
    verb = {"play-pause": "playpause", "next": "next track", "previous": "previous track", "pause": "pause", "play": "play"}.get(op)
    for app in ("Spotify", "Music"):
        running = _out(["osascript", "-e", f'application "{app}" is running']) or ""
        if running.strip() == "true" and op == "status":
            title = _out(["osascript", "-e", f'tell application "{app}" to name of current track']) or ""
            artist = _out(["osascript", "-e", f'tell application "{app}" to artist of current track']) or ""
            state = _out(["osascript", "-e", f'tell application "{app}" to player state as string']) or ""
            return {"player": app, "playing": state.strip() == "playing", "title": title.strip() or None, "artist": artist.strip() or None}
    if op == "status":
        return {"player": None, "playing": False, "title": None, "artist": None}
    for app in ("Spotify", "Music"):
        running = _out(["osascript", "-e", f'application "{app}" is running']) or ""
        if running.strip() == "true" and verb:
            _run(["osascript", "-e", f'tell application "{app}" to {verb}'])
            return {"player": app}
    raise RuntimeError("Ni Spotify ni Musique ne sont ouverts sur le Mac.")


def power(op: str) -> None:
    verb = {"shutdown": "shut down", "restart": "restart"}.get(op)
    if not verb or not _run(["osascript", "-e", f'tell application "System Events" to {verb}']):
        raise RuntimeError("Le Mac a refusé l'opération.")


def is_locked() -> bool | None:
    return None


def unlock() -> bool:
    raise RuntimeError("macOS n'autorise pas le déverrouillage à distance : le mot de passe est exigé sur le PC.")


# --- Veille légère ----------------------------------------------------------------------------------
def display_off() -> None:
    import subprocess

    subprocess.run(["pmset", "displaysleepnow"], check=False, capture_output=True, timeout=5)


def display_on() -> None:
    import subprocess

    subprocess.run(["caffeinate", "-u", "-t", "2"], check=False, capture_output=True, timeout=5)


def keep_awake():
    import subprocess

    return subprocess.Popen(["caffeinate", "-i", "-s"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
