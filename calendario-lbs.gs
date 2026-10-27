// Finder LBS → calendario Google "Lavori LBS".
// Programma Google Apps Script (script.google.com) sull'account di Luca, pubblicato come "App web":
// esegui come: io; chi ha accesso: chiunque. L'app Finder gli manda i lavori con una data e lui crea,
// sposta o cancella l'evento nel calendario "Lavori LBS" (lo crea da solo la prima volta).
// L'indirizzo dell'App web sta solo nel database Firebase (impostazioni/calendario), mai su GitHub.

const NOME_CAL = "Lavori LBS";
const FUSO = "Europe/Rome";
const COLORI = {
  ordine: CalendarApp.EventColor.GREEN,
  preventivo: CalendarApp.EventColor.YELLOW,
  appunto: CalendarApp.EventColor.GRAY,
  importante: CalendarApp.EventColor.RED
};

function calendario() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty("calendario");
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    cal = CalendarApp.getCalendarsByName(NOME_CAL)[0] || CalendarApp.createCalendar(NOME_CAL, { timeZone: FUSO });
    p.setProperty("calendario", cal.getId());
  }
  return cal;
}

// da lanciare una volta dall'editor: chiede i permessi e crea il calendario
function prepara() {
  Logger.log("Calendario pronto: " + calendario().getName());
}

function risposta(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return risposta({ ok: true, calendario: calendario().getName() });
}

// { azione: "salva" | "elimina" | "prova", id, tipo, titolo, giorno: "2026-10-30", ora: "09:30" o "", descrizione, luogo }
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    const cal = calendario(), p = PropertiesService.getScriptProperties();
    if (d.azione === "prova") return risposta({ ok: true, calendario: cal.getName() });
    const id = String(d.id || "").slice(0, 120);
    if (!id) return risposta({ ok: false, errore: "manca l'id" });
    // il lavoro aveva già un evento: si toglie e, se serve, si rifà con i dati nuovi
    const chiave = "ev_" + id, vecchio = p.getProperty(chiave);
    if (vecchio) {
      try { const ev = cal.getEventById(vecchio); if (ev) ev.deleteEvent(); } catch (err) {}
      p.deleteProperty(chiave);
    }
    if (d.azione === "elimina") return risposta({ ok: true });
    if (d.azione !== "salva" || !/^\d{4}-\d{2}-\d{2}$/.test(d.giorno || "")) return risposta({ ok: false, errore: "dati non validi" });
    const titolo = String(d.titolo || "Lavoro").slice(0, 200);
    const opz = { description: String(d.descrizione || "").slice(0, 4000), location: String(d.luogo || "").slice(0, 300) };
    let ev;
    if (/^\d{2}:\d{2}$/.test(d.ora || "")) {
      const inizio = Utilities.parseDate(d.giorno + " " + d.ora, FUSO, "yyyy-MM-dd HH:mm");
      ev = cal.createEvent(titolo, inizio, new Date(inizio.getTime() + 60 * 60 * 1000), opz);
    } else {
      ev = cal.createAllDayEvent(titolo, Utilities.parseDate(d.giorno + " 12:00", FUSO, "yyyy-MM-dd HH:mm"), opz);
    }
    if (COLORI[d.tipo]) ev.setColor(COLORI[d.tipo]);
    p.setProperty(chiave, ev.getId());
    return risposta({ ok: true });
  } catch (err) {
    return risposta({ ok: false, errore: String(err) });
  } finally {
    lock.releaseLock();
  }
}
