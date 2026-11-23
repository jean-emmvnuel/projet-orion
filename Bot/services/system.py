import os
import glob
import shutil
import datetime
import subprocess
from pathlib import Path
from config import RACINE, INBOX

try:
    import psutil
except ImportError:
    psutil = None


def get_desktop_env() -> dict:
    """Prépare un environnement contenant les variables de session utilisateur actives (D-Bus / Wayland / X11)."""
    env = os.environ.copy()
    uid = os.getuid()
    user_run = f"/run/user/{uid}"

    if "DBUS_SESSION_BUS_ADDRESS" not in env or not env["DBUS_SESSION_BUS_ADDRESS"]:
        bus_file = f"{user_run}/bus"
        if os.path.exists(bus_file):
            env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus_file}"

    if "XDG_RUNTIME_DIR" not in env or not env["XDG_RUNTIME_DIR"]:
        if os.path.exists(user_run):
            env["XDG_RUNTIME_DIR"] = user_run

    if "WAYLAND_DISPLAY" not in env or not env["WAYLAND_DISPLAY"]:
        if os.path.exists(f"{user_run}/wayland-0"):
            env["WAYLAND_DISPLAY"] = "wayland-0"

    if "DISPLAY" not in env or not env["DISPLAY"]:
        env["DISPLAY"] = ":0"

    return env


def get_battery_info() -> str | None:
    """Lecture O(1) de l'état de charge et du pourcentage de la batterie via sysfs ou psutil."""
    # 1. Sysfs Linux natif (très rapide, 0 dépendance)
    bats = glob.glob("/sys/class/power_supply/BAT*")
    if bats:
        try:
            bat_dir = bats[0]
            with open(os.path.join(bat_dir, "capacity"), "r") as f:
                pct = f.read().strip()

            status_file = os.path.join(bat_dir, "status")
            status_raw = ""
            if os.path.exists(status_file):
                with open(status_file, "r") as f:
                    status_raw = f.read().strip().lower()

            if "charging" in status_raw:
                etat = "En charge ⚡"
            elif "full" in status_raw:
                etat = "Pleine 🟢"
            elif "discharging" in status_raw:
                etat = "Sur batterie 🔋"
            else:
                etat = status_raw.capitalize() if status_raw else "Connectée"

            return f"`{pct}%` ({etat})"
        except Exception:
            pass

    # 2. Fallback psutil
    if psutil and hasattr(psutil, "sensors_battery"):
        try:
            bat = psutil.sensors_battery()
            if bat:
                pct = int(bat.percent)
                charge = " ⚡" if bat.power_plugged else " 🔋"
                status = "En charge" if bat.power_plugged else "Sur batterie"
                return f"`{pct}%` ({status}{charge})"
        except Exception:
            pass

    return None


def get_system_metrics() -> dict:
    """Collecte les métriques système du PC hôte avec un coût CPU minimal."""
    # 1. Uptime
    try:
        with open("/proc/uptime", "r") as f:
            uptime_sec = int(float(f.readline().split()[0]))
            uptime_str = str(datetime.timedelta(seconds=uptime_sec))
    except Exception:
        uptime_str = "Indisponible"

    # 2. CPU
    if psutil:
        cpu_str = f"`{psutil.cpu_percent(interval=0.1)}%`"
    else:
        try:
            with open("/proc/loadavg", "r") as f:
                l1, l5 = f.read().split()[:2]
                cpu_str = f"Charge `{l1}` (1m), `{l5}` (5m)"
        except Exception:
            cpu_str = "Indisponible"

    # 3. RAM
    if psutil:
        ram = psutil.virtual_memory()
        ram_used = ram.used / (1024**3)
        ram_total = ram.total / (1024**3)
        ram_str = f"`{ram_used:.1f} / {ram_total:.1f} Go` (`{ram.percent}%`)"
    else:
        try:
            mem = {}
            with open("/proc/meminfo", "r") as f:
                for line in f:
                    if ":" in line:
                        k, v = line.split(":", 1)
                        if k in ("MemTotal", "MemAvailable"):
                            mem[k] = int(v.split()[0])
            total_kb = mem.get("MemTotal", 1)
            avail_kb = mem.get("MemAvailable", 0)
            used_kb = total_kb - avail_kb
            ram_pct = int(used_kb / total_kb * 100)
            ram_str = f"`{used_kb / (1024**2):.1f} / {total_kb / (1024**2):.1f} Go` (`{ram_pct}%`)"
        except Exception:
            ram_str = "Indisponible"

    # 4. Espace Disque
    disk = shutil.disk_usage(RACINE)
    disk_used = (disk.total - disk.free) / (1024**3)
    disk_total = disk.total / (1024**3)
    disk_free = disk.free / (1024**3)
    disk_pct = int((disk.total - disk.free) / disk.total * 100)
    disk_str = f"`{disk_used:.1f} / {disk_total:.1f} Go` (`{disk_pct}%` — Libre : `{disk_free:.1f} Go`)"

    # 5. Batterie
    bat_str = get_battery_info()

    return {
        "uptime": uptime_str,
        "cpu": cpu_str,
        "ram": ram_str,
        "disk": disk_str,
        "battery": bat_str,
        "racine": str(RACINE),
        "inbox": str(INBOX),
    }


def lock_session() -> bool:
    """Verrouille immédiatement la session graphique de manière autonome."""
    env = get_desktop_env()
    # 1. loginctl (standard systemd, fiable et universel)
    try:
        res = subprocess.run(
            ["loginctl", "lock-session"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
            env=env,
        )
        if res.returncode == 0:
            return True
    except Exception:
        pass

    # 2. D-Bus GNOME ScreenSaver
    try:
        res = subprocess.run(
            [
                "gdbus", "call", "--session",
                "--dest", "org.gnome.ScreenSaver",
                "--object-path", "/org/gnome/ScreenSaver",
                "--method", "org.gnome.ScreenSaver.Lock",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
            env=env,
        )
        if res.returncode == 0:
            return True
    except Exception:
        pass

    return False
