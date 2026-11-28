"""Confinement des chemins au dossier personnel (anti « path traversal »)."""

from pathlib import Path

from .config import HOME


def safe_path(raw: str | None) -> Path:
    """Résout un chemin (absolu, relatif ou « ~/… ») et refuse tout ce qui sort du dossier personnel."""
    text = (raw or "~").strip()
    if text == "~" or text.startswith(("~/", "~\\")):
        path = HOME / text[2:] if len(text) > 1 else HOME
    else:
        path = Path(text)
        if not path.is_absolute():
            path = HOME / path
    resolved = path.resolve()
    if not resolved.is_relative_to(HOME):
        raise PermissionError("Accès refusé : en dehors de ton dossier personnel.")
    return resolved


def display_path(path: Path) -> str:
    """Chemin affichable, relatif au dossier personnel (« ~/Documents/… »)."""
    try:
        rel = path.resolve().relative_to(HOME)
        return "~" if str(rel) == "." else f"~/{rel.as_posix()}"
    except ValueError:
        return str(path)
