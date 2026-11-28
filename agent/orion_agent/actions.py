"""Exécution des actions demandées par l'app. Chaque action renvoie un dict JSON."""

import asyncio
import tempfile
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

from .config import MAX_UPLOAD
from .platform import current as osmod
from .security import display_path, safe_path
from .services import files, system

Upload = Callable[[Path, str], Awaitable[dict]]


class Transfer:
    """Échanges de fichiers avec le Core : dépôt (PC → téléphone) et retrait (téléphone → PC)."""

    def __init__(self, upload: Upload, download: Callable[[str, Path], Awaitable[None]] | None = None):
        self.upload = upload
        self.download = download


class ActionError(Exception):
    """Erreur lisible renvoyée telle quelle à l'app."""


async def run_action(action: str, params: dict, io: Transfer) -> dict:
    handler = HANDLERS.get(action)
    if not handler:
        raise ActionError(f"Action non prise en charge par cet agent : {action}")
    try:
        return await handler(params or {}, io)
    except ActionError:
        raise
    except (PermissionError, FileNotFoundError, NotADirectoryError, ValueError, RuntimeError) as e:
        raise ActionError(str(e)) from e


async def _status(_p: dict, _io: Transfer) -> dict:
    return await asyncio.to_thread(system.metrics)


async def _screenshot(_p: dict, io: Transfer) -> dict:
    tmp = Path(tempfile.gettempdir()) / f"orion_capture_{int(time.time() * 1000)}.png"
    try:
        await asyncio.to_thread(osmod.capture_screen, tmp)
        meta = await io.upload(tmp, f"capture-{time.strftime('%Y%m%d-%H%M%S')}.png")
        size = tmp.stat().st_size
        try:
            from PIL import Image

            with Image.open(tmp) as im:
                w, h = im.size
        except (OSError, ValueError):
            w = h = None
        return {"fileId": meta["id"], "name": meta["name"], "size": size, "width": w, "height": h}
    finally:
        tmp.unlink(missing_ok=True)


async def _lock(_p: dict, _io: Transfer) -> dict:
    await asyncio.to_thread(osmod.lock)
    return {"locked": True}


async def _standby(p: dict, _io: Transfer) -> dict:
    """Veille légère : « enter » verrouille et éteint l'écran sans endormir le PC ; « exit » le réveille."""
    from .services import standby

    op = str(p.get("op") or "status")
    if op == "enter":
        return await asyncio.to_thread(standby.enter)
    if op == "exit":
        return await asyncio.to_thread(standby.exit)
    return {"standby": standby.active()}


async def _unlock(_p: dict, _io: Transfer) -> dict:
    """Déverrouille la session (l'app exige Face ID / le code du téléphone avant d'envoyer cette action)."""
    if await asyncio.to_thread(osmod.is_locked) is False:
        return {"unlocked": True, "already": True}
    ok = await asyncio.to_thread(osmod.unlock)
    if not ok:
        raise ActionError("Le PC est resté verrouillé (l'écran de verrouillage n'a pas répondu).")
    return {"unlocked": True, "already": False}


async def _sleep(_p: dict, _io: Transfer) -> dict:
    # Répond d'abord, met en veille ensuite (sinon la réponse ne partirait jamais).
    asyncio.get_running_loop().call_later(1.5, lambda: asyncio.ensure_future(asyncio.to_thread(osmod.sleep)))
    return {"sleeping": True}


async def _notify(p: dict, _io: Transfer) -> dict:
    title = str(p.get("title") or "ORION")[:80]
    body = str(p.get("body") or "")[:300]
    await asyncio.to_thread(osmod.notify, title, body)
    return {"shown": True}


async def _list(p: dict, _io: Transfer) -> dict:
    return await asyncio.to_thread(files.list_directory, safe_path(p.get("path")), bool(p.get("hidden")))


async def _search(p: dict, _io: Transfer) -> dict:
    root = safe_path(p.get("root"))
    return await asyncio.to_thread(files.search, str(p.get("query") or ""), root)


async def _get(p: dict, io: Transfer) -> dict:
    path = safe_path(p.get("path"))
    if not path.is_file():
        raise ActionError(f"{display_path(path)} n'est pas un fichier.")
    size = path.stat().st_size
    if size > MAX_UPLOAD:
        raise ActionError(f"Fichier trop volumineux ({size // 1024**2} Mo, limite 200 Mo).")
    meta = await io.upload(path, path.name)
    return {"fileId": meta["id"], "name": path.name, "size": size, "path": display_path(path)}


async def _zip(p: dict, io: Transfer) -> dict:
    path = safe_path(p.get("path"))
    archive = await asyncio.to_thread(files.zip_directory, path)
    try:
        size = archive.stat().st_size
        if size > MAX_UPLOAD:
            raise ActionError("L'archive dépasse 200 Mo.")
        meta = await io.upload(archive, f"{path.name or 'dossier'}.zip")
        return {"fileId": meta["id"], "name": meta["name"], "size": size, "path": display_path(path)}
    finally:
        archive.unlink(missing_ok=True)


async def _clip_get(_p: dict, _io: Transfer) -> dict:
    text = await asyncio.to_thread(osmod.clipboard_get)
    return {"text": text[:20_000], "truncated": len(text) > 20_000}


async def _clip_set(p: dict, _io: Transfer) -> dict:
    text = str(p.get("text") or "")
    if not text:
        raise ActionError("Rien à copier.")
    await asyncio.to_thread(osmod.clipboard_set, text[:20_000])
    return {"copied": len(text)}


async def _open_url(p: dict, _io: Transfer) -> dict:
    url = str(p.get("url") or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        url = f"https://{url}" if "." in url and " " not in url else ""
    if not url:
        raise ActionError("Lien invalide : donne une adresse web (https://…).")
    await asyncio.to_thread(osmod.open_url, url)
    return {"url": url}


async def _volume(p: dict, _io: Transfer) -> dict:
    op = str(p.get("op") or "toggle")
    value = p.get("value")
    return await asyncio.to_thread(osmod.volume, op, int(value) if isinstance(value, (int, float)) else None)


async def _media(p: dict, _io: Transfer) -> dict:
    return await asyncio.to_thread(osmod.media, str(p.get("op") or "play-pause"))


async def _power(p: dict, _io: Transfer) -> dict:
    op = str(p.get("op") or "")
    if op not in ("shutdown", "restart"):
        raise ActionError("Opération inconnue (shutdown ou restart).")
    # Répond d'abord, agit ensuite.
    asyncio.get_running_loop().call_later(2, lambda: asyncio.ensure_future(asyncio.to_thread(osmod.power, op)))
    return {"op": op}


async def _open_file(p: dict, _io: Transfer) -> dict:
    """Ouvre un fichier sur le PC avec son application par défaut (vidéo, musique, document…)."""
    path = safe_path(p.get("path"))
    if not path.exists():
        raise ActionError(f"{display_path(path)} est introuvable.")
    await asyncio.to_thread(osmod.open_path, path)
    return {"path": display_path(path), "name": path.name}


async def _receive(p: dict, io: Transfer) -> dict:
    """Fichier envoyé depuis le téléphone : récupéré sur le Core, rangé dans Téléchargements/ORION."""
    from .config import INBOX

    file_id, name = str(p.get("fileId") or ""), Path(str(p.get("name") or "fichier")).name
    if not file_id or not io.download:
        raise ActionError("Fichier introuvable.")
    INBOX.mkdir(parents=True, exist_ok=True)
    dest = INBOX / name
    stem, suffix, n = dest.stem, dest.suffix, 1
    while dest.exists():
        dest = INBOX / f"{stem} ({n}){suffix}"
        n += 1
    await io.download(file_id, dest)
    if p.get("open"):
        await asyncio.to_thread(osmod.open_path, dest)
    return {"path": display_path(dest), "name": dest.name, "size": dest.stat().st_size}


async def _apps_list(_p: dict, _io: Transfer) -> dict:
    from .services import apps

    items = await asyncio.to_thread(apps.list_apps)
    return {"items": items}


async def _apps_open(p: dict, _io: Transfer) -> dict:
    from .services import apps

    return await asyncio.to_thread(apps.open_app, str(p.get("id") or ""))


async def _with_remote(fn):
    from .remote import RemoteUnavailable

    try:
        return await fn()
    except RemoteUnavailable as e:
        raise ActionError(str(e)) from e
    except Exception as e:  # erreurs du portail (refus, session fermée…)
        if e.__class__.__name__ == "RemoteError":
            raise ActionError(str(e)) from e
        raise


async def _keys(p: dict, _io: Transfer) -> dict:
    """Raccourci clavier sur le PC : « ctrl+t », « alt+tab », « enter »…"""
    from .remote import remote

    combo = str(p.get("combo") or "").strip()
    if not combo:
        raise ActionError("Indique un raccourci, par exemple ctrl+t.")
    await _with_remote(lambda: remote.keys(combo))
    return {"combo": combo}


async def _type(p: dict, _io: Transfer) -> dict:
    """Tape un texte dans la fenêtre active du PC (puis Entrée si demandé)."""
    from .remote import remote

    text = str(p.get("text") or "")
    if not text:
        raise ActionError("Texte vide.")

    async def go():
        await remote.type_text(text)
        if p.get("enter"):
            await remote.keys("enter")

    await _with_remote(go)
    return {"length": len(text)}


# Navigation web : raccourcis communs à Chrome, Firefox, Edge, Brave…
WEB_KEYS = {
    "back": "alt+left", "forward": "alt+right", "reload": "ctrl+r", "newtab": "ctrl+t", "closetab": "ctrl+w",
    "nexttab": "ctrl+tab", "prevtab": "ctrl+shift+tab", "zoomin": "ctrl+=", "zoomout": "ctrl+-", "zoomreset": "ctrl+0",
    "fullscreen": "f11", "pagedown": "pagedown", "pageup": "pageup", "top": "home", "bottom": "end",
}


async def _web(p: dict, _io: Transfer) -> dict:
    """Naviguer sur le web : recherche Google, ouvrir une adresse, ou piloter le navigateur au premier plan."""
    from urllib.parse import quote_plus

    from .remote import remote

    op = str(p.get("op") or "search")
    if op == "search":
        q = str(p.get("q") or "").strip()
        if not q:
            raise ActionError("Que faut-il chercher ?")
        url = f"https://www.google.com/search?q={quote_plus(q)}"
        await asyncio.to_thread(osmod.open_url, url)
        return {"op": op, "q": q, "url": url}
    if op == "url":
        url = str(p.get("url") or "").strip()
        if not url:
            raise ActionError("Adresse vide.")
        if "://" not in url:
            url = "https://" + url
        await asyncio.to_thread(osmod.open_url, url)
        return {"op": op, "url": url}
    combo = WEB_KEYS.get(op)
    if not combo:
        raise ActionError(f"Action de navigation inconnue : {op}")
    await _with_remote(lambda: remote.keys(combo))
    return {"op": op}


async def _remote_info(_p: dict, _io: Transfer) -> dict:
    """Le contrôle à distance (écran en direct, souris, clavier) est-il prêt sur ce PC ?"""
    from .services import requirements

    return await asyncio.to_thread(requirements.remote_status)


async def _capabilities(_p: dict, _io: Transfer) -> dict:
    """Ce que cet agent sait faire, avec ce qui est désactivé dans ses réglages."""
    from . import __version__
    from .config import Preferences

    disabled = set(Preferences.load().disabled_actions)
    return {
        "agentVersion": __version__,
        "os": osmod.name,
        "osVersion": osmod.os_version(),
        "actions": [{"action": a, "enabled": a not in disabled} for a in HANDLERS if a != "capabilities"],
    }


HANDLERS: dict[str, Callable[[dict, Transfer], Awaitable[dict]]] = {
    "capabilities": _capabilities,
    "apps.list": _apps_list,
    "apps.open": _apps_open,
    "web": _web,
    "keys": _keys,
    "type": _type,
    "remote": _remote_info,
    "clipboard.get": _clip_get,
    "clipboard.set": _clip_set,
    "open.url": _open_url,
    "volume": _volume,
    "media": _media,
    "power": _power,
    "files.receive": _receive,
    "files.open": _open_file,
    "status": _status,
    "screenshot": _screenshot,
    "lock": _lock,
    "unlock": _unlock,
    "standby": _standby,
    "sleep": _sleep,
    "notify": _notify,
    "files.list": _list,
    "files.search": _search,
    "files.get": _get,
    "files.zip": _zip,
}
