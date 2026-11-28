"""Bureau à distance sous Linux (Wayland et X11) via le portail XDG « RemoteDesktop ».

Une seule session fournit :
- la **vidéo** de l'écran (flux PipeWire, encodé en JPEG par GStreamer) ;
- le **clavier et la souris** (Notify* du portail), sans ydotool ni droits root.

La première fois, GNOME demande l'autorisation sur le PC ; le portail renvoie un
« restore token » enregistré dans la configuration : ensuite plus aucune fenêtre.
"""

import asyncio
import contextlib
import json
import logging
import secrets
from collections.abc import Awaitable, Callable

from dbus_next import BusType, Message, MessageType, Variant
from dbus_next.aio import MessageBus

from ..config import config_dir

log = logging.getLogger("orion.remote")

PORTAL = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
RD = "org.freedesktop.portal.RemoteDesktop"
SC = "org.freedesktop.portal.ScreenCast"
TOKEN_FILE = config_dir() / "remote.json"

# Codes evdev des boutons de souris.
BUTTONS = {"left": 0x110, "right": 0x111, "middle": 0x112}

# Touches nommées → keysym X11 (xkbcommon).
KEYSYMS = {
    "enter": 0xFF0D, "return": 0xFF0D, "tab": 0xFF09, "escape": 0xFF1B, "esc": 0xFF1B, "backspace": 0xFF08,
    "delete": 0xFFFF, "space": 0x20, "home": 0xFF50, "end": 0xFF57, "pageup": 0xFF55, "pagedown": 0xFF56,
    "left": 0xFF51, "up": 0xFF52, "right": 0xFF53, "down": 0xFF54,
    "ctrl": 0xFFE3, "control": 0xFFE3, "shift": 0xFFE1, "alt": 0xFFE9, "super": 0xFFEB, "meta": 0xFFEB, "win": 0xFFEB,
    **{f"f{i}": 0xFFBE + i - 1 for i in range(1, 13)},
}


def keysym_for(ch: str) -> int:
    """Keysym d'un caractère : Latin-1 direct, sinon plage Unicode de xkbcommon."""
    cp = ord(ch)
    if ch == "\n":
        return KEYSYMS["enter"]
    if ch == "\t":
        return KEYSYMS["tab"]
    return cp if 0x20 <= cp <= 0xFF else 0x01000000 + cp


class RemoteError(Exception):
    """Message lisible à renvoyer à l'app."""


class RemoteSession:
    def __init__(self) -> None:
        self.bus: MessageBus | None = None
        self.session: str | None = None
        self.node: int | None = None
        self.size: tuple[int, int] | None = None
        self._gst: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    @property
    def active(self) -> bool:
        return self.session is not None

    # ------------------------------------------------------------------ portail
    async def _request(self, iface: str, member: str, signature: str, body: list, options: dict) -> dict:
        """Appel de portail qui répond via un objet Request : attend son signal Response."""
        assert self.bus
        token = "orion_" + secrets.token_hex(6)
        options = {**options, "handle_token": Variant("s", token)}
        sender = self.bus.unique_name.lstrip(":").replace(".", "_")
        path = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"
        fut: asyncio.Future = asyncio.get_running_loop().create_future()

        def handler(msg: Message) -> None:
            if msg.message_type == MessageType.SIGNAL and msg.member == "Response" and msg.path == path and not fut.done():
                fut.set_result(msg.body)

        self.bus.add_message_handler(handler)
        try:
            reply = await self.bus.call(Message(destination=PORTAL, path=PATH, interface=iface, member=member, signature=signature, body=[*body, options]))
            if reply.message_type == MessageType.ERROR:
                raise RemoteError(f"Portail : {reply.error_name} {reply.body}")
            code, results = await asyncio.wait_for(fut, 120)  # laisse le temps d'accepter sur le PC
        finally:
            self.bus.remove_message_handler(handler)
        if code == 1:
            raise RemoteError("Contrôle à distance refusé sur le PC.")
        if code != 0:
            raise RemoteError("Le PC n'a pas pu ouvrir la session de contrôle à distance.")
        return {k: v.value for k, v in results.items()}

    async def start(self) -> None:
        """Ouvre la session (une fenêtre d'autorisation la première fois seulement)."""
        async with self._lock:
            if self.active:
                return
            self.bus = await MessageBus(bus_type=BusType.SESSION, negotiate_unix_fd=True).connect()
            await self.bus.call(Message(
                destination="org.freedesktop.DBus", path="/org/freedesktop/DBus", interface="org.freedesktop.DBus",
                member="AddMatch", signature="s",
                body=["type='signal',interface='org.freedesktop.portal.Request',member='Response'"],
            ))
            try:
                res = await self._request(RD, "CreateSession", "a{sv}", [], {"session_handle_token": Variant("s", "orion" + secrets.token_hex(4))})
                session = res["session_handle"]
                restore = _load_token()
                dev_opts = {"types": Variant("u", 3), "persist_mode": Variant("u", 2)}
                if restore:
                    dev_opts["restore_token"] = Variant("s", restore)
                await self._request(RD, "SelectDevices", "oa{sv}", [session], dev_opts)
                await self._request(SC, "SelectSources", "oa{sv}", [session], {
                    "types": Variant("u", 1),  # écran
                    "multiple": Variant("b", False),
                    "cursor_mode": Variant("u", 2),  # curseur incrusté dans la vidéo
                })
                started = await self._request(RD, "Start", "osa{sv}", [session, ""], {})
            except Exception:
                await self.close()
                raise
            if started.get("restore_token"):
                _save_token(started["restore_token"])
            streams = started.get("streams") or []
            if not streams:
                await self.close()
                raise RemoteError("Aucun écran partagé par le PC.")
            node, props = streams[0]
            self.session, self.node = session, int(node)
            size = props.get("size")
            self.size = tuple(size.value) if size else None
            log.info("Session de contrôle à distance ouverte (écran %s, nœud %s)", self.size, self.node)

    async def close(self) -> None:
        await self.stop_video()
        if self.bus and self.session:
            with contextlib.suppress(Exception):
                await self.bus.call(Message(destination=PORTAL, path=self.session, interface="org.freedesktop.portal.Session", member="Close"))
        if self.bus:
            self.bus.disconnect()
        self.bus, self.session, self.node = None, None, None

    async def _notify(self, member: str, signature: str, *args) -> None:
        if not self.active:
            await self.start()
        assert self.bus and self.session
        reply = await self.bus.call(Message(destination=PORTAL, path=PATH, interface=RD, member=member, signature="oa{sv}" + signature, body=[self.session, {}, *args]))
        if reply.message_type == MessageType.ERROR:
            # Session fermée côté PC (verrouillage, fermeture…) : on la rouvrira au prochain geste.
            await self.close()
            raise RemoteError("La session de contrôle a été fermée sur le PC. Réessaie.")

    # ------------------------------------------------------------------ souris et clavier
    async def move(self, dx: float, dy: float) -> None:
        await self._notify("NotifyPointerMotion", "dd", float(dx), float(dy))

    async def move_to(self, fx: float, fy: float) -> None:
        """Position absolue en fraction de l'écran (0–1), pour toucher un point de la vidéo."""
        if not self.active:
            await self.start()
        w, h = self.size or (1920, 1080)
        await self._notify("NotifyPointerMotionAbsolute", "udd", self.node, max(0.0, min(1.0, fx)) * w, max(0.0, min(1.0, fy)) * h)

    async def button(self, name: str = "left", state: int | None = None) -> None:
        code = BUTTONS.get(name, BUTTONS["left"])
        if state is None:  # clic complet
            await self._notify("NotifyPointerButton", "iu", code, 1)
            await self._notify("NotifyPointerButton", "iu", code, 0)
        else:
            await self._notify("NotifyPointerButton", "iu", code, state)

    async def scroll(self, dx: float, dy: float) -> None:
        if dy:
            await self._notify("NotifyPointerAxisDiscrete", "ui", 0, round(dy))
        if dx:
            await self._notify("NotifyPointerAxisDiscrete", "ui", 1, round(dx))

    async def _key(self, keysym: int, state: int) -> None:
        await self._notify("NotifyKeyboardKeysym", "iu", keysym, state)

    async def keys(self, combo: str) -> None:
        """Raccourci « ctrl+shift+t », « alt+left », « enter »…"""
        parts = [p.strip().lower() for p in combo.split("+") if p.strip()]
        if not parts:
            raise RemoteError("Raccourci vide.")
        syms = [KEYSYMS.get(p) or (keysym_for(p) if len(p) == 1 else None) for p in parts]
        if any(s is None for s in syms):
            raise RemoteError(f"Touche inconnue dans « {combo} ».")
        for s in syms:
            await self._key(s, 1)
        for s in reversed(syms):
            await self._key(s, 0)

    async def type_text(self, text: str) -> None:
        for ch in text[:2000]:
            ks = keysym_for(ch)
            await self._key(ks, 1)
            await self._key(ks, 0)

    # ------------------------------------------------------------------ vidéo
    async def stream(self, on_frame: Callable[[bytes], Awaitable[None]], width: int = 1280, fps: int = 8, quality: int = 60) -> None:
        """Encode l'écran en JPEG et appelle `on_frame` pour chaque image, jusqu'à stop_video()."""
        if not self.active:
            await self.start()
        await self.stop_video()
        assert self.bus and self.session
        reply = await self.bus.call(Message(destination=PORTAL, path=PATH, interface=SC, member="OpenPipeWireRemote", signature="oa{sv}", body=[self.session, {}], unix_fds=[]))
        if reply.message_type == MessageType.ERROR:
            raise RemoteError("Impossible d'ouvrir le flux vidéo de l'écran.")
        fd = reply.unix_fds[reply.body[0]]
        sw, sh = self.size or (1920, 1080)
        width = min(width, sw)
        height = round(width * sh / sw / 2) * 2  # mêmes proportions que l'écran, valeur paire
        pipeline = (
            # Faible latence : file qui ne garde que l'image la plus récente, cadence plafonnée sans
            # dupliquer d'images (écran immobile = rien à envoyer), mise à l'échelle avant conversion.
            f"pipewiresrc fd={fd} path={self.node} do-timestamp=true keepalive-time=1000 always-copy=true ! "
            "queue leaky=downstream max-size-buffers=1 max-size-time=0 max-size-bytes=0 ! "
            f"videorate drop-only=true max-rate={fps} ! videoscale ! "
            f"video/x-raw,width={width},height={height},pixel-aspect-ratio=1/1 ! videoconvert ! jpegenc quality={quality} ! "
            "multipartmux boundary=orionframe ! fdsink fd=1 sync=false"
        )
        self._gst = await asyncio.create_subprocess_exec(
            "gst-launch-1.0", "-q", *pipeline.split(), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, pass_fds=(fd,)
        )
        with contextlib.suppress(OSError):
            import os
            os.close(fd)
        out = self._gst.stdout
        assert out
        try:
            while True:
                header = await out.readuntil(b"\r\n\r\n")
                length = next((int(line.split(b":", 1)[1]) for line in header.split(b"\r\n") if line.lower().startswith(b"content-length")), None)
                if length is None:
                    continue
                frame = await out.readexactly(length)
                await on_frame(frame)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
            pass
        finally:
            await self.stop_video()

    async def stop_video(self) -> None:
        if self._gst and self._gst.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self._gst.terminate()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._gst.wait(), 3)
        self._gst = None


def _load_token() -> str | None:
    with contextlib.suppress(OSError, ValueError, KeyError):
        return json.loads(TOKEN_FILE.read_text())["restore_token"]
    return None


def _save_token(token: str) -> None:
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps({"restore_token": token}))
    with contextlib.suppress(OSError):
        TOKEN_FILE.chmod(0o600)
