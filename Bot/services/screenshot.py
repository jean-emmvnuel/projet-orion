import os
import sys
import time
import shutil
import subprocess
from pathlib import Path
from config import INBOX
from services.system import get_desktop_env


def _capture_portal(env: dict, target_dest: Path) -> bool:
    """
    Capture d'écran via le portail XDG Desktop (méthode officielle Wayland / GNOME Shell).
    Paramètre interactive=False : 100% silencieux, sans dialogue ni clic de confirmation.
    """
    portal_script = """
import sys
from urllib.parse import unquote, urlparse
from pathlib import Path

try:
    import dbus
    import dbus.mainloop.glib
    from gi.repository import GLib

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    loop = GLib.MainLoop()
    result_path = None

    def on_response(response, results, object_path):
        global result_path
        if response == 0 and 'uri' in results:
            parsed = urlparse(str(results['uri']))
            result_path = unquote(parsed.path)
        loop.quit()

    bus.add_signal_receiver(
        on_response,
        signal_name='Response',
        dbus_interface='org.freedesktop.portal.Request',
        bus_name='org.freedesktop.portal.Desktop',
        path_keyword='object_path'
    )

    proxy = bus.get_object('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')
    iface = dbus.Interface(proxy, dbus_interface='org.freedesktop.portal.Screenshot')
    req = iface.Screenshot('', {'interactive': False})

    GLib.timeout_add_seconds(5, loop.quit)
    loop.run()

    if result_path and Path(result_path).exists() and Path(result_path).stat().st_size > 0:
        print(result_path)
        sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(2)
"""
    python_bin = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable
    try:
        res = subprocess.run(
            [python_bin, "-c", portal_script],
            capture_output=True,
            text=True,
            timeout=7,
            env=env,
        )
        if res.returncode == 0 and res.stdout.strip():
            portal_file = Path(res.stdout.strip())
            if portal_file.exists() and portal_file.stat().st_size > 0:
                shutil.move(str(portal_file), str(target_dest))
                return True
    except Exception:
        pass
    return False


def capture_screen() -> Path:
    """
    Capture l'écran du PC sous Linux de façon autonome et immédiate.
    Le fichier est temporairement stocké dans INBOX sous un nom masqué,
    puis doit être supprimé par l'appelant dès son expédition.
    """
    try:
        INBOX.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass

    temp_target = INBOX / f".tmp_screen_{int(time.time() * 1000)}.png"
    env = get_desktop_env()

    # 1. Portail XDG (Standard moderne Ubuntu GNOME Wayland, sans pop-up)
    if _capture_portal(env, temp_target):
        if temp_target.exists() and temp_target.stat().st_size > 0:
            return temp_target

    # 2. grim (Wayland Sway / Hyprland)
    try:
        res = subprocess.run(
            ["grim", str(temp_target)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=4,
            env=env,
        )
        if res.returncode == 0 and temp_target.exists() and temp_target.stat().st_size > 0:
            return temp_target
    except Exception:
        pass

    # 3. Fallback X11 (import ImageMagick ou scrot)
    for cmd in [["import", "-window", "root", str(temp_target)], ["scrot", str(temp_target)]]:
        try:
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=4, env=env)
            if res.returncode == 0 and temp_target.exists() and temp_target.stat().st_size > 0:
                return temp_target
        except Exception:
            continue

    if temp_target.exists():
        try:
            temp_target.unlink()
        except OSError:
            pass

    raise RuntimeError("Impossible de capturer l'écran (aucune session graphique active compatible).")
