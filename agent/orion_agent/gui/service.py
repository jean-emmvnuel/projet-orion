"""Lancement au démarrage : unité systemd utilisateur (Linux uniquement pour l'instant)."""

import json
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

UNIT = "orion-agent"
UNIT_FILE = Path.home() / ".config" / "systemd" / "user" / f"{UNIT}.service"


def supported() -> bool:
    return platform.system() == "Linux" and shutil.which("systemctl") is not None


def _systemctl(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["systemctl", "--user", *args], check=False, capture_output=True, text=True, timeout=15)


def _exec_start() -> str:
    script = Path(sys.executable).with_name("orion-agent")
    return f"{script} run" if script.exists() else f"{sys.executable} -m orion_agent run"


def unit_text() -> str:
    # Même contenu que agent/orion-agent.service, avec le chemin réel de l'exécutable.
    return f"""[Unit]
Description=ORION — agent PC (connexion sortante vers le Core)
After=network-online.target graphical-session.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={_exec_start()}
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=XDG_RUNTIME_DIR=/run/user/%U
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/%U/bus

[Install]
WantedBy=default.target
"""


def status() -> dict:
    """{installed, enabled, active}"""
    if not supported():
        return {"installed": False, "enabled": False, "active": False}
    enabled = _systemctl("is-enabled", UNIT).stdout.strip() == "enabled"
    active = _systemctl("is-active", UNIT).stdout.strip() == "active"
    return {"installed": UNIT_FILE.exists(), "enabled": enabled, "active": active}


def _check(res: subprocess.CompletedProcess) -> None:
    if res.returncode != 0:
        raise RuntimeError((res.stderr or res.stdout).strip() or "systemctl a échoué")


def enable() -> None:
    """Installe (ou met à jour) l'unité, l'active au démarrage et la lance."""
    UNIT_FILE.parent.mkdir(parents=True, exist_ok=True)
    UNIT_FILE.write_text(unit_text(), encoding="utf-8")
    _check(_systemctl("daemon-reload"))
    _check(_systemctl("enable", "--now", UNIT))


def disable() -> None:
    _check(_systemctl("disable", "--now", UNIT))


def start() -> None:
    _check(_systemctl("start", UNIT))


def stop() -> None:
    _check(_systemctl("stop", UNIT))


# Lignes de journal écrites par l'agent : « → action {…} », « ✓ action », « ✗ action : erreur ».
_CMD = re.compile(r"(?:\d\d:\d\d:\d\d \w+ )?(→|✓|✗) (\S+)(?: (?::|—) (.*)|\s.*)?$")


def read_journal(lines: int = 80) -> tuple[list[dict], str | None]:
    """Commandes récentes et dernier état de connexion du service, lus dans journalctl."""
    try:
        res = subprocess.run(
            ["journalctl", "--user", "-u", UNIT, "-n", str(lines), "-o", "json", "--no-pager"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return [], None
    entries: list[dict] = []
    state = None
    for raw in res.stdout.splitlines():
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        msg = rec.get("MESSAGE")
        if not isinstance(msg, str):
            continue
        ts = datetime.fromtimestamp(int(rec.get("__REALTIME_TIMESTAMP", 0)) / 1e6)
        if "Connecté au Core" in msg or "Reconnu comme" in msg:
            state = "online"
        elif "Déconnecté du Core" in msg or "Core injoignable" in msg:
            state = "offline"
        elif "réassocier ce PC" in msg:
            state = "revoked"
        m = _CMD.search(msg)
        if not m:
            continue
        sign, action, err = m.groups()
        if sign == "→":
            entries.append({"id": f"j{len(entries)}", "action": action, "status": "running", "error": None, "time": ts})
            continue
        for e in reversed(entries):
            if e["action"] == action and e["status"] == "running":
                e["status"] = "done" if sign == "✓" else "failed"
                e["error"] = err
                break
        else:
            entries.append({"id": f"j{len(entries)}", "action": action, "status": "done" if sign == "✓" else "failed", "error": err, "time": ts})
    return entries, state
