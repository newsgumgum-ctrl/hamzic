/* =========================================================
   ALBEYK – zajednički sloj podataka (sajt, šank, kuhinja)
   Firebase Firestore kad je podešen, inače DEMO (localStorage)
   ========================================================= */
(function(){
  const CFG = window.ALBEYK_CONFIG || {};
  const FB = CFG.firebase && CFG.firebase.apiKey ? CFG.firebase : null;
  const V = "10.12.2";
  const NOW = { __now: true };
  const FINAL = ["preuzeto", "odbijeno", "otkazano"];
  /* korisničko ime "hamzic" postaje Firebase nalog "hamzic@albeyk.com" */
  const toEmail = u => { u = String(u || "").trim().toLowerCase(); return u.includes("@") ? u : u + "@albeyk.com"; };

  const dayKey = (d = new Date()) => {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(d); }
    catch(e){ const z = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
  };
  const yesterdayKey = () => dayKey(new Date(Date.now() - 86400000));

  const loadScript = src => new Promise((res, rej) => {
    if(document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("Ne mogu da učitam " + src));
    document.head.appendChild(s);
  });

  /* ---------- zajedničko: normativi i skidanje sa stanja ---------- */
  const INC = n => ({ __inc: n });
  /* koliko kog artikla iz magacina treba za stavke porudžbine */
  function calcNeed(items, recipes){
    const need = {}, missing = [];
    (items || []).forEach(i => {
      const r = recipes[i.id];
      if(!r || !Array.isArray(r.lines) || !r.lines.length){ missing.push(i.name || i.id); return; }
      r.lines.forEach(l => { if(l.itemId && +l.qty > 0) need[l.itemId] = (need[l.itemId] || 0) + (+l.qty) * (+i.qty || 1); });
    });
    for(const k in need) need[k] = Math.round(need[k] * 1000) / 1000;
    return { need, missing };
  }

  /* ---------------- FIREBASE ---------------- */
  function firebaseImpl(){
    let db, auth, FV;
    const toMs = v => (v && typeof v.toMillis === "function") ? v.toMillis() : v;
    const norm = doc => {
      const d = doc.data({ serverTimestamps: "estimate" }) || {};
      for(const k of Object.keys(d)) d[k] = toMs(d[k]);
      d.id = doc.id;
      return d;
    };
    const prep = patch => {
      const out = {};
      for(const [k, v] of Object.entries(patch)) out[k] = v === NOW ? FV.serverTimestamp() : (v && typeof v === "object" && "__inc" in v) ? FV.increment(v.__inc) : v;
      return out;
    };
    return {
      mode: "firebase",
      async init(opts = {}){
        const base = `https://www.gstatic.com/firebasejs/${V}/`;
        await loadScript(base + "firebase-app-compat.js");
        await loadScript(base + "firebase-firestore-compat.js");
        if(opts.staff) await loadScript(base + "firebase-auth-compat.js");
        if(!firebase.apps.length) firebase.initializeApp(FB);
        db = firebase.firestore(); FV = firebase.firestore.FieldValue;
        if(opts.staff) auth = firebase.auth();
      },
      async createOrder(o){
        const day = dayKey();
        const cref = db.collection("counters").doc(day);
        const oref = db.collection("orders").doc();
        let num = 0;
        await db.runTransaction(async t => {
          const c = await t.get(cref);
          num = c.exists ? (c.data().n || 0) + 1 : 1;
          t.set(cref, { n: num });
          t.set(oref, Object.assign({}, o, { num, day, status: "novo", createdAt: FV.serverTimestamp() }));
        });
        return { id: oref.id, num };
      },
      watchOrder(id, cb){
        return db.collection("orders").doc(id).onSnapshot(s => cb(s.exists ? norm(s) : null), err => cb(undefined, err));
      },
      cancelOrder(id){
        return db.collection("orders").doc(id).update({ status: "otkazano", canceledAt: FV.serverTimestamp() });
      },
      watchSettings(cb){
        return db.collection("settings").doc("main").onSnapshot(s => cb(Object.assign({ accepting: true, busyMin: 0 }, s.exists ? s.data() : {})), () => cb({ accepting: true, busyMin: 0 }));
      },
      /* osoblje */
      onAuth(cb){ return auth.onAuthStateChanged(u => cb(u ? { email: u.email } : null)); },
      signIn(user, pass){ return auth.signInWithEmailAndPassword(toEmail(user), pass); },
      signOut(){ return auth.signOut(); },
      watchOrders(cb){
        return db.collection("orders").where("day", "in", [yesterdayKey(), dayKey()])
          .onSnapshot(s => cb(s.docs.map(norm)), err => cb(null, err));
      },
      updateOrder(id, patch){ return db.collection("orders").doc(id).update(prep(patch)); },
      setSettings(patch){ return db.collection("settings").doc("main").set(patch, { merge: true }); },
      watchConnection(cb){
        const f = () => cb(navigator.onLine);
        addEventListener("online", f); addEventListener("offline", f); f();
      },

      /* ----- opšte kolekcije (magacin, radnici, fiskal) ----- */
      watchCol(name, cb, opts = {}){
        let q = db.collection(name);
        if(opts.since != null) q = q.where(opts.field || "ts", ">=", opts.since);
        return q.onSnapshot(s => cb(s.docs.map(norm)), err => cb(null, err));
      },
      watchDoc(name, id, cb){
        return db.collection(name).doc(id).onSnapshot(s => cb(s.exists ? norm(s) : null), err => cb(undefined, err));
      },
      async addDoc(name, data){ const r = await db.collection(name).add(prep(data)); return r.id; },
      newId(name){ return db.collection(name).doc().id; },
      setDoc(name, id, data, merge){ return db.collection(name).doc(id).set(prep(data), { merge: !!merge }); },
      updateDoc(name, id, patch){ return db.collection(name).doc(id).update(prep(patch)); },
      delDoc(name, id){ return db.collection(name).doc(id).delete(); },
      async batchWrite(ops){
        for(let i = 0; i < ops.length; i += 450){
          const b = db.batch();
          ops.slice(i, i + 450).forEach(o => {
            const ref = o.id ? db.collection(o.col).doc(o.id) : db.collection(o.col).doc();
            if(o.op === "delete") b.delete(ref);
            else if(o.op === "update") b.update(ref, prep(o.data));
            else b.set(ref, prep(o.data), { merge: !!o.merge });
          });
          await b.commit();
        }
      },
      async consumeOrder(id, revert){
        const rs = await db.collection("recipes").get();
        const recipes = {}; rs.docs.forEach(d => recipes[d.id] = d.data());
        const oref = db.collection("orders").doc(id);
        await db.runTransaction(async t => {
          const os = await t.get(oref); if(!os.exists) return;
          const o = os.data();
          if(!revert && o.stockDone) return;
          if(revert && !o.stockDone) return;
          const { need, missing } = calcNeed(o.items, recipes);
          const ids = Object.keys(need);
          const snaps = await Promise.all(ids.map(i => t.get(db.collection("inv_items").doc(i))));
          t.update(oref, revert ? { stockDone: false, stockRevertedAt: FV.serverTimestamp() } : { stockDone: true, stockAt: FV.serverTimestamp(), stockMissing: missing });
          const now = Date.now(), day = dayKey();
          snaps.forEach((sn, k) => {
            if(!sn.exists) return;
            const q = need[ids[k]] * (revert ? 1 : -1);
            t.update(sn.ref, { stock: FV.increment(q) });
            t.set(db.collection("inv_moves").doc(), { ts: now, day, type: revert ? "storno" : "prodaja", itemId: ids[k], qty: q, cost: sn.data().cost || 0, ref: id, note: (revert ? "Vraćeno: sajt #" : "Sajt #") + o.num });
          });
        });
      }
    };
  }

  /* ---------------- DEMO (isti browser) ---------------- */
  function demoImpl(){
    const K = { o: "albeyk_demo_orders", s: "albeyk_demo_settings", c: "albeyk_demo_counter_" };
    /* demo prijava (samo za probu u jednom browseru; prava zaštita je Firebase nalog) */
    const DEMO_ADMIN = { user: "hamzic", pass: "hamzic" };
    const SESSION = "albeyk_demo_session";
    const authSubs = new Set();
    const read = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch(e){ return def; } };
    const write = (k, v) => { localStorage.setItem(k, JSON.stringify(v)); fire(); };
    const subs = new Set();
    const fire = () => subs.forEach(f => { try { f(); } catch(e){ console.error(e); } });
    addEventListener("storage", e => { if(e.key && e.key.startsWith("albeyk_demo")) fire(); });
    const sub = f => { subs.add(f); f(); return () => subs.delete(f); };
    const orders = () => read(K.o, {});
    const val = (v, old) => v === NOW ? Date.now() : (v && typeof v === "object" && "__inc" in v) ? Math.round(((+old || 0) + v.__inc) * 1000) / 1000 : v;
    const COL = "albeyk_demo_c_";
    const colRead = name => read(COL + name, {});
    return {
      mode: "demo",
      async init(){},
      async createOrder(o){
        const day = dayKey(), ck = K.c + day;
        const num = (read(ck, 0) || 0) + 1;
        localStorage.setItem(ck, JSON.stringify(num));
        const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const all = orders();
        all[id] = Object.assign({}, o, { num, day, status: "novo", createdAt: Date.now() });
        write(K.o, all);
        return { id, num };
      },
      watchOrder(id, cb){ return sub(() => { const o = orders()[id]; cb(o ? Object.assign({ id }, o) : null); }); },
      async cancelOrder(id){ const all = orders(); if(all[id] && all[id].status === "novo"){ all[id].status = "otkazano"; all[id].canceledAt = Date.now(); write(K.o, all); } },
      watchSettings(cb){ return sub(() => cb(Object.assign({ accepting: true, busyMin: 0 }, read(K.s, {})))); },
      onAuth(cb){
        const f = () => { const u = localStorage.getItem(SESSION); cb(u ? { email: u } : null); };
        const on = e => { if(e.key === SESSION) f(); };
        addEventListener("storage", on); authSubs.add(f); f();
        return () => { removeEventListener("storage", on); authSubs.delete(f); };
      },
      async signIn(user, pass){
        if(String(user).trim().toLowerCase() !== DEMO_ADMIN.user || pass !== DEMO_ADMIN.pass){
          const e = new Error("Pogrešno korisničko ime ili lozinka."); e.code = "auth/invalid-credential"; throw e;
        }
        localStorage.setItem(SESSION, DEMO_ADMIN.user);
        authSubs.forEach(f => f());
      },
      async signOut(){ localStorage.removeItem(SESSION); authSubs.forEach(f => f()); },
      watchOrders(cb){
        return sub(() => {
          const days = [yesterdayKey(), dayKey()];
          cb(Object.entries(orders()).filter(([, o]) => days.includes(o.day)).map(([id, o]) => Object.assign({ id }, o)));
        });
      },
      async updateOrder(id, patch){
        const all = orders(); if(!all[id]) return;
        for(const [k, v] of Object.entries(patch)) all[id][k] = val(v);
        write(K.o, all);
      },
      async setSettings(patch){ write(K.s, Object.assign(read(K.s, {}), patch)); },
      watchConnection(cb){ const f = () => cb(navigator.onLine); addEventListener("online", f); addEventListener("offline", f); f(); },

      watchCol(name, cb, opts = {}){
        return sub(() => {
          let list = Object.entries(colRead(name)).map(([id, d]) => Object.assign({ id }, d));
          if(opts.since != null){ const f = opts.field || "ts"; list = list.filter(d => (d[f] ?? 0) >= opts.since); }
          cb(list);
        });
      },
      watchDoc(name, id, cb){ return sub(() => { const d = colRead(name)[id]; cb(d ? Object.assign({ id }, d) : null); }); },
      newId(){ return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
      async addDoc(name, data){ const id = this.newId(); await this.batchWrite([{ op:"set", col:name, id, data }]); return id; },
      async setDoc(name, id, data, merge){ await this.batchWrite([{ op:"set", col:name, id, data, merge }]); },
      async updateDoc(name, id, patch){ await this.batchWrite([{ op:"update", col:name, id, data:patch }]); },
      async delDoc(name, id){ await this.batchWrite([{ op:"delete", col:name, id }]); },
      async batchWrite(ops){
        const cache = {};
        const get = c => cache[c] || (cache[c] = c === "orders" ? orders() : colRead(c));
        ops.forEach(o => {
          const m = get(o.col), id = o.id || this.newId();
          if(o.op === "delete"){ delete m[id]; return; }
          const base = (o.op === "update" || o.merge) ? (m[id] || {}) : {};
          if(o.op === "update" && !m[id]) throw new Error("Ne postoji: " + o.col + "/" + id);
          const out = Object.assign({}, base);
          for(const [k, v] of Object.entries(o.data || {})) out[k] = val(v, base[k]);
          m[id] = out;
        });
        for(const c in cache) localStorage.setItem(c === "orders" ? K.o : COL + c, JSON.stringify(cache[c]));
        fire();
      },
      async consumeOrder(id, revert){
        const all = orders(), o = all[id]; if(!o) return;
        if(!revert && o.stockDone) return;
        if(revert && !o.stockDone) return;
        const recipes = colRead("recipes"), items = colRead("inv_items");
        const { need, missing } = calcNeed(o.items, recipes);
        const now = Date.now(), day = dayKey(), ops = [];
        ops.push({ op:"update", col:"orders", id, data: revert ? { stockDone:false, stockRevertedAt: now } : { stockDone:true, stockAt: now, stockMissing: missing } });
        for(const [iid, n] of Object.entries(need)){
          if(!items[iid]) continue;
          const q = n * (revert ? 1 : -1);
          ops.push({ op:"update", col:"inv_items", id:iid, data:{ stock: INC(q) } });
          ops.push({ op:"set", col:"inv_moves", data:{ ts: now, day, type: revert ? "storno" : "prodaja", itemId: iid, qty: q, cost: items[iid].cost || 0, ref: id, note: (revert ? "Vraćeno: sajt #" : "Sajt #") + o.num } });
        }
        await this.batchWrite(ops);
      },
      resetDemo(){ Object.keys(localStorage).filter(k => k.startsWith("albeyk_demo")).forEach(k => localStorage.removeItem(k)); fire(); }
    };
  }

  const impl = FB ? firebaseImpl() : demoImpl();
  impl.NOW = NOW;
  impl.INC = INC;
  impl.calcNeed = calcNeed;
  impl.FINAL = FINAL;
  impl.dayKey = dayKey;
  impl.config = CFG;
  /* da li javni sajt sme da koristi sistem: uvek sa Firebase-om,
     a demo samo lokalno (file://, localhost) ili sa ?demo u adresi */
  impl.siteEnabled = !!FB || location.protocol === "file:" || /^(localhost|127\.)/.test(location.hostname) || /[?&]demo\b/.test(location.search);
  window.AlbeykDB = impl;
})();
