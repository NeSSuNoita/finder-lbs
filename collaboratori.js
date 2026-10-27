/* FINDER app – pannello "Collaboratori" (solo per gli amministratori): chi può entrare nell'app.
   autorizzati/<email con le virgole> = { nome, email, admin }. Le regole del database lasciano
   scrivere questo elenco solo agli amministratori; chi viene tolto non entra più alla riapertura. */
(function () {
  const { rt, auth, chiave } = window.FB;
  const mia = chiave(auth.currentUser && auth.currentUser.email);
  const riga = document.getElementById("esci").parentElement;
  riga.insertAdjacentHTML("beforeend", ` · <button type="button" class="link" id="collBtn" aria-expanded="false" aria-controls="collPanel">Collaboratori</button>`);
  const panel = document.createElement("section");
  panel.id = "collPanel"; panel.className = "coll"; panel.hidden = true; panel.setAttribute("aria-label", "Collaboratori");
  panel.innerHTML = `
    <h2>Collaboratori</h2>
    <p class="note">Entrano solo le persone in questo elenco, con il loro account Google. Chi togli non entra più alla riapertura dell'app.</p>
    <ul id="collList"></ul>
    <form id="collAdd">
      <label>Nome <input name="nome" required maxlength="40" placeholder="es. Marco"></label>
      <label>Email Google <input name="email" type="email" required placeholder="nome@gmail.com"></label>
      <label class="ck"><input name="admin" type="checkbox"> può gestire i collaboratori</label>
      <button type="submit" class="btn primary">Aggiungi</button>
    </form>
    <p class="note" id="collMsg" aria-live="polite"></p>
    <h2>Calendario Lavori LBS</h2>
    <p class="note">I lavori con una data vanno da soli nel calendario Google "Lavori LBS". Qui si incolla l'indirizzo dell'App web
      del programma Google (finisce con /exec): resta nel database, lo leggono solo i collaboratori.</p>
    <form id="calForm">
      <label>Indirizzo App web <input name="url" type="url" required placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <button type="submit" class="btn primary">Salva</button>
      <button type="button" class="btn" id="calProva">Prova</button>
      <button type="button" class="btn" id="calTutti">Manda i lavori già salvati</button>
    </form>
    <p class="note" id="calMsg" aria-live="polite"></p>
    <h2>Copia di sicurezza</h2>
    <p class="note">Scarica in un file tutto quello che avete scritto: stati, note, promemoria, visite, foto, giri, appunti, disegni, cataloghi e collaboratori.
      Fallo ogni tanto e prima delle modifiche importanti; per ripristinare si importa il file in Firebase (istruzioni in LEGGIMI.md).</p>
    <button type="button" class="btn" id="backupBtn">Scarica copia di sicurezza</button>
    <p class="note" id="backupMsg" aria-live="polite"></p>`;
  riga.after(panel);
  const msg = t => { document.getElementById("collMsg").textContent = t || ""; };
  document.getElementById("collBtn").addEventListener("click", e => {
    panel.hidden = !panel.hidden; e.target.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  let elenco = {};
  rt.ref("autorizzati").on("value", s => { elenco = s.val() || {}; disegna(); }, () => msg("Non riesco a leggere l'elenco."));
  function disegna() {
    const ul = document.getElementById("collList"); ul.textContent = "";
    Object.entries(elenco).sort((a, b) => String(a[1].nome).localeCompare(String(b[1].nome), "it")).forEach(([k, p]) => {
      const li = document.createElement("li");
      const n = document.createElement("b"); n.textContent = p.nome || "—";
      const e = document.createElement("span"); e.textContent = " " + (p.email || k.replace(/,/g, "."));
      li.append(n, e);
      if (p.admin) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "amministratore"; li.append(" ", t); }
      if (k !== mia) {
        const ba = document.createElement("button"); ba.type = "button"; ba.className = "link"; ba.textContent = p.admin ? "togli amministratore" : "rendi amministratore";
        ba.addEventListener("click", () => rt.ref("autorizzati/" + k + "/admin").set(!p.admin).catch(() => msg("Modifica non riuscita.")));
        const bt = document.createElement("button"); bt.type = "button"; bt.className = "link danger"; bt.textContent = "togli";
        bt.addEventListener("click", () => {
          if (!confirm(`Togliere ${p.nome || p.email} dai collaboratori? Non potrà più entrare nell'app.`)) return;
          rt.ref("autorizzati/" + k).remove().then(() => msg(`${p.nome || p.email} tolto.`)).catch(() => msg("Modifica non riuscita."));
        });
        li.append(" · ", ba, " · ", bt);
      } else li.append(" (tu)");
      ul.append(li);
    });
  }
  // copia di sicurezza: i nodi scritti dalle persone (l'elenco aziende "dati" si rifà dal PC con prepara-firebase.ps1)
  document.getElementById("backupBtn").addEventListener("click", async e => {
    const b = e.currentTarget, m = document.getElementById("backupMsg");
    b.disabled = true; m.textContent = "Preparo la copia…";
    const out = { esportato: new Date().toISOString(), da: auth.currentUser && auth.currentUser.email };
    const nodi = ["autorizzati", "utenti", "stato", "visite", "foto", "giri", "appunti", "disegni", "cataloghi", "impostazioni"], mancano = [];
    for (const n of nodi) { try { out[n] = (await rt.ref(n).get()).val() || {}; } catch (err) { mancano.push(n); } }
    // i propri appunti "solo per me" (quelli degli altri restano privati)
    try { out.miei_appunti = { uid: auth.currentUser.uid, appunti: (await rt.ref("data/users/" + auth.currentUser.uid).get()).val() || {} }; } catch (err) { mancano.push("appunti personali"); }
    const d = new Date(), p = x => String(x).padStart(2, "0"); // ora italiana nel nome del file
    const nome = `finder-copia-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
    a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    const cnt = k => Object.keys(out[k] || {}).length;
    m.textContent = `Scaricato ${nome}: ${cnt("stato")} schede, ${cnt("visite")} visite, ${cnt("appunti")} appunti, ${cnt("disegni")} disegni, ${cnt("foto")} foto, ${cnt("autorizzati")} collaboratori.` + (mancano.length ? ` Non letti: ${mancano.join(", ")}.` : "");
    b.disabled = false;
  });
  // calendario: indirizzo del programma Google in impostazioni/calendario (lo scrivono solo gli amministratori)
  const calMsg = t => { document.getElementById("calMsg").textContent = t || ""; };
  const calForm = document.getElementById("calForm"), APP_WEB = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
  rt.ref("impostazioni/calendario").get().then(s => { const v = s.val(); if (v && v.url) { calForm.url.value = v.url; calMsg("Calendario collegato."); } }).catch(() => {});
  calForm.addEventListener("submit", e => {
    e.preventDefault();
    const url = calForm.url.value.trim();
    if (!APP_WEB.test(url)) { calMsg("L'indirizzo deve essere quello dell'App web: https://script.google.com/macros/s/…/exec"); return; }
    rt.ref("impostazioni/calendario").set({ url, agg: new Date().toISOString(), da: auth.currentUser && auth.currentUser.email })
      .then(() => calMsg("Salvato: riapri l'app sugli altri telefoni perché lo leggano. Ora tocca \"Prova\"."))
      .catch(() => calMsg("Non salvato: solo gli amministratori possono cambiarlo."));
  });
  document.getElementById("calProva").addEventListener("click", async () => {
    const url = calForm.url.value.trim(); if (!APP_WEB.test(url)) { calMsg("Prima incolla e salva l'indirizzo."); return; }
    calMsg("Provo…");
    try { const r = await (await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ azione: "prova" }) })).json(); calMsg(r.ok ? `Funziona: calendario "${r.calendario}" pronto.` : "Il programma risponde con un errore: " + (r.errore || "")); }
    catch (err) { calMsg("Il programma non risponde: controlla l'indirizzo e che l'App web sia pubblicata per \"Chiunque\"."); }
  });
  document.getElementById("calTutti").addEventListener("click", async e => {
    if (!window.tuttiAlCalendario) return;
    e.currentTarget.disabled = true; calMsg("Mando i lavori con la data…");
    const r = await window.tuttiAlCalendario(); e.currentTarget.disabled = false;
    calMsg(`Fatto: ${r.fatti} lavori nel calendario` + (r.falliti ? `, ${r.falliti} non riusciti (riprova più tardi).` : "."));
  });
  document.getElementById("collAdd").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, email = f.email.value.trim().toLowerCase(), nome = f.nome.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg("Email non valida."); return; }
    rt.ref("autorizzati/" + chiave(email)).set({ nome, email, admin: f.admin.checked })
      .then(() => { msg(`${nome} aggiunto: ora può aprire l'app e accedere con Google (${email}).`); f.reset(); })
      .catch(() => msg("Aggiunta non riuscita: solo gli amministratori possono aggiungere persone."));
  });
})();
