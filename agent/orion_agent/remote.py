"""Contrôle à distance : écran en direct, souris et clavier, partagés par toutes les commandes.

- Linux (Wayland/X11) : portail XDG RemoteDesktop + PipeWire/GStreamer (platform/remote_linux.py) ;
- Windows : capture mss + SendInput (platform/remote_windows.py) ;
- macOS : capture mss + Quartz/CGEvent (platform/remote_macos.py).
"""

import asyncio
import contextlib
import logging
import platform
import time
from collections.abc import Awaitable, Callable

log = logging.getLogger("orion.remote")

QUALITY = {  # largeur, images/s max, qualité JPEG
    "fluide": (864, 20, 40),
    "equilibre": (1056, 15, 50),
    "net": (1440, 10, 66),
}
MAX_INFLIGHT = 3  # images envoyées sans accusé de réception du téléphone


class RemoteUnavailable(Exception):
    pass


class RemoteController:
    def __init__(self) -> None:
        self._pending: bytes | None = None
        self._last_sent = 0.0
        self._interval = 0.05
        self._send: Callable[[dict], Awaitable[None]] | None = None
        self._flush_task: asyncio.Task | None = None
        self._session = None
        self._stream_task: asyncio.Task | None = None
        self.inflight = 0
        self.last_ack = 0.0
        self.seq = 0

    def session(self):
        """Session propre au système : portail XDG (Linux), SendInput (Windows), Quartz (macOS)."""
        if self._session is None:
            system = platform.system()
            if system == "Linux":
                from .platform.remote_linux import RemoteSession
            elif system == "Windows":
                from .platform.remote_windows import RemoteSession
            elif system == "Darwin":
                from .platform.remote_macos import RemoteSession
            else:
                raise RemoteUnavailable(f"Contrôle à distance non pris en charge sur {system}.")
            self._session = RemoteSession()
        return self._session

    # ------------------------------------------------------------------ vidéo en direct
    @property
    def streaming(self) -> bool:
        return self._stream_task is not None and not self._stream_task.done()

    async def start_stream(self, send: Callable[[dict], Awaitable[None]], quality: str = "equilibre") -> dict:
        """Démarre l'envoi des images. `send` transmet une image au Core ; le téléphone accuse
        réception (ack) : au plus MAX_INFLIGHT images en transit, les autres sont sautées (jamais de retard)."""
        await self.stop_stream()
        s = self.session()
        await s.start()
        width, fps, q = QUALITY.get(quality, QUALITY["equilibre"])
        self.inflight, self.last_ack, self.seq = 0, time.monotonic(), 0

        interval = 1 / fps
        self._pending, self._last_sent, self._send, self._interval = None, 0.0, send, interval

        async def on_frame(jpeg: bytes) -> None:
            # On garde toujours l'image la plus récente : elle partira dès que la cadence (fps max)
            # et le téléphone (accusés de réception) le permettent. Jamais d'image périmée en fin de geste.
            self._pending = jpeg
            if self.inflight >= MAX_INFLIGHT and time.monotonic() - self.last_ack > 15:
                log.info("Plus d'accusé de réception du téléphone : arrêt de la vidéo")
                await s.stop_video()
                return
            await self._flush(interval)

        async def run() -> None:
            try:
                await s.stream(on_frame, width=width, fps=fps, quality=q)
            except Exception:
                log.exception("Vidéo interrompue")

        self._stream_task = asyncio.create_task(run())
        w, h = s.size or (1920, 1080)
        return {"width": w, "height": h}

    async def _flush(self, interval: float) -> None:
        if self._pending is None or self.inflight >= MAX_INFLIGHT:
            return
        wait = self._last_sent + interval - time.monotonic()
        if wait > 0:
            # Trop tôt : on réessaie au prochain créneau (une seule attente programmée à la fois).
            if not self._flush_task or self._flush_task.done():
                async def later() -> None:
                    await asyncio.sleep(wait)
                    await self._flush(interval)

                self._flush_task = asyncio.create_task(later())
            return
        frame, self._pending = self._pending, None
        self._last_sent = time.monotonic()
        self.seq += 1
        self.inflight += 1
        if self._send:
            await self._send({"seq": self.seq, "data": frame})

    def ack(self) -> None:
        self.inflight = max(0, self.inflight - 1)
        self.last_ack = time.monotonic()
        # Une image attendait que le téléphone suive : elle part maintenant.
        if self._pending is not None:
            asyncio.ensure_future(self._flush(self._interval))

    async def stop_stream(self) -> None:
        self._pending, self._send = None, None
        if self._flush_task:
            self._flush_task.cancel()
        if self._session:
            await self._session.stop_video()
        if self._stream_task:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._stream_task, 3)
        self._stream_task = None

    # ------------------------------------------------------------------ gestes
    async def input(self, ev: dict) -> None:
        s = self.session()
        t = ev.get("t")
        if t == "move":
            await s.move(float(ev.get("dx", 0)), float(ev.get("dy", 0)))
        elif t == "moveTo":
            await s.move_to(float(ev["x"]), float(ev["y"]))
        elif t == "tap":  # toucher un point de la vidéo : y aller puis cliquer
            await s.move_to(float(ev["x"]), float(ev["y"]))
            await s.button(ev.get("button", "left"))
            if ev.get("double"):
                await s.button(ev.get("button", "left"))
        elif t == "click":
            await s.button(ev.get("button", "left"))
        elif t in ("down", "up"):
            await s.button(ev.get("button", "left"), 1 if t == "down" else 0)
        elif t == "scroll":
            await s.scroll(float(ev.get("dx", 0)), float(ev.get("dy", 0)))
        elif t == "key":
            await s.keys(str(ev.get("combo", "")))
        elif t == "text":
            await s.type_text(str(ev.get("text", "")))

    async def keys(self, combo: str) -> None:
        await self.session().keys(combo)

    async def type_text(self, text: str) -> None:
        await self.session().type_text(text)

    async def close(self) -> None:
        await self.stop_stream()
        if self._session:
            await self._session.close()


remote = RemoteController()
