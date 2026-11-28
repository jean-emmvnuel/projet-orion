"""Ligne de commande de l'agent ORION.

  orion-agent pair 482913 --server https://core.example.com [--name "Atelier"]
  orion-agent run
  orion-agent info
  orion-agent unpair
  orion-agent gui        (interface graphique)
"""

import argparse
import asyncio
import logging
import sys

from . import __version__
from .config import CONFIG_FILE, AgentConfig
from .platform import current as osmod


def _pair(args) -> int:
    from .pairing import PairingError, pair

    try:
        cfg = pair(args.server, args.code, args.name)
    except PairingError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1
    print(f"✓ « {cfg.name} » est associé à ton compte ORION.")
    print(f"  Configuration : {CONFIG_FILE}")
    print("  Lance maintenant : orion-agent run (ou orion-agent gui)")
    return 0


def _run(_args) -> int:
    cfg = AgentConfig.load()
    if not cfg:
        print("✗ Ce PC n'est pas encore associé. Dans l'app : Appareils > Associer un PC, puis « orion-agent pair <code> ».", file=sys.stderr)
        return 1
    from .client import Agent

    logging.getLogger("orion.agent").info("ORION agent %s — %s (%s)", __version__, cfg.name, osmod.os_version())
    try:
        asyncio.run(Agent(cfg).run())
    except KeyboardInterrupt:
        pass
    return 0


def _info(_args) -> int:
    cfg = AgentConfig.load()
    print(f"ORION agent {__version__} · {osmod.os_version()}")
    print(f"Associé : {'oui — ' + cfg.name + ' sur ' + cfg.server if cfg else 'non'}")
    return 0


def _unpair(_args) -> int:
    AgentConfig.delete()
    print("✓ Association supprimée sur ce PC. Pense aussi à le retirer dans l'app (Appareils).")
    return 0


def _setup(_args) -> int:
    """Vérifie (et installe sous Linux) ce que l'écran en direct et le contrôle à distance demandent."""
    from .services import requirements

    st = requirements.remote_status()
    if st["available"]:
        print("✓ Écran en direct et contrôle à distance : tout est prêt.")
        return 0
    for m in st["missing"]:
        print(f"✗ Manque : {m}")
    for perm in st["permissions"]:
        print(f"✗ Autorisation macOS à donner : Réglages système > Confidentialité et sécurité > {perm} > ORION Agent")
    if st["canInstall"]:
        print("→ Installation (ton mot de passe administrateur va être demandé)…")
        ok, msg = requirements.install(graphical=False)
        print(("✓ " if ok else "✗ ") + msg)
        return 0 if ok else 1
    return 1


def _gui(_args) -> int:
    from .gui import main as gui_main

    gui_main()
    return 0


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    p = argparse.ArgumentParser(prog="orion-agent", description="Agent PC ORION")
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("pair", help="Associer ce PC avec le code affiché dans l'app")
    sp.add_argument("code")
    sp.add_argument("--server", required=True, help="Adresse du Core, ex. https://orion-core.onrender.com")
    sp.add_argument("--name", help="Nom affiché dans l'app (par défaut : nom du PC)")
    sp.set_defaults(fn=_pair)
    sub.add_parser("run", help="Lancer l'agent").set_defaults(fn=_run)
    sub.add_parser("info", help="État de l'agent").set_defaults(fn=_info)
    sub.add_parser("unpair", help="Oublier l'association").set_defaults(fn=_unpair)
    sub.add_parser("gui", help="Ouvrir l'interface graphique").set_defaults(fn=_gui)
    sub.add_parser("setup", help="Vérifier et installer ce qu'il faut pour l'écran en direct").set_defaults(fn=_setup)
    args = p.parse_args()
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()
