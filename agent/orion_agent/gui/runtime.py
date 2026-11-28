"""Pilotage de l'agent depuis l'interface : connexion au Core dans la boucle asyncio de Flet,
journal des commandes, ou suivi du service systemd quand c'est lui qui tourne."""

import asyncio
import logging
from collections import deque
from collections.abc import Callable
from datetime import datetime

from ..client import Agent
from ..config import AgentConfig
from . import service

log = logging.getLogger("orion.gui")

# États affichés : stopped, connecting, online, offline (reconnexion), revoked, service
LABELS = {
    "stopped": "Arrêté",
    "connecting": "Connexion…",
    "online": "Connecté",
    "offline": "Reconnexion…",
    "revoked": "Accès révoqué",
    "unpaired": "Non associé",
}


class AgentRuntime:
    def __init__(self, on_change: Callable[[], None]):
        self.on_change = on_change
        self.cfg: AgentConfig | None = AgentConfig.load()
        self.state = "stopped" if self.cfg else "unpaired"
        self.detail: str | None = None
        self.log: deque[dict] = deque(maxlen=200)
        self.activity = 0  # commandes en cours
        self.since: datetime | None = None
        self.service = {"installed": False, "enabled": False, "active": False}
        self._agent: Agent | None = None
        self._task: asyncio.Task | None = None
        self.on_command: Callable[[dict], None] | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def service_mode(self) -> bool:
        """L'agent tourne via systemd : la fenêtre se contente de le suivre."""
        return bool(self.service.get("active")) and not self.running

    # --- agent intégré -----------------------------------------------------------------------------
    def _event(self, kind: str, data: dict) -> None:
        if kind == "connected":
            self.state, self.detail, self.since = "online", None, datetime.now()
        elif kind == "hello":
            self.detail = f"Reconnu comme « {data.get('name')} »"
            # Renommé depuis le téléphone : la fiche locale suit.
            name = data.get("name")
            if name and self.cfg and name != self.cfg.name:
                self.cfg.name = name
                self.cfg.save()
        elif kind == "disconnected":
            self.state, self.since = "offline", None
        elif kind == "unreachable":
            self.state, self.detail = "offline", "Core injoignable, nouvel essai dans 10 s"
        elif kind == "revoked":
            self.state, self.detail = "revoked", data.get("message") or "Le Core a refusé le jeton de ce PC."
        elif kind == "command":
            self._record(data)
        self.on_change()

    def _record(self, data: dict) -> None:
        entry = next((e for e in self.log if e["id"] == data.get("id")), None)
        if entry is None:
            entry = {"id": data.get("id"), "action": data.get("action"), "time": datetime.now()}
            self.log.appendleft(entry)
        prev = entry.get("status")
        entry["status"], entry["error"] = data.get("status"), data.get("error")
        if entry["status"] == "running":
            self.activity += 1
        elif prev == "running":
            self.activity = max(0, self.activity - 1)
        if self.on_command:
            self.on_command(entry)

    def start(self) -> None:
        if self.running or not self.cfg:
            return
        self.state, self.detail = "connecting", None
        self._agent = Agent(self.cfg, on_event=self._event)
        self._task = asyncio.get_running_loop().create_task(self._run(self._agent))
        self.on_change()

    async def _run(self, agent: Agent) -> None:
        try:
            await agent.run()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # ne doit pas faire tomber la fenêtre
            log.exception("Agent arrêté sur erreur")
            self.detail = f"Erreur : {e}"
        finally:
            if self.state != "revoked":
                self.state = "stopped"
            self.activity, self.since, self._agent = 0, None, None
            self.on_change()

    async def stop(self) -> None:
        if not self.running or not self._agent:
            return
        task = self._task
        try:
            await asyncio.wait_for(self._agent.stop(), 5)
            await asyncio.wait_for(asyncio.shield(task), 5)
        except (TimeoutError, OSError, RuntimeError):
            task.cancel()
        self.state, self.detail = "stopped", None
        self.on_change()

    async def reconfigure(self, cfg: AgentConfig) -> None:
        """Nouvelle fiche (nom, adresse du Core) : la connexion en cours repart avec elle."""
        server_changed = not self.cfg or cfg.server != self.cfg.server
        self.cfg = cfg
        if server_changed:
            if self.running:
                await self.stop()
                self.start()
            elif self.service.get("active"):
                await asyncio.to_thread(service.stop)
                await asyncio.to_thread(service.start)
        self.on_change()

    # --- appairage ---------------------------------------------------------------------------------
    def paired(self, cfg: AgentConfig) -> None:
        self.cfg, self.state, self.detail = cfg, "stopped", None
        self.on_change()

    async def unpair(self) -> None:
        await self.stop()
        if self.service.get("active"):
            await asyncio.to_thread(service.stop)
        AgentConfig.delete()
        self.cfg, self.state, self.detail = None, "unpaired", None
        self.on_change()

    # --- service systemd ---------------------------------------------------------------------------
    async def refresh_service(self) -> None:
        if not service.supported():
            return
        self.service = await asyncio.to_thread(service.status)
        if self.service_mode:
            entries, state = await asyncio.to_thread(service.read_journal)
            known = {e["id"]: e for e in self.log if str(e["id"]).startswith("j")}
            self.log = deque([e for e in self.log if not str(e["id"]).startswith("j")], maxlen=200)
            for e in entries:
                if e["id"] in known and known[e["id"]]["status"] != e["status"] and self.on_command:
                    self.on_command(e)
                self.log.appendleft(e)
            self.log = deque(sorted(self.log, key=lambda e: e["time"], reverse=True), maxlen=200)
            self.state = state or "connecting"
            self.activity = sum(1 for e in entries if e["status"] == "running")
        elif self.state not in ("unpaired", "revoked") and not self.running:
            self.state = "stopped"
        self.on_change()
