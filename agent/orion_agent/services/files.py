"""Exploration, recherche et archivage de fichiers, confinés au dossier personnel."""

import os
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from ..config import HOME, IGNORED_DIRS, MAX_FIND_DEPTH, MAX_FIND_RESULTS, MAX_LIST, MAX_PRE_ZIP
from ..security import display_path


def _entry(e: os.DirEntry) -> dict | None:
    try:
        is_dir = e.is_dir(follow_symlinks=False)
        st = e.stat(follow_symlinks=False)
    except OSError:
        return None
    return {
        "name": e.name,
        "path": display_path(Path(e.path)),
        "kind": "folder" if is_dir else "file",
        "size": None if is_dir else st.st_size,
        "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
        "hidden": e.name.startswith("."),
    }


def list_directory(path: Path, show_hidden: bool = False) -> dict:
    if not path.is_dir():
        raise NotADirectoryError(f"{display_path(path)} n'est pas un dossier.")
    with os.scandir(path) as it:
        raw = [e for e in it if show_hidden or not e.name.startswith(".")]
    raw.sort(key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
    items = [x for x in (_entry(e) for e in raw[:MAX_LIST]) if x]
    return {"path": display_path(path), "items": items, "truncated": len(raw) > MAX_LIST}


def _norm(text: str) -> str:
    """Minuscules, sans accents, séparateurs (_ - .) changés en espaces : « Cahier_des-charges » ≈ « cahier des charges »."""
    import re
    import unicodedata

    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    return re.sub(r"[\s_.\-]+", " ", t).strip()


def search(query: str, root: Path = HOME) -> dict:
    """Recherche par nom, profondeur et nombre de résultats bornés (ne fige jamais le PC)."""
    q = _norm(query)
    if len(q) < 2:
        raise ValueError("La recherche doit contenir au moins 2 caractères.")
    results: list[dict] = []
    stack: list[tuple[str, int]] = [(str(root), 0)]
    while stack and len(results) < MAX_FIND_RESULTS:
        current, depth = stack.pop()
        try:
            with os.scandir(current) as it:
                for e in it:
                    if e.name.startswith(".") or e.name in IGNORED_DIRS:
                        continue
                    try:
                        if e.is_dir(follow_symlinks=False):
                            if depth < MAX_FIND_DEPTH:
                                stack.append((e.path, depth + 1))
                        elif q in _norm(e.name):
                            item = _entry(e)
                            if item:
                                results.append(item)
                                if len(results) >= MAX_FIND_RESULTS:
                                    break
                    except OSError:
                        continue
        except OSError:
            continue
    return {"query": query, "items": results, "truncated": len(results) >= MAX_FIND_RESULTS}


def zip_directory(path: Path) -> Path:
    """Archive un dossier (refus immédiat au-delà de 300 Mo bruts, compression rapide)."""
    if not path.is_dir():
        raise NotADirectoryError(f"{display_path(path)} n'est pas un dossier.")
    files: list[tuple[str, str]] = []
    total = 0
    for root, dirs, names in os.walk(path):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]
        for n in names:
            if n.startswith("."):
                continue
            full = os.path.join(root, n)
            try:
                total += os.path.getsize(full)
            except OSError:
                continue
            if total > MAX_PRE_ZIP:
                raise ValueError("Ce dossier dépasse 300 Mo : archive annulée pour préserver le PC.")
            files.append((full, os.path.relpath(full, path)))
    if not files:
        raise ValueError("Le dossier est vide.")
    fd, tmp = tempfile.mkstemp(suffix=".zip", prefix=f"orion_{path.name}_")
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
        for full, rel in files:
            try:
                zf.write(full, rel)
            except OSError:
                continue
    return Path(tmp)
