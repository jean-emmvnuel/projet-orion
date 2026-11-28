"""Appairage d'un PC avec le code à 6 chiffres affiché dans l'app (partagé par la CLI et l'interface)."""

import socket

import httpx

from .config import AgentConfig
from .platform import current as osmod


class PairingError(Exception):
    """Message lisible à afficher tel quel."""


def normalize_server(server: str) -> str:
    """Ajoute le schéma s'il manque : http pour une adresse locale (Core de dev), https sinon."""
    server = server.strip().rstrip("/")
    if server and "://" not in server:
        host = server.split("/")[0].rsplit(":", 1)[0]
        local = host == "localhost" or host.endswith(".local") or host.startswith(("127.", "10.", "192.168."))
        server = ("http://" if local else "https://") + server
    return server


def _request(code: str, name: str | None) -> dict:
    return {
        "code": code.strip(),
        "name": (name or "").strip() or socket.gethostname(),
        "os": osmod.name,
        "osVersion": osmod.os_version(),
        "hostname": socket.gethostname(),
    }


def _result(server: str, res: httpx.Response) -> AgentConfig:
    if res.status_code >= 400:
        try:
            msg = res.json().get("message")
        except ValueError:
            msg = None
        if isinstance(msg, list):
            msg = " ".join(map(str, msg))
        raise PairingError(f"Appairage refusé : {msg or res.text or res.status_code}")
    data = res.json()
    cfg = AgentConfig(server=server, device_id=data["device"]["id"], token=data["token"], name=data["device"]["name"])
    cfg.save()
    return cfg


def pair(server: str, code: str, name: str | None = None) -> AgentConfig:
    server = normalize_server(server)
    try:
        res = httpx.post(f"{server}/devices/pair", json=_request(code, name), timeout=15)
    except httpx.HTTPError as e:
        raise PairingError(f"Core injoignable : {e}") from e
    return _result(server, res)


async def pair_async(server: str, code: str, name: str | None = None) -> AgentConfig:
    server = normalize_server(server)
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.post(f"{server}/devices/pair", json=_request(code, name))
    except httpx.HTTPError as e:
        raise PairingError(f"Core injoignable : {e or type(e).__name__}") from e
    return _result(server, res)


async def update_device(cfg: AgentConfig, name: str | None = None, server: str | None = None) -> AgentConfig:
    """Renomme ce PC et/ou change l'adresse du Core.

    La modification est validée par le Core (avec le jeton du PC) avant d'être enregistrée :
    une nouvelle adresse n'est acceptée que si elle mène bien au Core qui connaît ce PC.
    """
    target = normalize_server(server) if server is not None else cfg.server
    new_name = (name if name is not None else cfg.name).strip()
    if not target:
        raise PairingError("Indique l'adresse du Core.")
    if not 1 <= len(new_name) <= 60:
        raise PairingError("Le nom doit faire entre 1 et 60 caractères.")
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.patch(
                f"{target}/devices/self",
                json={"name": new_name},
                headers={"Authorization": f"Bearer {cfg.token}"},
            )
    except httpx.HTTPError as e:
        raise PairingError(f"Core injoignable à cette adresse : {e or type(e).__name__}") from e
    if res.status_code == 401:
        raise PairingError("Ce Core ne reconnaît pas ce PC : vérifie l'adresse, ou réassocie le PC.")
    if res.status_code >= 400:
        try:
            msg = res.json().get("message")
        except ValueError:
            msg = None
        if isinstance(msg, list):
            msg = " ".join(map(str, msg))
        raise PairingError(f"Modification refusée : {msg or res.status_code}")
    try:
        data = res.json()
    except ValueError:
        data = None
    # Il faut que ce soit bien le Core qui connaît ce PC, pas un autre serveur qui répond.
    if not isinstance(data, dict) or data.get("id") != cfg.device_id:
        raise PairingError("Cette adresse ne mène pas au Core ORION de ce PC.")
    updated = AgentConfig(server=target, device_id=cfg.device_id, token=cfg.token, name=data.get("name") or new_name)
    updated.save()
    return updated
