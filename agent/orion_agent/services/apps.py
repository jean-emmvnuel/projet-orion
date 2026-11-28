"""Applications installées sur le PC : liste et lancement (Linux, macOS, Windows)."""

import configparser
import os
import platform
import subprocess
from pathlib import Path

SYSTEM = platform.system()


def _xdg_dirs() -> list[Path]:
    home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    data = os.environ.get("XDG_DATA_DIRS", "/usr/local/share:/usr/share").split(":")
    extra = ["/var/lib/flatpak/exports/share", str(Path.home() / ".local/share/flatpak/exports/share"), "/var/lib/snapd/desktop"]
    seen, out = set(), []
    for d in [str(home), *data, *extra]:
        p = Path(d) / "applications"
        if p.is_dir() and p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _lang() -> str:
    return (os.environ.get("LANG") or "fr").split("_")[0].split(".")[0] or "fr"


# Grandes familles pour classer et illustrer les applis dans l'app mobile.
CATEGORIES = [
    ("web", ("WebBrowser",)),
    ("dev", ("Development", "IDE", "TextEditor")),
    ("media", ("AudioVideo", "Audio", "Video", "Player")),
    ("office", ("Office", "WordProcessor", "Spreadsheet", "Presentation")),
    ("graphics", ("Graphics",)),
    ("chat", ("Chat", "InstantMessaging", "Email", "Network")),
    ("game", ("Game",)),
    ("system", ("System", "Settings", "Utility", "FileManager", "TerminalEmulator")),
]


def _category(cats: str) -> str:
    items = set(cats.split(";"))
    for key, names in CATEGORIES:
        if items & set(names):
            return key
    return "other"


def _linux_apps() -> list[dict]:
    lang, apps = _lang(), {}
    for folder in _xdg_dirs():
        for f in folder.glob("*.desktop"):
            if f.name in apps:  # le premier dossier (utilisateur) l'emporte
                continue
            cp = configparser.ConfigParser(interpolation=None, strict=False)
            try:
                cp.read(f, encoding="utf-8")
                e = cp["Desktop Entry"]
            except (configparser.Error, KeyError, UnicodeDecodeError):
                continue
            if e.get("Type") != "Application" or e.get("NoDisplay", "").lower() == "true" or e.get("Hidden", "").lower() == "true":
                apps[f.name] = None
                continue
            show = e.get("OnlyShowIn")
            if show and "GNOME" not in show and "Unity" not in show:
                continue
            apps[f.name] = {
                "id": f.name.removesuffix(".desktop"),
                "name": e.get(f"Name[{lang}]") or e.get("Name") or f.stem,
                "comment": e.get(f"Comment[{lang}]") or e.get("Comment") or e.get("GenericName") or "",
                "category": _category(e.get("Categories", "")),
            }
    return sorted((a for a in apps.values() if a), key=lambda a: a["name"].lower())


def _mac_apps() -> list[dict]:
    out = []
    for root in (Path("/Applications"), Path("/System/Applications"), Path.home() / "Applications"):
        for app in root.glob("*.app"):
            out.append({"id": str(app), "name": app.stem, "comment": "", "category": "other"})
    return sorted(out, key=lambda a: a["name"].lower())


def _windows_apps() -> list[dict]:
    roots = [Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / r"Microsoft\Windows\Start Menu\Programs",
             Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs"]
    out = {}
    for root in roots:
        for lnk in root.rglob("*.lnk"):
            name = lnk.stem
            if any(w in name.lower() for w in ("uninstall", "désinstaller", "readme")):
                continue
            out.setdefault(name.lower(), {"id": str(lnk), "name": name, "comment": "", "category": "other"})
    return sorted(out.values(), key=lambda a: a["name"].lower())


def list_apps() -> list[dict]:
    if SYSTEM == "Linux":
        return _linux_apps()
    if SYSTEM == "Darwin":
        return _mac_apps()
    return _windows_apps()


def open_app(app_id: str) -> dict:
    """Lance une application de la liste (identifiant renvoyé par list_apps)."""
    known = {a["id"]: a for a in list_apps()}
    app = known.get(app_id)
    if not app:
        raise ValueError("Application introuvable sur ce PC.")
    if SYSTEM == "Linux":
        from ..platform.linux import desktop_env

        subprocess.Popen(["gtk-launch", app_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=desktop_env(), start_new_session=True)
    elif SYSTEM == "Darwin":
        subprocess.Popen(["open", "-a", app_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    else:
        os.startfile(app_id)  # type: ignore[attr-defined]
    return {"id": app_id, "name": app["name"]}
