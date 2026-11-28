"""Veille légère : la session est verrouillée et l'écran éteint, mais le PC ne dort pas,
pour rester joignable et pouvoir être « réveillé » depuis le téléphone.

(Une vraie veille coupe l'agent et le réseau : le réveil à distance demanderait un Wake-on-LAN
et une autre machine allumée sur le même réseau.)
"""

import contextlib
import logging
import threading

from ..platform import current as osmod

log = logging.getLogger("orion.standby")

_lock = threading.Lock()
_inhibitor = None


def active() -> bool:
    return _inhibitor is not None


def enter() -> dict:
    """Verrouille, empêche la vraie veille, éteint l'écran."""
    global _inhibitor
    with _lock:
        if _inhibitor is None:
            _inhibitor = osmod.keep_awake()
    osmod.lock()
    osmod.display_off()
    log.info("Veille légère : écran éteint, PC joignable")
    return {"standby": True}


def exit() -> dict:
    """Rallume l'écran et rend la main à la gestion d'énergie normale."""
    global _inhibitor
    with contextlib.suppress(Exception):
        osmod.display_on()
    with _lock:
        if _inhibitor is not None:
            with contextlib.suppress(Exception):
                _inhibitor.terminate()
            _inhibitor = None
    log.info("Réveil : écran rallumé")
    return {"standby": False}


def check() -> None:
    """Appelé régulièrement : si quelqu'un a déverrouillé le PC sur place, la veille légère s'arrête."""
    if not active():
        return
    with contextlib.suppress(Exception):
        if osmod.is_locked() is False:
            log.info("Session déverrouillée sur le PC : fin de la veille légère")
            exit()
