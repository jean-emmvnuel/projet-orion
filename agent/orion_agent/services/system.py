"""Métriques du PC, en nombres (et non en texte formaté comme dans le bot Telegram)."""

import shutil
import socket
import time

import psutil

from ..config import HOME

# Amorce la mesure du processeur : le premier appel de psutil renvoie toujours 0.
psutil.cpu_percent(interval=None)  # amorce


def metrics() -> dict:
    vm = psutil.virtual_memory()
    disk = shutil.disk_usage(HOME)
    battery = None
    try:
        b = psutil.sensors_battery()
        if b is not None:
            battery = {"percent": round(b.percent), "charging": bool(b.power_plugged)}
    except (AttributeError, NotImplementedError, OSError):
        pass
    from ..platform import current as osmod

    locked = None
    try:
        locked = osmod.is_locked()
    except Exception:  # noqa: BLE001 — l'état de verrouillage est un bonus, jamais bloquant
        locked = None
    return {
        "locked": locked,
        "standby": _standby_active(),
        "cpu": round(psutil.cpu_percent(interval=None)),
        "ram": round(vm.percent),
        "ramUsedGb": round(vm.used / 1024**3, 1),
        "ramTotalGb": round(vm.total / 1024**3, 1),
        "disk": round((disk.total - disk.free) / disk.total * 100),
        "diskFreeGb": round(disk.free / 1024**3, 1),
        "battery": battery,
        "uptimeS": int(time.time() - psutil.boot_time()),
        "hostname": socket.gethostname(),
    }


def _standby_active() -> bool:
    from . import standby

    standby.check()  # déverrouillé sur place → fin de la veille légère
    return standby.active()
