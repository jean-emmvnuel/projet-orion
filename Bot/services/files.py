import os
import zipfile
import tempfile
from pathlib import Path
from config import RACINE, IGNORED_DIRS, MAX_FIND_RESULTS, MAX_FIND_DEPTH, MAX_PRE_ZIP_SIZE


def list_directory(dir_path: Path, max_items: int = 30) -> tuple[list[Path], bool]:
    """
    Liste le contenu d'un dossier de manière optimisée avec os.scandir (évite les appels stat inutiles).
    Trie les répertoires d'abord, puis les fichiers visibles, puis les fichiers cachés.
    Retourne la liste des éléments et un booléen indiquant s'il y a d'autres éléments non affichés.
    """
    entries = []
    try:
        with os.scandir(dir_path) as it:
            for entry in it:
                try:
                    entries.append(entry)
                except OSError:
                    continue
    except PermissionError:
        raise PermissionError(f"Accès refusé au dossier : {dir_path.name}")

    def sort_key(e: os.DirEntry):
        try:
            is_dir = e.is_dir(follow_symlinks=False)
        except OSError:
            is_dir = False
        is_hidden = e.name.startswith(".")
        return (0 if is_dir else 1, 1 if is_hidden else 0, e.name.lower())

    entries.sort(key=sort_key)
    has_more = len(entries) > max_items
    paths = [Path(e.path) for e in entries[:max_items]]
    return paths, has_more


def search_files(query: str, root_path: Path = RACINE, max_results: int = MAX_FIND_RESULTS, max_depth: int = MAX_FIND_DEPTH) -> list[Path]:
    """
    Recherche rapide et bornée par motif dans les noms de fichiers.
    Utilise os.scandir avec contrôle strict de la profondeur (max_depth) pour éviter les boucles
    et l'épuisement du CPU/disque sur les gros répertoires.
    """
    query_lower = query.strip().lower()
    results: list[Path] = []
    stack: list[tuple[str, int]] = [(str(root_path), 0)]

    while stack and len(results) < max_results:
        current_dir, depth = stack.pop()
        if depth > max_depth:
            continue

        try:
            with os.scandir(current_dir) as it:
                for entry in it:
                    name = entry.name
                    # Ignorer les répertoires et fichiers cachés ou exclus
                    if name.startswith(".") or name in IGNORED_DIRS:
                        continue

                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if depth < max_depth:
                                stack.append((entry.path, depth + 1))
                        elif entry.is_file(follow_symlinks=False):
                            if query_lower in name.lower():
                                results.append(Path(entry.path))
                                if len(results) >= max_results:
                                    break
                    except OSError:
                        continue
        except (PermissionError, OSError):
            continue

    return results


def create_zip_archive(dir_path: Path) -> Path:
    """
    Compresse un dossier de manière optimisée :
    1. Pré-contrôle rapide de la taille cumulée : refuse immédiatement si > 100 Mo pour économiser le CPU.
    2. Compression rapide (compresslevel=1) pour minimiser la charge processeur.
    """
    # 1. Pré-contrôle de la taille totale avant compression (O(N) léger)
    total_uncompressed = 0
    file_list: list[tuple[str, str]] = []  # (full_path, relative_arcname)

    for root, dirs, files in os.walk(dir_path):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]
        for f in files:
            if f.startswith("."):
                continue
            full_p = os.path.join(root, f)
            try:
                size = os.path.getsize(full_p)
                total_uncompressed += size
                if total_uncompressed > MAX_PRE_ZIP_SIZE:
                    raise ValueError("Le dossier dépasse 100 Mo de données brutes. Opération annulée pour préserver les ressources.")
                rel_p = os.path.relpath(full_p, dir_path)
                file_list.append((full_p, rel_p))
            except OSError:
                continue

    if not file_list:
        raise ValueError("Le dossier est vide ou ne contient aucun fichier éligible.")

    # 2. Création de l'archive zip
    fd, tmp_file = tempfile.mkstemp(suffix=".zip", prefix=f"orion_{dir_path.name}_")
    os.close(fd)
    tmp_path = Path(tmp_file)

    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
            for full_p, rel_p in file_list:
                try:
                    zf.write(full_p, rel_p)
                except OSError:
                    continue
        return tmp_path
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise
