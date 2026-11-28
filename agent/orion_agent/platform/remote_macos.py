"""Bureau à distance sous macOS : capture `mss`, souris et clavier par Quartz (CGEvent).

macOS exige deux autorisations, accordées une fois dans Réglages système > Confidentialité et sécurité :
- « Enregistrement de l'écran » (voir l'écran) ;
- « Accessibilité » (souris et clavier).
L'agent les demande et explique quoi cocher si elles manquent.

Les raccourcis envoyés par le téléphone sont « façon PC » (ctrl+c, alt+tab…) : ils sont
traduits en équivalents Mac (cmd+c, cmd+tab…).
"""

import asyncio

from .remote_grab import GrabRemoteSession, RemoteError, split_combo

# Codes de touches macOS (disposition ANSI).
KEYCODES = {
    "enter": 36, "return": 36, "tab": 48, "space": 49, "backspace": 51, "escape": 53, "esc": 53, "delete": 117,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "left": 123, "right": 124, "down": 125, "up": 126,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
    "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
    "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44,
    "n": 45, "m": 46, ".": 47, "`": 50,
}
MODIFIERS = {"ctrl": "control", "control": "control", "shift": "shift", "alt": "option", "option": "option", "cmd": "command", "command": "command", "super": "command", "meta": "command", "win": "command"}

# Raccourcis PC → Mac.
TRANSLATE = {
    "alt+tab": "cmd+tab",
    "alt+shift+tab": "cmd+shift+tab",
    "super": "ctrl+up",  # Mission Control
    "super+d": "f11",  # afficher le bureau
    "alt+f4": "cmd+q",
    "alt+left": "cmd+[",  # retour (navigateur)
    "alt+right": "cmd+]",
    "f11": "ctrl+cmd+f",  # plein écran
}


def _quartz():
    try:
        import Quartz
    except ImportError as e:
        raise RemoteError("Module Quartz manquant (pyobjc). Réinstalle l'agent ORION.") from e
    return Quartz


def _translate(combo: str) -> list[str]:
    c = combo.lower().replace(" ", "")
    c = TRANSLATE.get(c, c)
    parts = split_combo(c)
    # ctrl+c, ctrl+t… → cmd sur Mac ; on garde ctrl pour ctrl+tab (onglets) et ctrl+flèches (Mission Control).
    if "ctrl" in parts and not ({"tab", "up", "down", "left", "right"} & set(parts)) and "cmd" not in parts:
        parts = ["cmd" if p == "ctrl" else p for p in parts]
    return parts


class RemoteSession(GrabRemoteSession):
    def __init__(self) -> None:
        super().__init__()
        self._held: set[str] = set()  # boutons maintenus (glisser-déposer)

    def _check_permissions(self) -> None:
        Q = _quartz()
        if hasattr(Q, "CGPreflightScreenCaptureAccess") and not Q.CGPreflightScreenCaptureAccess():
            Q.CGRequestScreenCaptureAccess()
            raise RemoteError(
                "Autorise ORION à voir l'écran : Réglages système > Confidentialité et sécurité > "
                "Enregistrement de l'écran, coche ORION Agent, puis réessaie."
            )
        try:
            from ApplicationServices import AXIsProcessTrustedWithOptions, kAXTrustedCheckOptionPrompt

            trusted = AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: True})
        except ImportError:
            trusted = True
        if not trusted:
            raise RemoteError(
                "Autorise ORION à contrôler la souris et le clavier : Réglages système > Confidentialité et sécurité > "
                "Accessibilité, coche ORION Agent, puis réessaie."
            )

    def _screen_size(self) -> tuple[int, int]:
        Q = _quartz()
        b = Q.CGDisplayBounds(Q.CGMainDisplayID())
        return int(b.size.width), int(b.size.height)

    # ------------------------------------------------------------------ souris
    def _pos(self):
        Q = _quartz()
        return Q.CGEventGetLocation(Q.CGEventCreate(None))

    def _post_mouse(self, kind: int, x: float, y: float, button: int = 0) -> None:
        Q = _quartz()
        ev = Q.CGEventCreateMouseEvent(None, kind, (x, y), button)
        Q.CGEventPost(Q.kCGHIDEventTap, ev)

    def _move_event(self) -> int:
        Q = _quartz()
        if "left" in self._held:
            return Q.kCGEventLeftMouseDragged
        if "right" in self._held:
            return Q.kCGEventRightMouseDragged
        return Q.kCGEventMouseMoved

    def _clamp(self, x: float, y: float) -> tuple[float, float]:
        w, h = self.size or self._screen_size()
        return max(0.0, min(w - 1, x)), max(0.0, min(h - 1, y))

    async def move(self, dx: float, dy: float) -> None:
        def go() -> None:
            p = self._pos()
            self._post_mouse(self._move_event(), *self._clamp(p.x + dx, p.y + dy))

        await asyncio.to_thread(go)

    async def move_to(self, fx: float, fy: float) -> None:
        w, h = self.size or self._screen_size()
        await asyncio.to_thread(lambda: self._post_mouse(self._move_event(), *self._clamp(fx * w, fy * h)))

    async def button(self, name: str = "left", state: int | None = None) -> None:
        Q = _quartz()
        kinds = {
            "left": (Q.kCGEventLeftMouseDown, Q.kCGEventLeftMouseUp, Q.kCGMouseButtonLeft),
            "right": (Q.kCGEventRightMouseDown, Q.kCGEventRightMouseUp, Q.kCGMouseButtonRight),
            "middle": (Q.kCGEventOtherMouseDown, Q.kCGEventOtherMouseUp, Q.kCGMouseButtonCenter),
        }
        down, up, btn = kinds.get(name, kinds["left"])

        def go() -> None:
            p = self._pos()
            if state in (None, 1):
                self._post_mouse(down, p.x, p.y, btn)
                self._held.add(name)
            if state in (None, 0):
                self._post_mouse(up, p.x, p.y, btn)
                self._held.discard(name)

        await asyncio.to_thread(go)

    async def scroll(self, dx: float, dy: float) -> None:
        Q = _quartz()

        def go() -> None:
            # Lignes ; positif = vers le haut sur Mac, d'où le signe inversé (dy > 0 = descendre).
            ev = Q.CGEventCreateScrollWheelEvent(None, Q.kCGScrollEventUnitLine, 2, -round(dy) * 3, -round(dx) * 3)
            Q.CGEventPost(Q.kCGHIDEventTap, ev)

        await asyncio.to_thread(go)

    # ------------------------------------------------------------------ clavier
    async def keys(self, combo: str) -> None:
        Q = _quartz()
        parts = _translate(combo)
        flags_map = {"control": Q.kCGEventFlagMaskControl, "shift": Q.kCGEventFlagMaskShift, "option": Q.kCGEventFlagMaskAlternate, "command": Q.kCGEventFlagMaskCommand}
        flags, keys = 0, []
        for p in parts:
            if p in MODIFIERS:
                flags |= flags_map[MODIFIERS[p]]
            elif p in KEYCODES:
                keys.append(KEYCODES[p])
            else:
                raise RemoteError(f"Touche inconnue : {p}")
        if not keys:  # modificateur seul (ex. « super ») : rien de significatif sur Mac
            return

        def go() -> None:
            for code in keys:
                for down in (True, False):
                    ev = Q.CGEventCreateKeyboardEvent(None, code, down)
                    Q.CGEventSetFlags(ev, flags)
                    Q.CGEventPost(Q.kCGHIDEventTap, ev)

        await asyncio.to_thread(go)

    async def type_text(self, text: str) -> None:
        Q = _quartz()

        def go() -> None:
            for ch in text[:2000]:
                if ch == "\n":
                    code = KEYCODES["enter"]
                    for down in (True, False):
                        Q.CGEventPost(Q.kCGHIDEventTap, Q.CGEventCreateKeyboardEvent(None, code, down))
                    continue
                for down in (True, False):
                    ev = Q.CGEventCreateKeyboardEvent(None, 0, down)
                    Q.CGEventKeyboardSetUnicodeString(ev, len(ch.encode("utf-16-le")) // 2, ch)
                    Q.CGEventPost(Q.kCGHIDEventTap, ev)

        await asyncio.to_thread(go)
