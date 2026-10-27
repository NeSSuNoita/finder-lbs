/* FINDER app – funzionamento senza rete per la parte grafica (i dati arrivano da Firebase).
   VERSIONE cambia a ogni costruzione dell'app: così i telefoni scaricano l'aggiornamento. */
const VERSIONE = "finder-app-20261027-165545"; // finder-app-<data>; la cache "finder-dati" (elenco aziende) non si tocca
const BASE = ["./", "index.html", "app.css", "shim.js", "gps.js", "collaboratori.js", "firebase-config.js", "manifest.webmanifest", "icons/logo-192.png", "icons/logo-512.png", "mappa/acque.geojson", "mappa/comuni.geojson", "mappa/etichette.geojson", "mappa/mare.geojson", "mappa/strade.geojson"];
// "reload": i file si prendono da GitHub e non dalla memoria del browser (GitHub li fa tenere 10 minuti)
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(BASE.map(x => new Request(x, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith("finder-app-") && x !== VERSIONE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  // Firebase (login e database) passa sempre dalla rete
  if (/firebaseio\.com|googleapis\.com\/identitytoolkit|securetoken|firebasedatabase/.test(u.host + u.pathname)) return;
  // pagina e file del programma (stesso sito, tranne la mappa): prima GitHub, ricontrollato ogni volta,
  // così un aggiornamento si vede alla prima apertura; senza rete la copia salvata
  const nav = r.mode === "navigate";
  if (nav || (u.origin === location.origin && !u.pathname.includes("/mappa/"))) {
    const chiave = nav ? "index.html" : r;
    e.respondWith(fetch(nav ? r.url : r, { cache: "no-cache" })
      .then(res => { if (res.ok) { const c = res.clone(); caches.open(VERSIONE).then(x => x.put(chiave, c)); } return res; })
      .catch(() => caches.match(chiave)));
    return;
  }
  // mappa, librerie e caratteri (pesanti, cambiano di rado): copia salvata, aggiornata in sottofondo
  e.respondWith(caches.match(r).then(hit => {
    const net = fetch(r).then(res => { if (res.ok || res.type === "opaque") { const c = res.clone(); caches.open(VERSIONE).then(x => x.put(r, c)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
