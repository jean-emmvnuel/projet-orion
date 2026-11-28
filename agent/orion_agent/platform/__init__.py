"""Actions propres à chaque système d'exploitation.

Chaque module expose : name, os_version(), capture_screen(dest), lock(), sleep(), notify(title, body).
"""

import platform as _platform

_system = _platform.system()

if _system == "Linux":
    from . import linux as current
elif _system == "Darwin":
    from . import macos as current
elif _system == "Windows":
    from . import windows as current
else:  # pragma: no cover
    raise RuntimeError(f"Système non pris en charge : {_system}")

__all__ = ["current"]
