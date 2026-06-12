"""
Sincroniza y resuelve qué copia de los Excel ADMIN usar.

Hay dos ubicaciones habituales:
  - data/           → la del repo (GitHub Pages)
  - ../00. ADMIN/   → donde se editan a mano en el Mac

Si editas en 00. ADMIN/, esta utilidad copia al repo la versión más reciente.
"""
import os
import shutil

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
LOCAL_DIR = os.path.join(BASE, "..", "00. ADMIN")

EXCEL1 = "ADMIN-Excel-Mundial_NANOS_2026 [1].xlsx"
EXCEL2 = "ADMIN-Excel-Mundial_NANOS_2026 [2].xlsx"
EXCELS = (EXCEL1, EXCEL2)


def _mtime(path: str) -> float:
    return os.path.getmtime(path) if os.path.isfile(path) else 0.0


def pick_admin_dir() -> str:
    """Carpeta con el Excel [1] más reciente (data/ o 00. ADMIN/)."""
    candidates = []
    for d in (DATA_DIR, LOCAL_DIR):
        f1 = os.path.join(d, EXCEL1)
        if os.path.isfile(f1):
            candidates.append((d, _mtime(f1)))
    if not candidates:
        return DATA_DIR if os.path.isdir(DATA_DIR) else LOCAL_DIR
    candidates.sort(key=lambda x: x[1], reverse=True)
    return candidates[0][0]


def sync_excel_sources(verbose: bool = True) -> int:
    """
    Copia Excel desde 00. ADMIN/ → data/ si la copia local es más nueva.
    Devuelve cuántos ficheros se han sincronizado.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    synced = 0
    for name in EXCELS:
        src = os.path.join(LOCAL_DIR, name)
        dst = os.path.join(DATA_DIR, name)
        if not os.path.isfile(src):
            continue
        if _mtime(src) > _mtime(dst) + 0.5:
            shutil.copy2(src, dst)
            synced += 1
            if verbose:
                print(f"  ↻ Sincronizado: {name}  (00. ADMIN/ → data/)")
    if verbose and synced:
        print(f"✅ {synced} Excel actualizado(s) en data/")
    return synced


def excel_paths():
    """(admin_dir, file1, file2) tras sincronizar."""
    sync_excel_sources(verbose=False)
    admin = pick_admin_dir()
    return admin, os.path.join(admin, EXCEL1), os.path.join(admin, EXCEL2)
