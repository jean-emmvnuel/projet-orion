"""Ce dont l'écran en direct et le contrôle à distance ont besoin, selon le système, et leur installation.

- Les modules Python (dbus-next, mss, pyobjc) sont embarqués dans l'application à la construction
  (`flet build`, dépendances par plateforme dans pyproject.toml).
- Sous Linux, GStreamer et son greffon PipeWire sont des paquets du système : l'agent les détecte
  et peut les installer (fenêtre d'administration du système, le mot de passe est saisi par l'utilisateur).
- Sous macOS, deux autorisations sont à donner dans les Réglages système.
"""

import importlib.util
import platform
import shutil
import subprocess

SYSTEM = platform.system()

# Paquets système par gestionnaire (Linux).
LINUX_PACKAGES = {
    "apt-get": ["gstreamer1.0-tools", "gstreamer1.0-pipewire", "gstreamer1.0-plugins-good", "gstreamer1.0-plugins-base", "libgtk-3-bin"],
    "dnf": ["gstreamer1-plugins-base-tools", "pipewire-gstreamer", "gstreamer1-plugins-good", "gtk3"],
    "pacman": ["gstreamer", "gst-plugin-pipewire", "gst-plugins-good", "gst-plugins-base", "gtk3"],
    "zypper": ["gstreamer-tools", "gstreamer-plugin-pipewire", "gstreamer-plugins-good", "gtk3-tools"],
}


def _gst_has(element: str) -> bool:
    if not shutil.which("gst-inspect-1.0"):
        return False
    try:
        return subprocess.run(["gst-inspect-1.0", element], check=False, capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def package_manager() -> str | None:
    return next((pm for pm in LINUX_PACKAGES if shutil.which(pm)), None)


def missing() -> list[str]:
    """Composants manquants, en clair."""
    out: list[str] = []
    if SYSTEM == "Linux":
        if not shutil.which("gst-launch-1.0"):
            out.append("GStreamer (outils)")
        if not _gst_has("pipewiresrc"):
            out.append("GStreamer PipeWire (capture de l'écran)")
        if not _gst_has("jpegenc"):
            out.append("GStreamer plugins good (encodage JPEG)")
        if not _module("dbus_next"):
            out.append("dbus-next (module Python)")
        if not shutil.which("gtk-launch"):
            out.append("gtk-launch (ouvrir les applications)")
    elif SYSTEM == "Windows":
        if not _module("mss"):
            out.append("mss (module Python de capture)")
    elif SYSTEM == "Darwin":
        if not _module("mss"):
            out.append("mss (module Python de capture)")
        if not _module("Quartz"):
            out.append("pyobjc Quartz (souris et clavier)")
    return out


def mac_permissions() -> list[str]:
    """Autorisations macOS encore à donner."""
    if SYSTEM != "Darwin":
        return []
    todo = []
    try:
        import Quartz

        if hasattr(Quartz, "CGPreflightScreenCaptureAccess") and not Quartz.CGPreflightScreenCaptureAccess():
            todo.append("Enregistrement de l'écran")
    except ImportError:
        pass
    try:
        from ApplicationServices import AXIsProcessTrusted

        if not AXIsProcessTrusted():
            todo.append("Accessibilité")
    except ImportError:
        pass
    return todo


def remote_status() -> dict:
    miss, perms = missing(), mac_permissions()
    pm = package_manager() if SYSTEM == "Linux" else None
    # Seuls des paquets système (Linux) s'installent après coup ; les modules Python sont embarqués.
    system_only = all("module Python" not in m for m in miss)
    return {
        "platform": SYSTEM,
        "available": not miss and not perms,
        "missing": miss,
        "permissions": perms,
        "canInstall": bool(miss) and SYSTEM == "Linux" and pm is not None and system_only,
        "installCommand": install_command(),
    }


def install_command() -> list[str] | None:
    if SYSTEM != "Linux":
        return None
    pm = package_manager()
    if not pm:
        return None
    pkgs = LINUX_PACKAGES[pm]
    if pm == "apt-get":
        return ["apt-get", "install", "-y", *pkgs]
    if pm == "dnf":
        return ["dnf", "install", "-y", *pkgs]
    if pm == "pacman":
        return ["pacman", "-S", "--needed", "--noconfirm", *pkgs]
    return ["zypper", "--non-interactive", "install", *pkgs]


def install(graphical: bool = True) -> tuple[bool, str]:
    """Installe les paquets système manquants (Linux). `graphical` : fenêtre d'administration (pkexec),
    sinon sudo dans le terminal. Le mot de passe est toujours saisi par l'utilisateur, jamais par ORION."""
    cmd = install_command()
    if not cmd:
        return False, "Installation automatique impossible sur ce système."
    runner = ["pkexec"] if graphical and shutil.which("pkexec") else ["sudo"]
    try:
        res = subprocess.run([*runner, *cmd], check=False, capture_output=graphical, text=True, timeout=900)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"Installation interrompue : {e}"
    if res.returncode in (126, 127) and graphical:  # fenêtre fermée ou mot de passe refusé
        return False, "Installation annulée."
    if res.returncode != 0:
        err = (res.stderr or "").strip().splitlines()[-1:] if graphical else []
        return False, "Échec de l'installation" + (f" : {err[0]}" if err else ".")
    left = missing()
    return (not left), ("Tout est installé." if not left else "Il manque encore : " + ", ".join(left))
