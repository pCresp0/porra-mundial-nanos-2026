#!/bin/bash
# Doble clic para abrir la Porra Mundial 'Los Nanos' en Chrome

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

PORT=5050
URL="http://localhost:${PORT}"

echo ""
echo "══════════════════════════════════════════════════"
echo "  🏆  PORRA MUNDIAL 'LOS NANOS' 2026"
echo "  🌐  ${URL}"
echo "  ⏹   Cierra esta ventana o pulsa Ctrl+C para parar"
echo "══════════════════════════════════════════════════"
echo ""

# Comprobar que existen los Excel
EXCEL1="data/ADMIN-Excel-Mundial_NANOS_2026 [1].xlsx"
EXCEL2="data/ADMIN-Excel-Mundial_NANOS_2026 [2].xlsx"
if [ ! -f "$EXCEL1" ]; then EXCEL1="../00. ADMIN/ADMIN-Excel-Mundial_NANOS_2026 [1].xlsx"; fi
if [ ! -f "$EXCEL2" ]; then EXCEL2="../00. ADMIN/ADMIN-Excel-Mundial_NANOS_2026 [2].xlsx"; fi
if [ ! -f "$EXCEL1" ] || [ ! -f "$EXCEL2" ]; then
  echo "❌ ERROR: No encuentro los Excel en 'data/' ni en '../00. ADMIN/'"
  echo "   Asegúrate de que están los dos ficheros ADMIN-Excel-Mundial_NANOS_2026"
  echo ""
  read -r -p "Pulsa Enter para cerrar..."
  exit 1
fi

# Matar cualquier servidor antiguo en el puerto (evita quedarse colgado con error 500)
OLD_PID=$(lsof -ti:${PORT} 2>/dev/null)
if [ -n "$OLD_PID" ]; then
  echo "↻ Reiniciando servidor (había uno antiguo en el puerto ${PORT})..."
  kill -9 $OLD_PID 2>/dev/null
  sleep 1
fi

echo "🚀 Arrancando servidor..."
python3 "$DIR/launch.py"
