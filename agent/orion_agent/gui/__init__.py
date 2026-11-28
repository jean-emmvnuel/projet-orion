"""Interface graphique de l'agent ORION (Flet) : « orion-agent gui » ou « orion-agent-gui »."""

import logging


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    import flet as ft

    from .app import ASSETS
    from .app import main as app_main

    ft.run(app_main, assets_dir=str(ASSETS))
