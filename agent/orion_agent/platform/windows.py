"""Windows 10 / 11."""

import platform
import subprocess
from pathlib import Path

name = "windows"


def os_version() -> str:
    release, version = platform.release(), platform.version()
    # Windows 11 se déclare « 10 » avec un numéro de build ≥ 22000.
    try:
        if release == "10" and int(version.split(".")[2]) >= 22000:
            release = "11"
    except (IndexError, ValueError):
        pass
    return f"Windows {release}"


def _run(cmd: list[str], timeout: float = 8) -> bool:
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, creationflags=flags).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def capture_screen(dest: Path) -> None:
    from PIL import ImageGrab

    ImageGrab.grab(all_screens=True).save(dest, "PNG")


def lock() -> None:
    if not _run(["rundll32.exe", "user32.dll,LockWorkStation"]):
        raise RuntimeError("Impossible de verrouiller la session.")


def sleep() -> None:
    if not _run(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"], 15):
        raise RuntimeError("La mise en veille a échoué.")


def notify(title: str, body: str) -> None:
    ps = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;"
        f"$n.Visible=$true;$n.ShowBalloonTip(6000,{title!r},{body!r},'Info');Start-Sleep -s 7;$n.Dispose()"
    )
    subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def _ps(script: str, timeout: float = 8, capture: bool = False) -> str | None:
    try:
        res = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            check=False, capture_output=True, text=True, timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return res.stdout if res.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def clipboard_get() -> str:
    text = _ps("Get-Clipboard -Raw")
    if text is None:
        raise RuntimeError("Presse-papiers illisible.")
    return text.rstrip("\r\n")


def clipboard_set(text: str) -> None:
    escaped = text.replace("'", "''")
    if _ps(f"Set-Clipboard -Value '{escaped}'") is None:
        raise RuntimeError("Presse-papiers inaccessible.")


def open_url(url: str) -> None:
    import os

    os.startfile(url)  # type: ignore[attr-defined]


def _key(code: int, times: int = 1) -> None:
    _ps(f"$w=New-Object -ComObject WScript.Shell; 1..{times} | % {{ $w.SendKeys([char]{code}) }}")


def volume(op: str, value: int | None = None) -> dict:
    if op == "up":
        _key(175, 3)
    elif op == "down":
        _key(174, 3)
    elif op in ("mute", "unmute", "toggle"):
        _key(173)
    elif op == "set":
        _key(174, 50)
        _key(175, max(0, min(100, value or 0)) // 2)
    return {"level": None, "muted": None}


def open_path(path: Path) -> None:
    import os

    os.startfile(str(path))  # type: ignore[attr-defined]


def media(op: str) -> dict:
    if op == "status":
        return {"player": None, "playing": None, "title": None, "artist": None}
    code = {"play-pause": 179, "next": 176, "previous": 177, "pause": 179, "play": 179}.get(op)
    if not code:
        raise RuntimeError(f"Commande de lecture inconnue : {op}")
    _key(code)
    return {"player": "Windows"}


def power(op: str) -> None:
    flag = {"shutdown": "/s", "restart": "/r"}.get(op)
    if not flag or not _run(["shutdown", flag, "/t", "3"]):
        raise RuntimeError("Windows a refusé l'opération.")


def is_locked() -> bool | None:
    return None


def unlock() -> bool:
    raise RuntimeError("Windows n'autorise pas le déverrouillage à distance : le mot de passe est exigé sur le PC.")


# --- Veille légère ----------------------------------------------------------------------------------
def display_off() -> None:
    import ctypes

    # WM_SYSCOMMAND / SC_MONITORPOWER, 2 = écran éteint
    ctypes.windll.user32.PostMessageW(0xFFFF, 0x0112, 0xF170, 2)  # type: ignore[attr-defined]


def display_on() -> None:
    import ctypes

    ctypes.windll.user32.PostMessageW(0xFFFF, 0x0112, 0xF170, -1)  # type: ignore[attr-defined]
    ctypes.windll.user32.mouse_event(0x0001, 0, 1, 0, 0)  # léger mouvement : réveille l'écran
    ctypes.windll.user32.mouse_event(0x0001, 0, -1, 0, 0)


class _KeepAwake:
    """Empêche la veille tant que ce fil tourne (SetThreadExecutionState)."""

    def __init__(self) -> None:
        import threading

        self._stop = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        import ctypes

        es_continuous, es_system = 0x80000000, 0x00000001
        while not self._stop.is_set():
            ctypes.windll.kernel32.SetThreadExecutionState(es_continuous | es_system)  # type: ignore[attr-defined]
            self._stop.wait(30)
        ctypes.windll.kernel32.SetThreadExecutionState(es_continuous)  # type: ignore[attr-defined]

    def terminate(self) -> None:
        self._stop.set()

    def wait(self, timeout=None) -> None:  # interface commune avec subprocess.Popen
        return None


def keep_awake():
    return _KeepAwake()
