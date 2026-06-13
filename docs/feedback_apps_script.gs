/**
 * ════════════════════════════════════════════════════════════════
 *  PORRA «LOS NANOS» 2026 — Recogida de sugerencias / fallos
 *  Google Apps Script (Web App). Guarda cada mensaje en una Hoja
 *  de Google, te avisa por correo y permite que SOLO el panel de
 *  admin (con tu PIN) lea la lista.
 * ════════════════════════════════════════════════════════════════
 *
 *  ──────────────────────  CÓMO INSTALARLO  ──────────────────────
 *  (5 minutos, una sola vez. Todo con tu cuenta pcbcrespo@gmail.com)
 *
 *  1. Entra en https://script.google.com  y pulsa «Nuevo proyecto».
 *  2. Borra lo que haya y pega TODO este archivo.
 *  3. Arriba, en `CONFIG`, cambia:
 *       - ADMIN_PIN  → pon el MISMO PIN que usas en el panel de admin.
 *       - NOTIFY_EMAIL → tu correo (ya viene pcbcrespo@gmail.com).
 *  4. Guarda (icono del disquete o Ctrl+S).
 *  5. Pulsa «Implementar» (Deploy) → «Nueva implementación».
 *       - Tipo: «Aplicación web» (Web app).
 *       - Descripción: lo que quieras.
 *       - Ejecutar como: «Yo» (tu cuenta).
 *       - Quién tiene acceso: «Cualquier usuario» (Anyone).
 *       - Pulsa «Implementar» y AUTORIZA los permisos que pida
 *         (Google te avisará de que es una app no verificada: entra
 *          en «Configuración avanzada» → «Ir a (nombre)» → Permitir).
 *  6. Copia la «URL de la aplicación web» que termina en /exec.
 *  7. Pégala en static/js/app.js  →  const FEEDBACK_API = "AQUÍ";
 *       (y haz git push). ¡Listo!
 *
 *  Si más adelante cambias este código, debes volver a «Implementar»
 *  → «Gestionar implementaciones» → editar → «Nueva versión».
 * ════════════════════════════════════════════════════════════════
 */

const CONFIG = {
  ADMIN_PIN: "PON_AQUI_TU_PIN",         // mismo PIN que el panel de admin
  NOTIFY_EMAIL: "pcbcrespo@gmail.com",  // a dónde llega el aviso por correo
  SHEET_NAME: "Sugerencias",            // pestaña de la hoja (se crea sola)
  NOTIFY: true                          // false = no enviar correo, solo guardar
};

// ── Recepción de un nuevo mensaje (desde la web) ──
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const name = String(data.name || "").trim().slice(0, 80);
    const type = data.type === "Bug" ? "Bug" : "Mejora";
    const text = String(data.text || "").trim().slice(0, 5000);

    if (!name || !text) {
      return _json({ ok: false, error: "missing_fields" });
    }

    const sheet = _sheet();
    const now = new Date();
    // Columnas: Fecha | Tipo | Nombre | Mensaje | Estado
    sheet.appendRow([now, type, name, text, "nuevo"]);

    if (CONFIG.NOTIFY) {
      const tag = type === "Bug" ? "🐛 Fallo" : "💡 Mejora";
      try {
        MailApp.sendEmail({
          to: CONFIG.NOTIFY_EMAIL,
          subject: `[Porra Los Nanos] ${tag} — ${name}`,
          body: `Tipo: ${tag}\nDe: ${name}\nFecha: ${now.toLocaleString("es-ES")}\n\n${text}\n\n— Enviado desde la web de la Porra «Los Nanos» Mundial 2026`
        });
      } catch (mailErr) {
        // si el correo falla, el mensaje ya quedó guardado en la hoja
      }
    }

    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// ── Lectura de la lista (solo admin con PIN correcto) ──
function doGet(e) {
  const token = (e && e.parameter && e.parameter.token) || "";
  if (token !== CONFIG.ADMIN_PIN) {
    return _json({ ok: false, error: "unauthorized" });
  }
  const sheet = _sheet();
  const rows = sheet.getDataRange().getValues();
  const out = [];
  // fila 0 = cabecera
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[2] && !r[3]) continue;
    out.push({
      ts: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      type: r[1] || "Mejora",
      name: r[2] || "",
      text: r[3] || "",
      status: r[4] || "nuevo"
    });
  }
  out.reverse(); // más reciente primero
  return _json({ ok: true, items: out });
}

// ── Helpers ──
function _sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
    || SpreadsheetApp.create("Porra Los Nanos — Sugerencias");
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow(["Fecha", "Tipo", "Nombre", "Mensaje", "Estado"]);
  }
  return sheet;
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
