/* FINDER app – login Firebase e "ponte" tra la pagina (scritta per claude.ai) e Firebase.
   La pagina chiede claude.use("db" | "user" | "room" | "downloads") e i file dati/*.json:
   qui le stesse richieste vengono servite dal Realtime Database, protetto dal login.
   Struttura del database: dati/aziende, dati/concorrenti (elenco), stato/<id> (stato e note),
   autorizzati/<email con le virgole> (nome, email, admin: chi può entrare, gestito dall'amministratore),
   utenti/<uid> (nome ed email, scritti da ciascuno al primo accesso), presenza/<uid> (chi ha l'app aperta),
   posizioni/<uid> (GPS), visite/<azienda>__v… (storico visite), foto/<azienda>__f… (foto delle visite),
   giri/<uid> (giro del giorno di ciascuno). Le regole del database fanno entrare solo chi è in autorizzati/. */
(function () {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth(), rt = firebase.database();
  const me = () => (auth.currentUser ? auth.currentUser.uid : null);
  // le email non possono fare da chiave nel database (niente punti): luca.rossi@gmail.com -> luca,rossi@gmail,com
  const chiave = e => String(e || "").trim().toLowerCase().replace(/\./g, ",");
  let utenti = {}; // uid -> { nome }
  window.FB = { auth, rt, me, chiave, admin: false, utenti: () => utenti };

  // dati delle aziende: la pagina li chiede a dati/*.json, qui arrivano dal database protetto.
  // Si scaricano una volta e restano sul telefono finché non cambia dati/aggiornato (il piano gratuito ha un limite di download).
  const _fetch = window.fetch.bind(window);
  async function datiNodo(nome) {
    const ver = String((await rt.ref("dati/aggiornato").get()).val() || "");
    let c = null; try { c = await caches.open("finder-dati"); } catch (e) {}
    const url = "./__dati/" + nome + ".json";
    if (c) { const hit = await c.match(url); if (hit && hit.headers.get("x-ver") === ver) return hit; }
    let v = (await rt.ref("dati/" + nome).get()).val();
    if (v && !Array.isArray(v)) v = Object.values(v);
    const res = new Response(JSON.stringify(v || []), { status: 200, headers: { "Content-Type": "application/json", "x-ver": ver } });
    if (c) { try { await c.put(url, res.clone()); } catch (e) {} }
    return res;
  }
  window.fetch = async (u, o) => {
    const m = String(u).match(/dati\/(aziende|concorrenti)\.json(\?|$)/);
    return m ? datiNodo(m[1]) : _fetch(u, o);
  };

  // archivio condiviso di stato e note: stessa forma del db di claude.ai (collection/doc/onSnapshot)
  function collection(path) {
    const ref = rt.ref(path);
    return {
      doc: id => ({
        // il database non accetta valori undefined: passano dal JSON
        set: body => ref.child(id).set(JSON.parse(JSON.stringify(body))),
        delete: () => ref.child(id).remove(),
        // lettura singola (le foto delle visite si scaricano solo quando si aprono)
        get: async () => { const s = await ref.child(id).get(); const v = s.val(); return { id, exists: v != null, data: () => v }; }
      }),
      onSnapshot(cb, onErr) {
        let coda = [], t = 0;
        // i cambi arrivano uno per uno: si consegnano a gruppi, come fa claude.ai
        const push = (type, s) => {
          coda.push({ type, doc: { id: s.key, data: () => s.val() } });
          if (!t) t = setTimeout(() => { const c = coda; coda = []; t = 0; cb({ docChanges: () => c }); }, 40);
        };
        const err = e => { if (onErr) onErr(e); };
        ref.on("child_added", s => push("added", s), err);
        ref.on("child_changed", s => push("modified", s), err);
        ref.on("child_removed", s => push("removed", s), err);
        return () => ref.off();
      }
    };
  }
  const db = { collection };

  const user = {
    id: async () => me(),
    me: async () => ({ id: me() }),
    isOwner: () => false,
    canEdit: () => false,
    can: async () => true, // le regole del database decidono: entra solo chi è in utenti/
    profiles: async ids => {
      const r = {};
      (ids || []).forEach(id => { r[id] = { id, name: (utenti[id] && utenti[id].nome) || "" }; });
      return r;
    }
  };

  // chi ha l'app aperta adesso: presenza/<uid>, tolta da Firebase da solo quando ci si scollega
  let peers = Object.freeze([]), connesso = false, ultima = null;
  const lp = new Set(), lc = new Set();
  const room = {
    presence: async patch => {
      if (!me()) return;
      ultima = Object.assign({}, ultima, patch);
      const r = rt.ref("presenza/" + me());
      await r.onDisconnect().remove();
      await r.update(Object.assign({}, ultima, { t: firebase.database.ServerValue.TIMESTAMP }));
    },
    peers: () => peers,
    connected: () => connesso,
    onPeers(fn) { lp.add(fn); setTimeout(() => fn({ peers }), 0); return () => lp.delete(fn); },
    onConnection(fn) { lc.add(fn); setTimeout(() => fn(connesso), 0); return () => lc.delete(fn); }
  };
  function avviaPresenza() {
    rt.ref(".info/connected").on("value", s => {
      connesso = !!s.val();
      if (connesso && ultima) room.presence({}).catch(() => {}); // riaggancio dopo una disconnessione
      lc.forEach(fn => fn(connesso));
    });
    rt.ref("presenza").on("value", s => {
      const v = s.val() || {};
      peers = Object.freeze(Object.keys(v).map(uid => Object.freeze({
        kind: "viewer", by: uid, isMe: uid === me(), sameTab: uid === me(), peer: uid,
        presence: v[uid] || {}, updatedAt: Date.now(), guest: false
      })));
      lp.forEach(fn => fn({ peers }));
    });
  }

  // esportazione CSV: scarica direttamente il file
  const downloads = {
    save: async ({ filename, data }) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
      a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  };

  window.claude = { use: async n => ({ db, user, room, downloads })[n] || null };

  /* ---------- login ---------- */
  let avviata = false;
  function avviaApp() {
    if (avviata) return; avviata = true;
    document.getElementById("login").hidden = true;
    avviaPresenza();
    // la pagina parte solo dopo il login: il suo script è conservato come testo
    const s = document.createElement("script");
    s.textContent = document.getElementById("main-js").textContent;
    document.body.appendChild(s);
    const g = document.createElement("script"); g.src = "gps.js"; document.body.appendChild(g);
    if (window.FB.admin) { const c = document.createElement("script"); c.src = "collaboratori.js"; document.body.appendChild(c); }
  }
  function msg(t) { document.getElementById("loginMsg").textContent = t; }

  document.addEventListener("DOMContentLoaded", () => {
    // accesso con l'account Google (su Android basta sceglierlo); dopo il primo accesso l'app si apre diretta
    const google = new firebase.auth.GoogleAuthProvider();
    google.setCustomParameters({ prompt: "select_account" });
    document.getElementById("loginGoogle").addEventListener("click", async () => {
      msg("Accesso in corso…");
      try { await auth.signInWithPopup(google); }
      catch (err) {
        // finestra bloccata (succede nelle app installate): si passa alla pagina di Google e si torna qui
        if (err && /popup-blocked|operation-not-supported|popup-closed-by-browser/.test(err.code || "")) { await auth.signInWithRedirect(google); return; }
        msg(err && err.code === "auth/popup-closed-by-user" ? "" : "Accesso non riuscito, riprova.");
      }
    });
    auth.getRedirectResult().catch(() => msg("Accesso non riuscito, riprova."));
    // il controllo del login parte solo quando la schermata di accesso esiste
    auth.onAuthStateChanged(async u => {
      if (!u) { document.getElementById("login").hidden = false; return; }
      try {
        // si entra solo se l'email è nell'elenco dei collaboratori autorizzati (lo gestisce l'amministratore dall'app)
        const a = (await rt.ref("autorizzati/" + chiave(u.email)).get()).val();
        if (!a) throw new Error("non autorizzato");
        window.FB.admin = a.admin === true;
        // il proprio nome per i pallini sulla mappa e "collegati ora": quello dell'elenco, altrimenti dal profilo Google
        const nome = a.nome || String(u.displayName || u.email || "").split(" ")[0];
        await rt.ref("utenti/" + u.uid).update({ nome, email: u.email || "" });
        utenti = (await rt.ref("utenti").get()).val() || {};
        avviaApp();
      } catch (e) {
        msg(`L'account ${u.email || ""} non è autorizzato a usare l'app.`);
        auth.signOut();
      }
    });
  });
})();
