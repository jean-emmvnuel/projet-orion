"""Connexion sortante et permanente au Core (Socket.IO), avec reconnexion automatique."""

import asyncio
import contextlib
import logging
from collections.abc import Callable
from pathlib import Path

import httpx
import psutil
import socketio

from . import __version__
from .actions import ActionError, Transfer, run_action
from .config import TELEMETRY_EVERY_S, AgentConfig, Preferences
from .services import system

log = logging.getLogger("orion.agent")
NS = "/agents"

# Rappel facultatif (interface graphique) : on_event(type, données).
# Types : connected, disconnected, hello, revoked, unreachable, command.
EventSink = Callable[[str, dict], None]


class Agent:
    def __init__(self, cfg: AgentConfig, on_event: EventSink | None = None):
        self.cfg = cfg
        self._on_event = on_event
        self._stop = asyncio.Event()
        self.sio = socketio.AsyncClient(reconnection=True, reconnection_delay=2, reconnection_delay_max=30, logger=False)
        self.http = httpx.AsyncClient(base_url=cfg.server, timeout=httpx.Timeout(30, write=300), headers={"Authorization": f"Bearer {cfg.token}"})
        self.revoked = asyncio.Event()
        self._register()

    def _emit(self, kind: str, **data) -> None:
        if self._on_event:
            try:
                self._on_event(kind, data)
            except Exception:
                log.debug("Rappel %s en erreur", kind, exc_info=True)

    def _register(self) -> None:
        sio = self.sio

        @sio.on("connect", namespace=NS)
        async def _connect():
            log.info("Connecté au Core (%s)", self.cfg.server)
            self._emit("connected")

        @sio.on("disconnect", namespace=NS)
        async def _disconnect(*_):
            if self._stop.is_set():
                return
            log.warning("Déconnecté du Core, nouvelle tentative…")
            from .remote import remote

            await remote.stop_stream()
            self._emit("disconnected")

        @sio.on("hello", namespace=NS)
        async def _hello(data):
            log.info("Reconnu comme « %s »", (data or {}).get("name"))
            self._emit("hello", name=(data or {}).get("name"))
            # Le Core a fini de nous authentifier : la télémétrie sera bien prise en compte.
            await self._send_telemetry()

        @sio.on("auth:error", namespace=NS)
        async def _auth_error(data):
            log.error("%s — relance « orion-agent pair <code> » pour réassocier ce PC.", (data or {}).get("message"))
            self.revoked.set()
            self._emit("revoked", message=(data or {}).get("message"))
            asyncio.create_task(self.sio.shutdown())  # sans attendre : on est dans la boucle de lecture

        @sio.on("command", namespace=NS)
        async def _command(cmd):
            asyncio.create_task(self._handle(cmd))

        # --- Bureau à distance : écran en direct + gestes (hors historique, trop fréquents) ---
        @sio.on("remote:start", namespace=NS)
        async def _remote_start(data):
            asyncio.create_task(self._remote_start(data or {}))

        @sio.on("remote:stop", namespace=NS)
        async def _remote_stop(_data=None):
            from .remote import remote

            await remote.stop_stream()
            log.info("Écran en direct arrêté")

        @sio.on("remote:ack", namespace=NS)
        async def _remote_ack(_data=None):
            from .remote import remote

            remote.ack()

        @sio.on("remote:input", namespace=NS)
        async def _remote_input(ev):
            from .remote import remote

            if "remote" in Preferences.load().disabled_actions:
                return
            try:
                await remote.input(ev or {})
            except Exception as e:  # noqa: BLE001 — portail, D-Bus : tout échec est renvoyé au téléphone
                log.warning("Geste à distance refusé : %s", e)
                await self._remote_emit("remote:error", {"message": str(e) or "Geste refusé par le PC."})

    async def _update(self, payload: dict) -> None:
        try:
            await self.sio.emit("command:update", payload, namespace=NS)
        except socketio.exceptions.SocketIOError:
            log.warning("Résultat non transmis (connexion perdue) pour %s", payload.get("id"))

    async def _handle(self, cmd: dict) -> None:
        cid, action, params = cmd.get("id"), cmd.get("action"), cmd.get("params") or {}
        log.info("→ %s %s", action, {k: v for k, v in params.items() if k != "body"})
        if action in Preferences.load().disabled_actions:
            error = "Action désactivée sur ce PC (réglages de l'agent ORION)."
            await self._update({"id": cid, "status": "failed", "error": error})
            self._emit("command", id=cid, action=action, status="failed", error=error)
            log.warning("✗ %s : désactivée dans les réglages", action)
            return
        await self._update({"id": cid, "status": "running"})
        self._emit("command", id=cid, action=action, status="running")
        try:
            result = await run_action(action, params, Transfer(self._upload, self._download))
            await self._update({"id": cid, "status": "done", "result": result})
            self._emit("command", id=cid, action=action, status="done")
            log.info("✓ %s", action)
        except ActionError as e:
            await self._update({"id": cid, "status": "failed", "error": str(e)})
            self._emit("command", id=cid, action=action, status="failed", error=str(e))
            log.warning("✗ %s : %s", action, e)
        except Exception:
            log.exception("Erreur inattendue sur %s", action)
            await self._update({"id": cid, "status": "failed", "error": "Erreur inattendue sur le PC."})
            self._emit("command", id=cid, action=action, status="failed", error="Erreur inattendue sur le PC.")

    async def _remote_emit(self, event: str, payload: dict) -> None:
        with contextlib.suppress(socketio.exceptions.SocketIOError):
            await self.sio.emit(event, payload, namespace=NS)

    async def _remote_start(self, data: dict) -> None:
        from .remote import remote

        if "remote" in Preferences.load().disabled_actions:
            await self._remote_emit("remote:error", {"message": "Contrôle à distance désactivé sur ce PC (réglages de l'agent ORION)."})
            return
        try:
            info = await remote.start_stream(lambda frame: self._remote_emit("remote:frame", frame), str(data.get("quality") or "equilibre"))
        except Exception as e:  # noqa: BLE001 — portail refusé, GStreamer absent… : message pour le téléphone
            log.warning("Écran en direct impossible : %s", e)
            await self._remote_emit("remote:error", {"message": str(e) or "Écran en direct impossible sur ce PC."})
            return
        log.info("Écran en direct démarré (%s)", data.get("quality") or "equilibre")
        self._emit("command", id=f"remote-{int(asyncio.get_running_loop().time())}", action="remote", status="done")
        await self._remote_emit("remote:ready", info)

    async def _download(self, file_id: str, dest: Path) -> None:
        """Récupère sur le Core un fichier envoyé par le téléphone à ce PC."""
        async with self.http.stream("GET", f"/files/{file_id}/agent") as res:
            if res.status_code >= 400:
                raise ActionError(f"Fichier refusé par le Core ({res.status_code}).")
            with dest.open("wb") as f:
                async for chunk in res.aiter_bytes():
                    f.write(chunk)

    async def _upload(self, path: Path, name: str) -> dict:
        """Dépose un fichier sur le Core ; renvoie {id, name, size, …}."""
        with path.open("rb") as f:
            res = await self.http.post("/files", files={"file": (name, f)})
        if res.status_code >= 400:
            raise ActionError(f"Envoi du fichier refusé par le Core ({res.status_code}).")
        return res.json()

    async def _send_telemetry(self) -> None:
        if not self.sio.connected:
            return
        try:
            data = await asyncio.to_thread(system.metrics)
            data["agentVersion"] = __version__
            await self.sio.emit("telemetry", data, namespace=NS)
        except Exception:
            log.debug("Télémétrie non envoyée", exc_info=True)

    async def _telemetry_loop(self) -> None:
        psutil.cpu_percent(interval=None)  # amorce la mesure CPU
        while True:
            await asyncio.sleep(TELEMETRY_EVERY_S)
            await self._send_telemetry()

    async def run(self) -> None:
        telemetry = asyncio.create_task(self._telemetry_loop())
        try:
            while not (self.revoked.is_set() or self._stop.is_set()):
                try:
                    await self.sio.connect(self.cfg.server, namespaces=[NS], auth={"token": self.cfg.token}, transports=["websocket"], wait_timeout=10)
                    await self.sio.wait()
                except socketio.exceptions.ConnectionError as e:
                    log.warning("Core injoignable (%s), nouvel essai dans 10 s", e)
                    self._emit("unreachable", error=str(e))
                    try:
                        await asyncio.wait_for(self._stop.wait(), 10)
                    except TimeoutError:
                        pass
        finally:
            telemetry.cancel()
            await self.http.aclose()
            if self.sio.connected:
                await self.sio.disconnect()

    async def stop(self) -> None:
        """Arrêt propre : coupe la connexion (ou les tentatives) ; run() se termine ensuite."""
        self._stop.set()
        await self.sio.shutdown()
