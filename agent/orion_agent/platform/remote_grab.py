"""Base commune du bureau à distance pour Windows et macOS : capture d'écran avec `mss`,
encodage JPEG avec Pillow, cadence limitée, images identiques non renvoyées.

Les sous-classes (remote_windows, remote_macos) fournissent la souris et le clavier.
"""

import asyncio
import hashlib
import io
import logging
import time
from collections.abc import Awaitable, Callable

log = logging.getLogger("orion.remote")


class RemoteError(Exception):
    """Message lisible à renvoyer à l'app."""


class GrabRemoteSession:
    def __init__(self) -> None:
        self.size: tuple[int, int] | None = None  # taille logique de l'écran principal
        self._started = False
        self._streaming = False

    @property
    def active(self) -> bool:
        return self._started

    # --- à fournir par chaque système ---------------------------------------------------------------
    def _check_permissions(self) -> None:
        """Lève RemoteError avec la marche à suivre si une autorisation manque."""

    def _screen_size(self) -> tuple[int, int]:
        raise NotImplementedError

    async def move(self, dx: float, dy: float) -> None:
        raise NotImplementedError

    async def move_to(self, fx: float, fy: float) -> None:
        raise NotImplementedError

    async def button(self, name: str = "left", state: int | None = None) -> None:
        raise NotImplementedError

    async def scroll(self, dx: float, dy: float) -> None:
        raise NotImplementedError

    async def keys(self, combo: str) -> None:
        raise NotImplementedError

    async def type_text(self, text: str) -> None:
        raise NotImplementedError

    # --- commun ----------------------------------------------------------------------------------------
    async def start(self) -> None:
        if self._started:
            return
        try:
            import mss  # noqa: F401
        except ImportError as e:
            raise RemoteError("Module de capture manquant (mss). Réinstalle l'agent ORION.") from e
        await asyncio.to_thread(self._check_permissions)
        self.size = await asyncio.to_thread(self._screen_size)
        self._started = True

    async def close(self) -> None:
        await self.stop_video()
        self._started = False

    async def stream(self, on_frame: Callable[[bytes], Awaitable[None]], width: int = 1280, fps: int = 10, quality: int = 60) -> None:
        if not self._started:
            await self.start()
        self._streaming = True
        grab = _Grabber(width, quality)
        interval, last_digest = 1 / fps, None
        try:
            while self._streaming:
                t0 = time.monotonic()
                jpeg, digest = await asyncio.to_thread(grab.frame)
                # Écran immobile : rien à envoyer (sauf une image par seconde pour rester vivant).
                if digest != last_digest or time.monotonic() - grab.last_sent > 1:
                    last_digest, grab.last_sent = digest, time.monotonic()
                    await on_frame(jpeg)
                await asyncio.sleep(max(0.0, interval - (time.monotonic() - t0)))
        finally:
            grab.close()
            self._streaming = False

    async def stop_video(self) -> None:
        self._streaming = False


class _Grabber:
    """Capture de l'écran principal, réduite à `width` pixels de large et encodée en JPEG."""

    def __init__(self, width: int, quality: int) -> None:
        import mss

        self.sct = mss.mss()
        self.mon = self.sct.monitors[1]  # écran principal
        self.width, self.quality, self.last_sent = width, quality, 0.0

    def frame(self) -> tuple[bytes, bytes]:
        from PIL import Image

        shot = self.sct.grab(self.mon)
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
        w = min(self.width, img.width)
        h = round(img.height * w / img.width / 2) * 2
        small = img.resize((w, h), Image.Resampling.BILINEAR)
        digest = hashlib.blake2b(small.tobytes()[::97], digest_size=8).digest()  # empreinte rapide
        buf = io.BytesIO()
        small.save(buf, "JPEG", quality=self.quality, optimize=False)
        return buf.getvalue(), digest

    def close(self) -> None:
        try:
            self.sct.close()
        except Exception:
            log.debug("Fermeture de la capture", exc_info=True)


def split_combo(combo: str) -> list[str]:
    parts = [p.strip().lower() for p in combo.split("+") if p.strip()]
    if not parts:
        raise RemoteError("Raccourci vide.")
    return parts
