"""Bureau à distance sous Windows : capture `mss`, souris et clavier par SendInput (API Win32).

Aucune autorisation à accorder. Les coordonnées sont en pixels physiques (processus
déclaré « DPI aware ») pour correspondre exactement à la capture.
"""

import asyncio
import ctypes
from ctypes import wintypes

from .remote_grab import GrabRemoteSession, RemoteError, split_combo

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
MOUSEEVENTF_MOVE, MOUSEEVENTF_WHEEL, MOUSEEVENTF_HWHEEL = 0x0001, 0x0800, 0x1000
BUTTON_FLAGS = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}
KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE = 0x0001, 0x0002, 0x0004
WHEEL_DELTA = 120

VK = {
    "enter": 0x0D, "return": 0x0D, "tab": 0x09, "escape": 0x1B, "esc": 0x1B, "backspace": 0x08, "delete": 0x2E,
    "space": 0x20, "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12, "super": 0x5B, "meta": 0x5B, "win": 0x5B,
    **{f"f{i}": 0x70 + i - 1 for i in range(1, 13)},
}
EXTENDED = {0x2E, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0x5B}


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


class _U(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _U)]


def _user32():
    return ctypes.windll.user32  # type: ignore[attr-defined]


def _send(*inputs: INPUT) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    if _user32().SendInput(len(inputs), arr, ctypes.sizeof(INPUT)) != len(inputs):
        raise RemoteError("Windows a bloqué la commande (fenêtre administrateur au premier plan ?).")


def _mouse(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> INPUT:
    return INPUT(type=INPUT_MOUSE, u=_U(mi=MOUSEINPUT(dx=dx, dy=dy, mouseData=ctypes.c_ulong(data & 0xFFFFFFFF).value, dwFlags=flags)))


def _key(vk: int = 0, scan: int = 0, flags: int = 0) -> INPUT:
    if vk in EXTENDED:
        flags |= KEYEVENTF_EXTENDEDKEY
    return INPUT(type=INPUT_KEYBOARD, u=_U(ki=KEYBDINPUT(wVk=vk, wScan=scan, dwFlags=flags)))


def _vk_for(name: str) -> int:
    if name in VK:
        return VK[name]
    if len(name) == 1:
        res = _user32().VkKeyScanW(ord(name))
        if res != -1:
            return res & 0xFF
    raise RemoteError(f"Touche inconnue : {name}")


class RemoteSession(GrabRemoteSession):
    def _check_permissions(self) -> None:
        # Coordonnées et capture en pixels physiques, même avec une mise à l'échelle Windows.
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)  # type: ignore[attr-defined]
        except (AttributeError, OSError):
            pass

    def _screen_size(self) -> tuple[int, int]:
        u = _user32()
        return u.GetSystemMetrics(0), u.GetSystemMetrics(1)

    async def move(self, dx: float, dy: float) -> None:
        await asyncio.to_thread(_send, _mouse(MOUSEEVENTF_MOVE, round(dx), round(dy)))

    async def move_to(self, fx: float, fy: float) -> None:
        w, h = self.size or self._screen_size()
        x, y = round(max(0.0, min(1.0, fx)) * (w - 1)), round(max(0.0, min(1.0, fy)) * (h - 1))
        await asyncio.to_thread(_user32().SetCursorPos, x, y)

    async def button(self, name: str = "left", state: int | None = None) -> None:
        down, up = BUTTON_FLAGS.get(name, BUTTON_FLAGS["left"])
        if state is None:
            await asyncio.to_thread(_send, _mouse(down), _mouse(up))
        else:
            await asyncio.to_thread(_send, _mouse(down if state else up))

    async def scroll(self, dx: float, dy: float) -> None:
        if dy:
            await asyncio.to_thread(_send, _mouse(MOUSEEVENTF_WHEEL, data=-round(dy) * WHEEL_DELTA))
        if dx:
            await asyncio.to_thread(_send, _mouse(MOUSEEVENTF_HWHEEL, data=round(dx) * WHEEL_DELTA))

    async def keys(self, combo: str) -> None:
        vks = [_vk_for(p) for p in split_combo(combo)]
        events = [_key(v) for v in vks] + [_key(v, flags=KEYEVENTF_KEYUP) for v in reversed(vks)]
        await asyncio.to_thread(_send, *events)

    async def type_text(self, text: str) -> None:
        events: list[INPUT] = []
        for ch in text[:2000]:
            if ch == "\n":
                events += [_key(0x0D), _key(0x0D, flags=KEYEVENTF_KEYUP)]
                continue
            # Caractère Unicode (paires de substitution UTF-16 comprises) : indépendant de la disposition du clavier.
            units = ch.encode("utf-16-le")
            for i in range(0, len(units), 2):
                code = int.from_bytes(units[i : i + 2], "little")
                events += [_key(scan=code, flags=KEYEVENTF_UNICODE), _key(scan=code, flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)]
        if events:
            await asyncio.to_thread(_send, *events)
