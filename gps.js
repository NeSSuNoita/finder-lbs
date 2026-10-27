/* FINDER app – GPS: posizione in tempo reale con cerchio di precisione, "Dove sono" con raggio 5/10/15 km,
   aziende vicine (l'elenco e la mappa mostrano solo quelle dentro il raggio, ordinate per distanza)
   e posizione condivisa tra gli utenti dell'app (posizioni/<uid>: lat, lon, precisione, ora, nome).
   Usa le funzioni della pagina: setRef, changed, nearVisible, circlePoly, GL, toast. */
(function () {
  const { rt, me, utenti, auth } = window.FB;
  const uid = me();
  const RAGGI = [5, 10, 15];
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  let pos = null, watch = 0, R = +(ls("gps-r") || 5), segui = false, vaiAppena = false;
  let ultimoInvio = 0, ultimoInviato = null, ultimoRef = null, ultimoRefT = 0;
  let condividi = ls("gps-share") !== "0";
  const altri = new Map(); // uid -> { marker, el }
  // distanza in km tra due punti {lat, lon}
  const dist = (a, b) => { const k = Math.cos((a.lat + b.lat) / 2 * Math.PI / 180), dx = (b.lon - a.lon) * k, dy = b.lat - a.lat; return Math.sqrt(dx * dx + dy * dy) * 111.2; };

  /* ---------- controlli: nella barra sopra l'elenco, visibili anche su telefono ---------- */
  const box = document.createElement("div");
  box.className = "gps-box";
  box.innerHTML =
    `<button type="button" class="btn primary" id="gpsGo">📍 Dove sono</button>` +
    `<span class="gps-r" role="group" aria-label="Raggio attorno a me">${RAGGI.map(k => `<button type="button" class="btn" data-r="${k}" aria-pressed="${k === R}">${k} km</button>`).join("")}</span>` +
    `<label class="gps-share"><input type="checkbox" id="gpsShare" ${condividi ? "checked" : ""}> condividi la mia posizione</label>` +
    `<span class="gps-st" id="gpsSt" aria-live="polite"></span>`;
  document.querySelector(".res-head").after(box);
  const st = t => { document.getElementById("gpsSt").textContent = t || ""; };

  document.getElementById("gpsGo").addEventListener("click", () => {
    avviaGps();
    if (pos) applica(true); else { vaiAppena = true; st("Cerco la posizione…"); }
  });
  box.querySelectorAll("[data-r]").forEach(b => b.addEventListener("click", () => {
    R = +b.dataset.r; ls("gps-r", String(R));
    box.querySelectorAll("[data-r]").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.r === R)));
    if (pos) applica(true); else document.getElementById("gpsGo").click();
  }));
  document.getElementById("gpsShare").addEventListener("change", e => {
    condividi = e.target.checked; ls("gps-share", condividi ? "1" : "0");
    if (!condividi) rt.ref("posizioni/" + uid).remove().catch(() => {});
    else if (pos) invia(true);
  });

  /* ---------- GPS ---------- */
  function avviaGps() {
    if (watch) return;
    if (!navigator.geolocation) { st("Questo telefono non dà la posizione: usa il comune."); return; }
    ls("gps-on", "1");
    watch = navigator.geolocation.watchPosition(nuova, errore, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  function errore(e) {
    if (e.code === 1) { st("Permesso posizione negato: attivalo nelle impostazioni del browser per questo sito."); ls("gps-on", "0"); navigator.geolocation.clearWatch(watch); watch = 0; }
    else st("Segnale GPS debole, riprovo…");
  }
  function nuova(p) {
    pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) };
    disegnaMe();
    st(`Posizione aggiornata · precisione ${pos.acc < 1000 ? pos.acc + " m" : (pos.acc / 1000).toFixed(1) + " km"}`);
    if (vaiAppena) { vaiAppena = false; applica(true); }
    else if (segui && ref && ref.geo) {
      // mentre ci si sposta, distanze e aziende vicine si ricalcolano (al massimo ogni 20 s o dopo 200 m)
      const d = ultimoRef ? dist(ultimoRef, pos) : 99;
      if (d > 0.2 && Date.now() - ultimoRefT > 20000) applica(false);
    }
    invia(false);
  }
  // "Dove sono": punto di riferimento = la mia posizione, raggio scelto, elenco per distanza
  function applica(zoom) {
    segui = true; ultimoRef = { lat: pos.lat, lon: pos.lon }; ultimoRefT = Date.now();
    setRef({ lat: pos.lat, lon: pos.lon, label: "la mia posizione", geo: true });
    radius = R; document.getElementById("radius").value = String(R);
    if (sortBy !== "dist") { sortBy = "dist"; document.getElementById("sort").value = "dist"; }
    nearVisible(); changed();
    const n = LIST.filter(a => !a._c).length, cl = LIST.filter(a => !a._c && isCli(a)).length;
    st(`${n} aziende entro ${R} km${cl ? ` (${cl} già clienti)` : ""}`);
    if (zoom) {
      const tg = document.getElementById("mapToggle");
      if (isNarrow() && tg.getAttribute("aria-expanded") === "false") tg.click(); // su telefono apre la mappa
      if (GL.ready) {
        const c = circlePoly(pos, R).geometry.coordinates[0];
        const xs = c.map(q => q[0]), ys = c.map(q => q[1]);
        GL.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 24, duration: 600 });
      }
    }
  }

  /* ---------- il mio pallino e il cerchio di precisione ---------- */
  function strati() {
    if (!GL.ready) return false;
    const m = GL.map;
    if (!m.getSource("gps")) {
      m.addSource("gps", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "gps-acc", type: "fill", source: "gps", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#1a73e8", "fill-opacity": 0.14 } });
      m.addLayer({ id: "gps-acc-l", type: "line", source: "gps", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#1a73e8", "line-width": 1, "line-opacity": 0.5 } });
      m.addLayer({ id: "gps-pt", type: "circle", source: "gps", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 8, "circle-color": "#1a73e8", "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
    }
    return true;
  }
  function disegnaMe() {
    if (!pos || !strati()) return;
    const f = [{ type: "Feature", geometry: { type: "Point", coordinates: [pos.lon, pos.lat] }, properties: {} }];
    if (pos.acc > 15) f.unshift(circlePoly(pos, pos.acc / 1000));
    GL.map.getSource("gps").setData({ type: "FeatureCollection", features: f });
  }
  // la mappa si carica dopo: quando è pronta (o cambia tema) si ridisegna tutto
  const attesa = setInterval(() => { if (GL.ready) { clearInterval(attesa); disegnaMe(); disegnaAltri(); GL.map.on("styledata", () => { disegnaMe(); }); } }, 500);

  /* ---------- posizione condivisa ---------- */
  function invia(subito) {
    if (!condividi || !pos) return;
    const ora = Date.now(), mosso = ultimoInviato ? dist(ultimoInviato, pos) * 1000 : 1e9;
    if (!subito && ora - ultimoInvio < 20000 && mosso < 50) return; // al massimo ogni 20 s, salvo spostamenti
    ultimoInvio = ora; ultimoInviato = { lat: pos.lat, lon: pos.lon };
    const nome = (utenti()[uid] && utenti()[uid].nome) || "";
    rt.ref("posizioni/" + uid).set({ lat: pos.lat, lon: pos.lon, acc: pos.acc, nome, t: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  }
  let posAltri = {};
  rt.ref("posizioni").on("value", s => { posAltri = s.val() || {}; disegnaAltri(); });
  setInterval(disegnaAltri, 60000); // aggiorna "x min fa"
  function fa(t) {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "adesso" : m < 60 ? `${m} min fa` : m < 1440 ? `${Math.round(m / 60)} h fa` : "più di un giorno fa";
  }
  function disegnaAltri() {
    if (!GL.ready || !window.maplibregl) return;
    const visti = new Set();
    for (const [id, p] of Object.entries(posAltri)) {
      if (id === uid || !p || typeof p.lat !== "number") continue;
      if (Date.now() - (p.t || 0) > 24 * 3600 * 1000) continue; // posizioni più vecchie di un giorno non si mostrano
      visti.add(id);
      let o = altri.get(id);
      if (!o) {
        const el = document.createElement("div"); el.className = "pin-amico";
        el.innerHTML = `<i></i><span class="n"></span><span class="t"></span>`;
        o = { el, marker: new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([p.lon, p.lat]).addTo(GL.map) };
        altri.set(id, o);
      }
      o.marker.setLngLat([p.lon, p.lat]);
      o.el.querySelector(".n").textContent = p.nome || (utenti()[id] && utenti()[id].nome) || "Collega";
      o.el.querySelector(".t").textContent = fa(p.t || 0);
      o.el.classList.toggle("vecchia", Date.now() - (p.t || 0) > 15 * 60000);
    }
    for (const [id, o] of altri) if (!visti.has(id)) { o.marker.remove(); altri.delete(id); }
  }

  /* ---------- esci ---------- */
  const out = document.createElement("p"); out.className = "note";
  out.innerHTML = `Collegato come <b></b> · <button type="button" class="link" id="esci">Esci</button>`;
  out.querySelector("b").textContent = (utenti()[uid] && utenti()[uid].nome) || (auth.currentUser && auth.currentUser.email) || "";
  document.getElementById("foot").after(out);
  document.getElementById("esci").addEventListener("click", async () => {
    try { await rt.ref("presenza/" + uid).remove(); } catch (e) {}
    await auth.signOut(); location.reload();
  });

  // se il GPS era già stato acceso, riparte da solo (il permesso è già stato dato)
  if (ls("gps-on") === "1") avviaGps();
})();
