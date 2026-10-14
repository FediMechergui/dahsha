/* Flixer on the Terrarium shell: hash router, views, sheets, details and the watch page.
   Adapted from Terrarium's app.js. Depends on js/api.js (FlixerApi) and js/player.js (FlixerPlayer). */
(function () {
  "use strict";

  /* ---------- Utilities ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("flixer:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("flixer:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  const ICON = {
    chev: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    ext: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="m12 2 3 7 7 .6-5.3 4.7 1.7 7L12 17.6 5.6 21.3l1.7-7L2 9.6 9 9z"/></svg>'
  };
  const SORT_OPTIONS = {
    movie: [["added", "Recently added", "Newest in the catalogue first"], ["year", "Release year", "Newest releases first"], ["oldest", "Oldest first", "Classics first"], ["title", "Title A–Z", ""]],
    tv: [["popularity", "Most popular", "TVmaze popularity"], ["rating", "Top rated", "TVmaze rating"], ["added", "Recently added", "Newest in the catalogue first"], ["year", "Release year", "Newest releases first"], ["episodes", "Most episodes", "Longest series first"], ["title", "Title A–Z", ""]]
  };
  const sortLabel = (type, key) => { const o = SORT_OPTIONS[type].find(x => x[0] === key); return o ? o[1] : ""; };
  const RATING_STEPS = [[0, "Any rating"], [6, "6+"], [7, "7+"], [8, "8+"]];

  /* ---------- State ---------- */
  const defaultFilters = () => ({ sort: "added", genres: [], yearFrom: null, yearTo: null, services: [], minRating: 0, universe: "", country: "", lang: "" });
  const state = {
    settings: Object.assign({ autoplay: true }, store.get("settings", {})),
    watchlist: store.get("watchlist", []),
    filters: Object.assign({ movie: defaultFilters(), tv: defaultFilters() }, store.get("filters", {})),
    recent: store.get("recent", []),
    progress: store.get("progress", {}),
    meta: { genres: {}, services: {}, countries: [], languages: [] },
    renderedTab: null,
    scroll: {},
    heroTimer: null,
    browse: null,
    hasHistory: false,
    player: null,
    countdown: null
  };
  const api = new Api.FlixerApi();
  api.setSettings(state.settings);
  const saveSettings = () => { store.set("settings", state.settings); api.setSettings(state.settings); };
  const UNIVERSES = window.FlixerUniverses.UNIVERSES;
  const universeName = id => { const u = UNIVERSES.find(x => x.id === id); return u ? u.name : ""; };
  const saveFilters = () => store.set("filters", state.filters);
  const saveWatchlist = () => store.set("watchlist", state.watchlist);
  const saveProgress = () => store.set("progress", state.progress);

  async function ensureMeta(type) {
    if (type && !state.meta.genres[type]) state.meta.genres[type] = await api.genres(type);
    if (type && !state.meta.services[type]) state.meta.services[type] = await api.services(type);
  }
  const genreName = (type, id) => { const g = (state.meta.genres[type] || []).find(x => x.id === id); return g ? g.name : ""; };
  const inList = item => state.watchlist.some(w => w.id === item.id);

  function isFresh(item) {
    if (!item.date) return false;
    const diff = (new Date(api.today()) - new Date(item.date)) / 86400000;
    return diff >= 0 && diff <= 14;
  }
  const fmtClock = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const epLabel = (type, e) => type === "tv" ? `S${e.season} · E${String(e.n).padStart(2, "0")}` : "Film";

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---------- Progress (resume / watched) ---------- */
  function setProgress(epId, showId, position, duration) {
    const finished = duration > 0 && duration - position < 30;
    state.progress[epId] = { showId, position, duration, finished, at: Date.now() };
    saveProgress();
  }
  function markFinished(epId, showId) {
    const p = state.progress[epId] || { showId, position: 0, duration: 0 };
    state.progress[epId] = Object.assign(p, { showId, finished: true, at: Date.now() });
    saveProgress();
  }
  const resumeAt = epId => { const p = state.progress[epId]; return p && !p.finished && p.position > 15 && p.duration - p.position > 30 ? p.position : 0; };
  const pctOf = epId => { const p = state.progress[epId]; return p && p.duration > 0 ? Math.min(100, Math.round(p.position / p.duration * 100)) : 0; };
  // Where to start a show: the first unfinished episode with progress, else the first episode.
  function entryEpisode(d) {
    const eps = d.episodes || [];
    const started = eps.filter(e => state.progress[e.id] && !state.progress[e.id].finished).sort((a, b) => state.progress[b.id].at - state.progress[a.id].at)[0];
    if (started) return started;
    const lastDone = eps.map((e, i) => state.progress[e.id] && state.progress[e.id].finished ? i : -1).reduce((a, b) => Math.max(a, b), -1);
    return eps[Math.min(lastDone + 1, eps.length - 1)] || null;
  }

  /* ---------- Components ---------- */
  function card(item, opts = {}) {
    const fresh = isFresh(item);
    const artHtml = item.poster ? `<img src="${esc(item.poster)}" alt="" loading="lazy" data-art="${esc(item.id)}">` : "";
    const r = opts.rating ? api.ratingOf(item.id) : null;
    return `<a class="card" href="#/${item.type}/${esc(item.id)}" aria-label="${esc(item.title)}">
      <div class="card__art">${artHtml}${fresh ? '<span class="card__fresh" title="New"></span>' : ""}
        ${r ? `<span class="card__rating">${r.rating.toFixed(1)}</span>` : ""}
        ${opts.showType ? `<span class="card__type">${item.type === "tv" ? "TV" : "FILM"}</span>` : ""}
      </div>
      <p class="card__title">${esc(item.title)}</p>
      <div class="card__meta">${esc(item.year || "—")}${opts.genre && item.genreIds[0] ? " · " + esc(genreName(item.type, item.genreIds[0])) : ""}${item.type === "tv" && item.episodeCount > 1 ? ` · ${item.episodeCount} ep` : ""}</div>
    </a>`;
  }
  function resumeCard(item, ep, pct) {
    return `<a class="card" href="#/watch/${esc(item.id)}/${esc(ep)}" aria-label="Resume ${esc(item.title)}">
      <div class="card__art">${item.poster ? `<img src="${esc(item.poster)}" alt="" loading="lazy" data-art="${esc(item.id)}">` : ""}
        <span class="card__resume">RESUME</span>
        <span class="card__bar"><i style="width:${pct}%"></i></span>
      </div>
      <p class="card__title">${esc(item.title)}</p>
      <div class="card__meta">${pct}% watched</div>
    </a>`;
  }
  const skelCard = () => `<div class="card skel-card"><div class="card__art skel"></div><div class="skel skel-line"></div></div>`;
  const skelRow = n => `<div class="row">${Array(n).fill(skelCard()).join("")}</div>`;
  const skelGrid = n => Array(n).fill(skelCard()).join("");

  function section(title, sub, items, opts = {}) {
    if (!items || !items.length) return "";
    return `<section class="section fade-in">
      <div class="section__head"><div><h2 class="section__title">${esc(title)}</h2>${sub ? `<span class="section__sub eyebrow">${esc(sub)}</span>` : ""}</div>
      ${opts.link ? `<a class="section__link" href="${opts.link}">See all</a>` : ""}</div>
      <div class="row">${items.map(i => card(i, opts)).join("")}</div>
    </section>`;
  }

  function emptyState(title, text, actionHtml = "") {
    return `<div class="empty fade-in"><h3 class="empty__title">${esc(title)}</h3><p class="empty__text">${esc(text)}</p>${actionHtml}</div>`;
  }

  /* ---------- Sheets ---------- */
  const root = () => $("#sheet-root");
  function syncRoot() {
    const r = root();
    r.hidden = r.children.length === 0;
    document.body.style.overflow = r.hidden ? "" : "hidden";
  }
  function openSheet({ title, body, foot = "", onOpen }) {
    closeSheet();
    const r = root();
    const scrim = document.createElement("div"); scrim.className = "scrim";
    const sheet = document.createElement("div"); sheet.className = "sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true");
    sheet.innerHTML = `<div class="sheet__grab"></div>
      <div class="sheet__head"><h2 class="sheet__title">${esc(title)}</h2><button class="iconbtn" data-close aria-label="Close">${ICON.close}</button></div>
      <div class="sheet__body">${body}</div>${foot ? `<div class="sheet__foot">${foot}</div>` : ""}`;
    r.appendChild(scrim); r.appendChild(sheet); syncRoot();
    scrim.addEventListener("click", closeSheet);
    $("[data-close]", sheet).addEventListener("click", closeSheet);
    if (onOpen) onOpen(sheet);
    return sheet;
  }
  function closeSheet() {
    $$("#sheet-root > .scrim, #sheet-root > .sheet").forEach(n => n.remove());
    syncRoot();
  }
  function closeDetails() {
    if (state.player) { state.player.destroy(); state.player = null; }
    clearInterval(state.countdown); state.countdown = null;
    $$("#sheet-root > .detail").forEach(n => n.remove());
    syncRoot();
  }
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if ($("#sheet-root > .sheet")) closeSheet(); else if ($("#sheet-root > .detail")) goBack(); }
  });

  /* ---------- Router ---------- */
  const TAB_RENDERERS = { home: renderHome, movies: v => renderBrowse(v, "movie"), shows: v => renderBrowse(v, "tv"), search: renderSearch, library: renderLibrary, universes: renderUniverses };

  function route() {
    const h = location.hash || "#/home";
    const w = h.match(/^#\/watch\/([^/]+)\/(.+)$/);
    if (w) {
      if (!state.renderedTab) renderTab("home");
      closeSheet(); closeDetails();
      openWatch(decodeURIComponent(w[1]), decodeURIComponent(w[2]));
      return;
    }
    const m = h.match(/^#\/(movie|tv)\/(.+)$/);
    if (m) {
      if (!state.renderedTab) renderTab("home");
      closeSheet(); closeDetails();
      openDetails(m[1], decodeURIComponent(m[2]));
      return;
    }
    const uv = h.match(/^#\/universe\/([^/?]+)/);
    if (uv) {
      if (!state.renderedTab) renderTab("home");
      closeSheet(); closeDetails();
      openUniverse(decodeURIComponent(uv[1]));
      return;
    }
    closeSheet(); closeDetails();
    document.title = "Flixer";
    const tab = h.slice(2).split("?")[0] || "home";
    renderTab(TAB_RENDERERS[tab] ? tab : "home");
  }

  function renderTab(tab) {
    $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.tab === tab));
    if (state.renderedTab === tab) { return; }
    if (state.renderedTab) state.scroll[state.renderedTab] = window.scrollY;
    clearInterval(state.heroTimer);
    if (state.browse && state.browse.observer) state.browse.observer.disconnect();
    state.renderedTab = tab;
    const view = $("#view");
    view.innerHTML = "";
    TAB_RENDERERS[tab](view);
    window.scrollTo(0, state.scroll[tab] || 0);
  }

  function goBack() {
    if (state.hasHistory) history.back(); else location.hash = "#/home";
  }

  /* ---------- Home ---------- */
  async function renderHome(view) {
    view.innerHTML = `<div style="height:12px"></div>
      <div class="hero" id="hero"><div class="skel" style="position:absolute;inset:0;border-radius:0"></div></div>
      <div id="home-rows">${["Just added", "New movies", "New series"].map(t => `<section class="section"><div class="section__head"><h2 class="section__title">${t}</h2></div>${skelRow(5)}</section>`).join("")}</div>`;

    const results = await Promise.allSettled([api.trending(), api.nowPlaying(), api.onTheAir(), api.topRated("movie"), api.topRated("tv"), ensureMeta("movie"), ensureMeta("tv")]);
    if (state.renderedTab !== "home") return;
    const [trend, now, air, topM, topT] = results.map(r => r.status === "fulfilled" ? r.value : null);
    const firstErr = results.find(r => r.status === "rejected");
    if (firstErr && !trend) {
      view.innerHTML = emptyState("Could not load the catalogue", firstErr.reason.message || "Check your connection and try again.", `<button class="btn btn--primary" onclick="location.reload()">Try again</button>`);
      return;
    }

    // Hero carousel
    const slides = (trend || []).filter(i => i.backdrop || i.poster).slice(0, 6);
    const hero = $("#hero");
    let idx = 0;
    function paintHero(i) {
      const s = slides[i]; if (!s) return;
      const genres = s.genreIds.slice(0, 2).map(g => genreName(s.type, g)).filter(Boolean).join(", ");
      hero.innerHTML = `<img class="hero__bg" src="${esc(s.backdrop || s.poster)}" alt="" ${s.poster && s.backdrop !== s.poster ? `onerror="this.onerror=null;this.src='${esc(s.poster)}';this.onerror=()=>this.remove()"` : ""}>
        <div class="hero__shade"></div>
        <div class="hero__dots" aria-hidden="true">${slides.map((_, j) => `<span class="${j === i ? "is-on" : ""}"></span>`).join("")}</div>
        <div class="hero__body">
          <div class="hero__eyebrow"><span class="dot"></span><span class="eyebrow">${isFresh(s) ? "Just added" : "Featured"} · ${s.type === "tv" ? "Series" : "Film"}</span></div>
          <h1 class="h-display hero__title">${esc(s.title)}</h1>
          <div class="meta hero__meta"><b>${esc(s.year || "—")}</b>${genres ? " · " + esc(genres) : ""}${s.type === "tv" && s.episodeCount > 1 ? ` · ${s.episodeCount} episodes` : ""}</div>
          <p class="hero__overview">${esc(s.overview)}</p>
          <div class="hero__actions">
            <a class="btn btn--primary" href="#/watch/${esc(s.id)}/${esc(s.firstEpisodeId)}">${ICON.play} Play</a>
            <a class="btn btn--ghost" href="#/${s.type}/${esc(s.id)}">${ICON.info} Details</a>
            <button class="btn btn--ghost ${inList(s) ? "is-on" : ""}" data-save aria-label="My list">${ICON.bookmark}</button>
          </div>
        </div>`;
      $("[data-save]", hero).addEventListener("click", e => { toggleList(s); e.currentTarget.classList.toggle("is-on", inList(s)); });
      // Lean index entries have no synopsis: fetch it live and fill it in while the slide is up.
      if (!s.overview) api.details(s.type, s.id).then(d => { if (d.overview && slides[idx] === s) { s.overview = d.overview; const p = $(".hero__overview", hero); if (p) p.textContent = d.overview; } }).catch(() => {});
    }
    if (slides.length) {
      paintHero(0);
      let x0 = null;
      hero.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
      hero.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { idx = (idx + (dx < 0 ? 1 : slides.length - 1)) % slides.length; paintHero(idx); restart(); } x0 = null; });
      const restart = () => { clearInterval(state.heroTimer); state.heroTimer = setInterval(() => { idx = (idx + 1) % slides.length; paintHero(idx); }, 7000); };
      restart();
    } else hero.remove();

    // Continue watching
    const resumeRow = await continueWatchingRow();
    if (state.renderedTab !== "home") return;

    // Genre quick row
    const mg = (state.meta.genres.movie || []).slice(0, 12);
    const genreRow = mg.length ? `<section class="section fade-in"><div class="section__head"><div><h2 class="section__title">Browse by genre</h2><span class="section__sub eyebrow">Movies · tap to filter</span></div></div>
      <div class="row">${mg.map(g => `<button class="chip" data-genre="${esc(g.id)}">${esc(g.name)} <span class="chip__val">${g.count}</span></button>`).join("")}</div></section>` : "";
    // Universes row: small scrollable logo tiles, in order of how much of each universe Flixer has.
    const universes = (await api.universeList()).filter(u => u.count > 0);
    const universeRow = universes.length ? `<section class="section fade-in"><div class="section__head"><div><h2 class="section__title">Universes</h2><span class="section__sub eyebrow">Shared universes and franchises · watch orders</span></div><a class="section__link" href="#/universes">See all</a></div>
      <div class="ulogos">${universes.map(u => `<a class="utile" href="#/universe/${esc(u.id)}" title="${esc(u.name)}">${u.logo ? `<img src="${esc(u.logo)}" alt="${esc(u.short)}" loading="lazy" onerror="this.outerHTML='<span class=\\'utile__mono\\'>'+this.alt.replace(/</g,'')+'</span>'">` : `<span class="utile__mono">${esc(u.short)}</span>`}<span class="utile__n">${u.count} titles</span></a>`).join("")}</div></section>` : "";
    const services = await api.serviceList(40);
    const serviceRow = services.length ? `<section class="section fade-in"><div class="section__head"><div><h2 class="section__title">Streaming services</h2><span class="section__sub eyebrow">Where Flixer's series air or stream · tap to browse</span></div><a class="section__link" href="#/shows" data-svc-all>All series</a></div>
      <div class="ulogos">${services.map(s => `<a class="utile utile--svc" href="#/shows" data-svc="${esc(s.name)}" title="${esc(s.name)}">${s.logo ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}" loading="lazy" onerror="this.outerHTML='<span class=\\'utile__mono\\'>'+this.alt.replace(/</g,'')+'</span>'">` : `<span class="utile__mono">${esc(s.name)}</span>`}<span class="utile__n">${s.count} series</span></a>`).join("")}</div></section>` : "";
    const [popularTv, ratedTv, topUni] = await Promise.all([api.popular("tv", 14), api.topRated("tv", 14), api.topUniverses(3)]);
    const uniRails = await Promise.all(topUni.map(async u => section(u.name, `${u.count} titles in Flixer`, await api.universeRail(u.id, 14), { showType: true, rating: true })));
    if (state.renderedTab !== "home") return;

    $("#home-rows").innerHTML =
      resumeRow +
      section("Popular series", "TVmaze popularity", popularTv, { rating: true }) +
      section("Just added", "Movies and series", (trend || []).slice(0, 20), { showType: true }) +
      section("New movies", "Latest additions", now, { link: "#/movies" }) +
      section("New series", "Latest additions", air, { link: "#/shows" }) +
      genreRow + universeRow + serviceRow +
      uniRails.join("") +
      section("Top rated series", "TVmaze rating", ratedTv, { rating: true }) +
      section("Recent releases", "Films by release year", topM, { genre: true }) +
      section("Longest series", "Most episodes available", topT, { genre: true });

    $$("[data-svc]", view).forEach(b => b.addEventListener("click", () => {
      state.filters.tv = Object.assign(defaultFilters(), { services: [b.dataset.svc], sort: "popularity" }); saveFilters(); state.renderedTab = null;
    }));
    $("[data-svc-all]", view)?.addEventListener("click", () => { state.filters.tv = Object.assign(defaultFilters(), { sort: "popularity" }); saveFilters(); state.renderedTab = null; });
    $$("[data-genre]", view).forEach(b => b.addEventListener("click", () => {
      state.filters.movie = Object.assign(defaultFilters(), { genres: [b.dataset.genre] }); saveFilters(); location.hash = "#/movies";
    }));
  }

  /* ---------- Universes: all of them, and one universe in watch order ---------- */
  const uniLogo = (u, cls) => u.logo ? `<img src="${esc(u.logo)}" alt="${esc(u.name)}" loading="lazy" onerror="this.outerHTML='<span class=\\'ucard__mono\\'>'+this.alt.replace(/</g,'')+'</span>'">` : `<span class="${cls || "ucard__mono"}">${esc(u.short)}</span>`;
  async function renderUniverses(view) {
    view.innerHTML = `<div class="section__head" style="margin-top:14px"><div><h2 class="section__title">Universes</h2><span class="section__sub eyebrow">Shared universes and franchises · logos and orders from Wikidata</span></div></div><div class="ugrid">${Array(6).fill('<div class="ucard"><div class="ucard__logo skel" style="height:56px"></div><div class="skel skel-line"></div></div>').join("")}</div>`;
    const list = await api.universeList();
    if (state.renderedTab !== "universes") return;
    $(".ugrid", view).innerHTML = list.map(u => `<a class="ucard" href="#/universe/${esc(u.id)}">
        <div class="ucard__logo">${uniLogo(u)}</div>
        <p class="ucard__name">${esc(u.name)}</p>
        <div class="meta ucard__meta"><b>${u.count}</b> in Flixer${u.total ? ` · ${u.total} known` : ""}</div>
        ${u.home.length ? `<div class="ucard__home">${u.home.map(h => `<span>${esc(h)}</span>`).join("")}</div>` : ""}
      </a>`).join("") || emptyState("No universes yet", "Universe data is built with the catalogue.");
  }

  async function openUniverse(id) {
    const r = root();
    const el = document.createElement("div"); el.className = "detail"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `<button class="detail__back" data-back aria-label="Back">${ICON.back}</button><div style="height:70px"></div><div class="uhead"><div class="uhead__logo skel" style="height:84px;width:60%"></div><div class="skel skel-line" style="width:40%"></div></div>`;
    r.appendChild(el); syncRoot();
    $("[data-back]", el).addEventListener("click", goBack);
    let u;
    try { u = await api.universe(id); } catch (e) { el.innerHTML = `<button class="detail__back" data-back aria-label="Back">${ICON.back}</button><div style="height:80px"></div>${emptyState("Could not open this universe", e.message)}`; $("[data-back]", el).addEventListener("click", goBack); return; }
    if (!el.isConnected) return;
    document.title = `${u.name} — Flixer`;
    let order = u.numbered ? "numbered" : "release", kind = "all";
    const paintList = () => {
      let list = u.members.filter(m => kind === "all" || m.type === kind);
      if (order === "numbered") list = list.slice().sort((a, b) => (a.ordinal == null) - (b.ordinal == null) || (a.ordinal || 0) - (b.ordinal || 0) || String(a.date || "9999").localeCompare(String(b.date || "9999")));
      else if (order === "flixer") list = list.filter(m => m.item);
      $("#uorder", el).innerHTML = list.map((m, i) => {
        const it = m.item;
        const n = order === "numbered" && m.ordinal != null ? m.ordinal : i + 1;
        const inner = `<span class="orow__n">${n}</span>
          <div class="orow__art">${it && it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy" data-art="${esc(it.id)}">` : ""}</div>
          <div><p class="orow__title">${esc(m.title)}</p><div class="meta orow__meta">${esc(m.year || "—")} · ${m.type === "tv" ? "Series" : "Film"}${it && it.rating ? ` · ${ICON.star} ${it.rating.toFixed(1)}` : ""}${it && it.service ? ` · ${esc(it.service)}` : ""}</div></div>
          ${it ? `<span class="orow__go" title="Play">${ICON.play}</span>` : "<span></span>"}`;
        return it ? `<a class="orow" href="#/${it.type}/${esc(it.id)}">${inner}</a>` : `<div class="orow orow--out">${inner}</div>`;
      }).join("") || `<p class="empty__text" style="padding:12px 0">Nothing in this view.</p>`;
    };
    const svc = [...u.home.map(h => ({ name: h, home: true })), ...u.services.filter(s => !u.home.includes(s.name)).map(s => ({ name: s.name, count: s.count }))];
    el.innerHTML = `
      <button class="detail__back" data-back aria-label="Back">${ICON.back}</button>
      <div style="height:70px"></div>
      <div class="uhead">
        <div class="uhead__logo">${uniLogo(u, "h-display")}</div>
        <div class="eyebrow">Universe · <b>${u.inFlixer}</b> of ${u.members.length} titles in Flixer${u.generatedAt ? ` · updated ${esc(String(u.generatedAt).slice(0, 10))}` : ""}</div>
        <h1 class="h-display detail__title" style="margin-top:6px">${esc(u.name)}</h1>
        ${u.description ? `<p class="uhead__desc">${esc(u.description.charAt(0).toUpperCase() + u.description.slice(1))}${u.wiki ? ` · <a href="${esc(u.wiki)}" target="_blank" rel="noopener" style="color:var(--amber)">Wikipedia</a>` : ""}</p>` : ""}
        ${svc.length ? `<section class="sub-section"><h3 class="sub-section__title">Where it streams</h3><div class="providers">${svc.map(s => `<span class="provider" ${s.home ? 'style="border:1px solid rgba(124,203,149,.5)"' : ""}>${esc(s.name)}${s.home ? ` <span class="opt__hint" style="color:var(--fern)">home</span>` : s.count ? ` <span class="opt__hint">${s.count} series</span>` : ""}</span>`).join("")}</div><p class="attrib">Home services are curated; the rest come from TVmaze for the series in Flixer.</p></section>` : ""}
        <div class="detail__actions" style="margin-top:14px">
          <a class="btn btn--primary" href="#/movies" data-browse>${ICON.play} Browse in Flixer</a>
        </div>
      </div>
      <div class="pills" style="margin-top:10px">${[["release", "Release order"], ...(u.numbered ? [["numbered", "Numbered order"]] : []), ["flixer", "Only in Flixer"]].map(([k, l]) => `<button class="pill ${order === k ? "is-active" : ""}" data-order="${k}">${l}</button>`).join("")}</div>
      <div class="pills" style="padding-top:0">${[["all", "All"], ["movie", "Films"], ["tv", "Series"]].map(([k, l]) => `<button class="pill ${kind === k ? "is-active" : ""}" data-kind="${k}">${l}</button>`).join("")}</div>
      <div class="order" id="uorder"></div>
      <div style="height:40px"></div>`;
    $("[data-back]", el).addEventListener("click", goBack);
    $("[data-browse]", el).addEventListener("click", () => { state.filters.movie = Object.assign(defaultFilters(), { universe: id }); state.filters.tv = Object.assign(defaultFilters(), { universe: id, sort: "popularity" }); saveFilters(); state.renderedTab = null; });
    $$("[data-order]", el).forEach(b => b.addEventListener("click", () => { order = b.dataset.order; $$("[data-order]", el).forEach(x => x.classList.toggle("is-active", x === b)); paintList(); }));
    $$("[data-kind]", el).forEach(b => b.addEventListener("click", () => { kind = b.dataset.kind; $$("[data-kind]", el).forEach(x => x.classList.toggle("is-active", x === b)); paintList(); }));
    paintList();
    el.scrollTop = 0;
  }

  async function continueWatchingRow() {
    const entries = Object.entries(state.progress).filter(([, p]) => p && !p.finished && p.position > 15).sort((a, b) => b[1].at - a[1].at).slice(0, 12);
    if (!entries.length) return "";
    const cards = [];
    const seen = new Set();
    for (const [epId, p] of entries) {
      if (seen.has(p.showId)) continue;
      const item = await api.item(p.showId);
      if (!item) continue;
      seen.add(p.showId);
      cards.push(resumeCard(item, epId, pctOf(epId)));
    }
    if (!cards.length) return "";
    return `<section class="section fade-in"><div class="section__head"><div><h2 class="section__title">Continue watching</h2><span class="section__sub eyebrow">Pick up where you left off</span></div></div><div class="row">${cards.join("")}</div></section>`;
  }

  /* ---------- Browse (Movies / Shows) ---------- */
  async function renderBrowse(view, type) {
    view.innerHTML = `
      <div class="browse-head">
        <div class="seg" data-active="${type}" role="tablist">
          <div class="seg__thumb"></div>
          <button class="seg__btn ${type === "movie" ? "is-active" : ""}" role="tab" data-go="#/movies">Movies</button>
          <button class="seg__btn ${type === "tv" ? "is-active" : ""}" role="tab" data-go="#/shows">Shows</button>
        </div>
      </div>
      <div class="rail-wrap"><div class="rail" id="rail"></div></div>
      <div class="result-head"><span class="count" id="count">Loading…</span><span class="meta" id="sortlabel"></span></div>
      <div class="grid" id="grid">${skelGrid(9)}</div>
      <div class="sentinel" id="sentinel"></div>
      <div class="loader" id="loader" hidden>Loading more…</div>`;
    $$("[data-go]", view).forEach(b => b.addEventListener("click", () => { location.hash = b.dataset.go; }));

    const b = state.browse = { type, page: 0, totalPages: 1, loading: false, observer: null, seq: 0 };
    try { await ensureMeta(type); } catch (e) { $("#grid").innerHTML = ""; $("#count").textContent = ""; view.insertAdjacentHTML("beforeend", emptyState("Could not load filters", e.message)); return; }
    if (state.renderedTab !== (type === "movie" ? "movies" : "shows")) return;
    renderRail();
    await loadPage(true);

    b.observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting && !b.loading && b.page < b.totalPages) loadPage(false); }, { rootMargin: "600px" });
    b.observer.observe($("#sentinel"));
  }

  function filterSummary(type) {
    const f = state.filters[type];
    const parts = [];
    if (f.genres.length) parts.push(f.genres.length === 1 ? genreName(type, f.genres[0]) : f.genres.length + " genres");
    if (f.yearFrom || f.yearTo) parts.push((f.yearFrom || "…") + (f.yearTo && f.yearTo !== f.yearFrom ? "–" + f.yearTo : f.yearTo ? "" : "–now"));
    if (f.services && f.services.length) parts.push(f.services.join(", "));
    if (f.minRating) parts.push("rated " + f.minRating + "+");
    if (f.universe) parts.push(universeName(f.universe));
    return parts;
  }

  function renderRail() {
    const type = state.browse.type, f = state.filters[type];
    const chip = (key, label, val) => `<button class="chip ${val ? "is-set" : ""}" data-filter="${key}">${esc(label)}${val ? ` <span class="chip__val">${esc(val)}</span>` : ""} ${ICON.chev}</button>`;
    const yearVal = (f.yearFrom || f.yearTo) ? (f.yearFrom && f.yearTo && f.yearFrom === f.yearTo ? String(f.yearFrom) : (f.yearFrom || "…") + "–" + (f.yearTo || "now")) : "";
    const svcVal = f.services && f.services.length ? (f.services.length === 1 ? f.services[0] : String(f.services.length)) : "";
    const any = f.genres.length || f.yearFrom || f.yearTo || f.sort !== "added" || svcVal || f.minRating || f.universe;
    $("#rail").innerHTML =
      chip("sort", "Sort", f.sort !== "added" ? sortLabel(type, f.sort) : "") +
      chip("genre", "Genre", f.genres.length ? (f.genres.length === 1 ? genreName(type, f.genres[0]) : f.genres.length) : "") +
      chip("year", "Year", yearVal) +
      chip("universe", "Universe", f.universe ? (UNIVERSES.find(u => u.id === f.universe) || {}).short || "" : "") +
      (type === "tv" ? chip("services", "Streaming on", svcVal) + chip("rating", "Rating", f.minRating ? f.minRating + "+" : "") : "") +
      (any ? `<button class="chip chip--reset" data-filter="reset">Reset</button>` : "");
    $$("[data-filter]", $("#rail")).forEach(c => c.addEventListener("click", () => openFilter(c.dataset.filter)));
    $("#sortlabel").textContent = filterSummary(type).join(" · ");
  }

  async function loadPage(reset) {
    const b = state.browse, type = b.type;
    const grid = $("#grid"), loader = $("#loader");
    if (!grid) return;
    if (reset) { b.page = 0; b.totalPages = 1; grid.innerHTML = skelGrid(9); $("#count").textContent = "Loading…"; window.scrollTo({ top: 0 }); }
    b.loading = true; loader.hidden = !!reset;
    const seq = ++b.seq;
    try {
      const r = await api.discover(type, state.filters[type], b.page + 1);
      if (seq !== b.seq) return;
      b.page = r.page; b.totalPages = r.totalPages;
      b.loaded = (reset ? 0 : (b.loaded || 0)) + r.items.length;
      const html = r.items.map(i => card(i, { rating: true })).join("");
      if (reset) grid.innerHTML = html; else grid.insertAdjacentHTML("beforeend", html);
      $("#count").innerHTML = r.total ? `<b>${r.total.toLocaleString()}</b> ${type === "tv" ? "series" : "films"}` : "No results";
      if (!r.items.length && reset) grid.innerHTML = `<div style="grid-column:1/-1">${emptyState("Nothing matches these filters", "Loosen the year range or remove a genre to see more.", `<button class="btn btn--outline" data-reset>Reset filters</button>`)}</div>`;
      $("[data-reset]", grid)?.addEventListener("click", () => applyFilters(defaultFilters()));
    } catch (e) {
      if (seq !== b.seq) return;
      grid.innerHTML = `<div style="grid-column:1/-1">${emptyState("Could not load titles", e.message, `<button class="btn btn--primary" data-retry>Try again</button>`)}</div>`;
      $("[data-retry]", grid)?.addEventListener("click", () => loadPage(true));
      $("#count").textContent = "";
    } finally { b.loading = false; loader.hidden = true; }
  }

  function applyFilters(next) {
    const type = state.browse.type;
    state.filters[type] = Object.assign(defaultFilters(), next); saveFilters();
    closeSheet(); renderRail(); loadPage(true);
  }

  /* ---------- Filter sheets ---------- */
  function openFilter(key) {
    const type = state.browse.type, f = state.filters[type];
    if (key === "reset") return applyFilters(defaultFilters());
    if (key === "sort") return openRadioSheet("Sort by", SORT_OPTIONS[type], f.sort, v => applyFilters(Object.assign({}, f, { sort: v })));
    if (key === "genre") return openGenreSheet(type, f);
    if (key === "year") return openYearSheet(f);
    if (key === "rating") return openRadioSheet("Minimum rating", RATING_STEPS.map(([v, l]) => [String(v), l, v ? "TVmaze rating" : ""]), String(f.minRating || 0), v => applyFilters(Object.assign({}, f, { minRating: +v })));
    if (key === "universe") return openUniverseSheet(f);
    if (key === "services") return openServicesSheet(type, f);
  }

  async function openUniverseSheet(f) {
    const list = (await api.universes()).filter(u => u.count > 0);
    openRadioSheet("Universe / franchise", [["", "Any", ""], ...list.map(u => [u.id, u.name, `${u.count} title${u.count === 1 ? "" : "s"}`])], f.universe || "", v => applyFilters(Object.assign({}, f, { universe: v })));
  }

  async function openServicesSheet(type, f) {
    await ensureMeta(type);
    const list = state.meta.services[type] || [];
    const sel = new Set(f.services || []);
    openSheet({
      title: "Streaming on",
      body: `<p class="eyebrow" style="margin:0 0 12px">Network or streaming service · TVmaze · pick one or several</p>
        <div class="search-field" style="margin-bottom:8px"><input class="search-input" id="svc-q" placeholder="Type to filter" autocomplete="off"></div>
        <div class="optlist" id="svc-rows"></div>`,
      foot: `<button class="btn btn--outline" data-clear>Clear</button><button class="btn btn--primary" data-apply>Show results</button>`,
      onOpen: s => {
        const rows = $("#svc-rows", s);
        const paint = q => {
          const needle = q.trim().toLowerCase();
          rows.innerHTML = list.filter(p => !needle || p.name.toLowerCase().includes(needle)).slice(0, 80).map(p => `<button class="opt ${sel.has(p.name) ? "is-on" : ""}" data-s="${esc(p.name)}"><span>${esc(p.name)} <span class="opt__hint">${p.count}</span></span><span class="opt__check">${ICON.check}</span></button>`).join("") || `<p class="empty__text">No services match.</p>`;
          $$("[data-s]", rows).forEach(b => b.addEventListener("click", () => { const id = b.dataset.s; sel.has(id) ? sel.delete(id) : sel.add(id); b.classList.toggle("is-on", sel.has(id)); }));
        };
        paint("");
        $("#svc-q", s).addEventListener("input", e => paint(e.target.value));
        $("[data-clear]", s).addEventListener("click", () => applyFilters(Object.assign({}, f, { services: [] })));
        $("[data-apply]", s).addEventListener("click", () => applyFilters(Object.assign({}, f, { services: [...sel] })));
      }
    });
  }

  function openRadioSheet(title, options, current, onPick) {
    openSheet({
      title,
      body: `<div class="optlist">${options.map(([v, label, hint]) => `<button class="opt opt--radio ${v === current ? "is-on" : ""}" data-v="${esc(v)}"><span>${esc(label)}${hint ? `<br><span class="opt__hint">${esc(hint)}</span>` : ""}</span><span class="opt__check">${ICON.check}</span></button>`).join("")}</div>`,
      onOpen: s => $$("[data-v]", s).forEach(b => b.addEventListener("click", () => onPick(b.dataset.v)))
    });
  }

  function openGenreSheet(type, f) {
    const sel = new Set(f.genres);
    const genres = state.meta.genres[type] || [];
    openSheet({
      title: "Genres",
      body: `<p class="eyebrow" style="margin:0 0 12px">Pick one or several · titles must match all</p><div class="genre-grid">${genres.map(g => `<button class="gchip ${sel.has(g.id) ? "is-on" : ""}" data-g="${esc(g.id)}">${esc(g.name)}<span class="opt__hint">${g.count}</span></button>`).join("")}</div>`,
      foot: `<button class="btn btn--outline" data-clear>Clear</button><button class="btn btn--primary" data-apply>Show results</button>`,
      onOpen: s => {
        $$("[data-g]", s).forEach(b => b.addEventListener("click", () => { const id = b.dataset.g; sel.has(id) ? sel.delete(id) : sel.add(id); b.classList.toggle("is-on", sel.has(id)); }));
        $("[data-clear]", s).addEventListener("click", () => applyFilters(Object.assign({}, f, { genres: [] })));
        $("[data-apply]", s).addEventListener("click", () => applyFilters(Object.assign({}, f, { genres: [...sel] })));
      }
    });
  }

  async function openYearSheet(f) {
    const [MIN, MAX] = await api.yearRange();
    let lo = f.yearFrom || MIN, hi = f.yearTo || MAX;
    const labels = [0, .25, .5, .75, 1].map(p => Math.round(MIN + (MAX - MIN) * p));
    openSheet({
      title: "Release year",
      body: `<div class="ruler">
        <div class="ruler__readout"><span class="ruler__num" id="y-lo">${lo}</span><span class="ruler__sep">TO</span><span class="ruler__num" id="y-hi">${hi}</span></div>
        <div class="ruler__track">
          <div class="ruler__ticks"></div>
          <div class="ruler__fill" id="y-fill"></div>
          <input type="range" id="r-lo" min="${MIN}" max="${MAX}" value="${lo}" aria-label="From year">
          <input type="range" id="r-hi" min="${MIN}" max="${MAX}" value="${hi}" aria-label="To year">
          <div class="ruler__labels">${labels.map(l => `<span>${l}</span>`).join("")}</div>
        </div>
        <div class="ruler__presets">
          ${[["Any", MIN, MAX], ["This year", MAX, MAX], ["2020s", 2020, MAX], ["2010s", 2010, 2019], ["2000s", 2000, 2009], ["90s", 1990, 1999], ["80s", 1980, 1989], ["Classics", MIN, 1979]].map(([l, a, b]) => `<button class="chip" data-preset="${a},${b}">${l}</button>`).join("")}
        </div>
      </div>`,
      foot: `<button class="btn btn--outline" data-clear>Clear</button><button class="btn btn--primary" data-apply>Show results</button>`,
      onOpen: s => {
        const rl = $("#r-lo", s), rh = $("#r-hi", s), fill = $("#y-fill", s);
        const paint = () => {
          $("#y-lo", s).textContent = lo; $("#y-hi", s).textContent = hi;
          const a = (lo - MIN) / (MAX - MIN) * 100, b = (hi - MIN) / (MAX - MIN) * 100;
          fill.style.left = a + "%"; fill.style.width = (b - a) + "%";
          rl.value = lo; rh.value = hi;
        };
        rl.addEventListener("input", () => { lo = Math.min(+rl.value, hi); paint(); });
        rh.addEventListener("input", () => { hi = Math.max(+rh.value, lo); paint(); });
        $$("[data-preset]", s).forEach(b => b.addEventListener("click", () => { [lo, hi] = b.dataset.preset.split(",").map(Number); paint(); }));
        $("[data-clear]", s).addEventListener("click", () => applyFilters(Object.assign({}, f, { yearFrom: null, yearTo: null })));
        $("[data-apply]", s).addEventListener("click", () => applyFilters(Object.assign({}, f, { yearFrom: lo === MIN ? null : lo, yearTo: hi === MAX ? null : hi })));
        paint();
      }
    });
  }

  /* ---------- Search ---------- */
  function renderSearch(view) {
    view.innerHTML = `<div class="search-box"><div class="search-field">
        <input class="search-input" id="q" type="search" placeholder="Search movies and series" autocomplete="off" enterkeyhint="search">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </div></div>
      <div id="search-out"></div>`;
    const q = $("#q", view), out = $("#search-out", view);
    const recentHtml = () => state.recent.length ? `<div class="section__head" style="margin-top:14px"><h2 class="section__title">Recent</h2><button class="section__link" data-clear-recent>Clear</button></div><div class="recent">${state.recent.map(r => `<button class="chip" data-q="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : emptyState("Find anything", "Search by title. Results include movies and series.");
    const showRecent = () => { out.innerHTML = recentHtml(); $$("[data-q]", out).forEach(b => b.addEventListener("click", () => { q.value = b.dataset.q; run(b.dataset.q, true); })); $("[data-clear-recent]", out)?.addEventListener("click", () => { state.recent = []; store.set("recent", []); showRecent(); }); };
    let timer, seq = 0;
    async function run(text, commit) {
      const t = text.trim(); const my = ++seq;
      if (!t) return showRecent();
      out.innerHTML = `<div class="list">${Array(5).fill('<div class="list-item"><div class="list-item__art skel"></div><div><div class="skel skel-line" style="width:60%"></div><div class="skel skel-line" style="width:35%"></div></div></div>').join("")}</div>`;
      try {
        const r = await api.search(t);
        if (my !== seq) return;
        if (commit) { state.recent = [t, ...state.recent.filter(x => x !== t)].slice(0, 8); store.set("recent", state.recent); }
        if (!r.items.length) { out.innerHTML = emptyState("No matches for “" + t + "”", "Check the spelling or try a shorter title."); return; }
        out.innerHTML = `<div class="list fade-in">${r.items.map(i => `<a class="list-item" href="#/${i.type}/${esc(i.id)}">
          <div class="list-item__art">${i.poster ? `<img src="${esc(i.poster)}" alt="" loading="lazy" data-art="${esc(i.id)}">` : ""}</div>
          <div><p class="list-item__title">${esc(i.title)}</p><div class="meta list-item__meta">${i.type === "tv" ? "Series" : "Film"} · ${esc(i.year || "—")}${i.type === "tv" && i.episodeCount > 1 ? ` · ${i.episodeCount} ep` : ""}</div></div></a>`).join("")}</div>`;
      } catch (e) { if (my === seq) out.innerHTML = emptyState("Search failed", e.message); }
    }
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(q.value, false), 250); });
    q.addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(timer); run(q.value, true); q.blur(); } });
    showRecent();
    setTimeout(() => q.focus(), 50);
  }

  /* ---------- Library ---------- */
  function renderLibrary(view) {
    let kind = "all";
    const paint = () => {
      const items = state.watchlist.filter(i => kind === "all" || i.type === kind).slice().reverse();
      view.innerHTML = `<div class="section__head" style="margin-top:14px"><div><h2 class="section__title">My list</h2><span class="section__sub eyebrow">${state.watchlist.length} saved · stored on this device</span></div></div>
        <div class="pills">${[["all", "All"], ["movie", "Films"], ["tv", "Series"]].map(([k, l]) => `<button class="pill ${kind === k ? "is-active" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
        ${items.length ? `<div class="grid fade-in">${items.map(i => card(i, { showType: true })).join("")}</div>` : emptyState("Nothing saved yet", "Tap the bookmark on any title to keep it here.", `<a class="btn btn--primary" href="#/movies">Browse films</a>`)}`;
      $$("[data-k]", view).forEach(b => b.addEventListener("click", () => { kind = b.dataset.k; paint(); }));
    };
    paint();
  }

  function toggleList(item) {
    const i = state.watchlist.findIndex(w => w.id === item.id);
    if (i >= 0) { state.watchlist.splice(i, 1); toast("Removed from your list"); }
    else { state.watchlist.push({ id: item.id, type: item.type, title: item.title, year: item.year, date: item.date, poster: item.poster, rating: 0, genreIds: item.genreIds || [], episodeCount: item.episodeCount || 1, firstEpisodeId: item.firstEpisodeId }); toast("Saved to your list"); }
    saveWatchlist();
    if (state.renderedTab === "library") renderLibrary($("#view"));
  }

  /* ---------- Details ---------- */
  function episodeRow(d, e, activeId) {
    const p = state.progress[e.id];
    const pct = pctOf(e.id);
    const status = p && p.finished ? `<span class="episode__watched">Watched</span>` : pct ? `${pct}% watched` : "";
    return `<a class="episode ${e.id === activeId ? "is-active" : ""}" href="#/watch/${esc(d.id)}/${esc(e.id)}">
      <div class="episode__still">${e.still ? `<img src="${esc(e.still)}" alt="" loading="lazy" data-art="${esc(d.id)}">` : ""}<span class="episode__play">${ICON.play}</span></div>
      <div><div class="episode__num">${epLabel(d.type, e)}${status ? " · " + status : ""}</div><p class="episode__title">${esc(e.title)}</p>${e.overview ? `<div class="episode__ov">${esc(e.overview)}</div>` : ""}</div>
    </a>`;
  }

  async function openDetails(type, id) {
    const r = root();
    const el = document.createElement("div"); el.className = "detail"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `<button class="detail__back" data-back aria-label="Back">${ICON.back}</button>
      <div class="detail__backdrop skel" style="border-radius:0"></div>
      <div class="detail__head"><div class="detail__poster skel"></div><div><div class="skel skel-line" style="width:70%;height:28px"></div><div class="skel skel-line" style="width:40%"></div></div></div>`;
    r.appendChild(el); syncRoot();
    $("[data-back]", el).addEventListener("click", goBack);
    let d;
    try { d = await api.details(type, id); await ensureMeta(d.type); }
    catch (e) { el.innerHTML = `<button class="detail__back" data-back aria-label="Back">${ICON.back}</button><div style="height:80px"></div>${emptyState("Could not open this title", e.message)}`; $("[data-back]", el).addEventListener("click", goBack); return; }
    if (!el.isConnected) return;
    type = d.type;

    const saved = inList(d);
    const entry = entryEpisode(d);
    const entryPct = entry ? pctOf(entry.id) : 0;
    const playLabel = entry && entryPct && !(state.progress[entry.id] || {}).finished
      ? (type === "tv" ? `Resume ${epLabel(type, entry)}` : "Resume")
      : (type === "tv" && entry && entry !== d.episodes[0] ? `Play ${epLabel(type, entry)}` : "Play");
    const facts = [
      type === "tv" ? ["Seasons", `${d.seasonCount}${d.episodeCount ? ` <span class="meta">· ${d.episodeCount} ep</span>` : ""}`] : ["Type", "Feature film"],
      d.date ? ["Added", esc(d.date)] : null,
      d.year ? ["Released", esc(d.year), "amber"] : null
    ].filter(Boolean).slice(0, 3);

    el.innerHTML = `
      <button class="detail__back" data-back aria-label="Back">${ICON.back}</button>
      <button class="detail__back detail__save ${saved ? "is-on" : ""}" data-save aria-label="${saved ? "Remove from my list" : "Save to my list"}">${ICON.bookmark}</button>
      <div class="detail__backdrop">${d.backdrop || d.poster ? `<img src="${esc(d.backdrop || d.poster)}" alt="" ${d.poster && d.backdrop !== d.poster ? `onerror="this.onerror=null;this.src='${esc(d.poster)}';this.onerror=()=>this.remove()"` : ""}>` : ""}</div>
      <div class="detail__head">
        <div class="detail__poster">${d.posterLarge || d.poster ? `<img src="${esc(d.posterLarge || d.poster)}" alt="" data-art="${esc(d.id)}">` : ""}</div>
        <div>
          <div class="eyebrow" style="margin-bottom:6px">${type === "tv" ? "Series" : "Film"}${isFresh(d) ? ' · <span style="color:var(--fern)">New</span>' : ""}</div>
          <h1 class="h-display detail__title">${esc(d.title)}</h1>
          <div class="meta"><b>${esc(d.year || "—")}</b>${type === "tv" && d.episodeCount ? ` · ${d.episodeCount} episode${d.episodeCount === 1 ? "" : "s"}` : ""}</div>
        </div>
      </div>
      <div class="detail__body">
        <div class="detail__actions">
          ${entry ? `<a class="btn btn--primary" href="#/watch/${esc(d.id)}/${esc(entry.id)}">${ICON.play} ${esc(playLabel)}</a>` : ""}
          <button class="btn ${saved ? "btn--ghost is-on" : "btn--ghost"}" data-save>${ICON.bookmark} <span>${saved ? "Saved" : "My list"}</span></button>
        </div>
        <div class="tags">${d.genres.map(g => `<a class="tag" href="#/${type === "tv" ? "shows" : "movies"}" data-genre="${esc(g.id)}">${esc(g.name)}</a>`).join("")}</div>
        ${d.versions?.length ? `<section class="sub-section"><h3>Other versions with this title</h3><p>These may be different editions. Choose a version to open.</p>${d.versions.map(v=>`<a class="btn btn--ghost" href="#/${type}/${esc(v.id)}">${esc(v.title)} ${esc(v.year || '')} · ${esc(v.offerings?.[0]?.provider || 'Source')}</a>`).join('')}</section>` : ''}
        <p class="overview ${d.overview.length > 220 ? "is-clamped" : ""}" id="ov">${esc(d.overview || "No synopsis available.")}</p>
        ${d.overview.length > 220 ? `<button class="more" data-more>Read more</button>` : ""}
        <div class="facts">${facts.map(([k, v, cls]) => `<div class="fact"><div class="fact__k">${k}</div><div class="fact__v ${cls || ""}">${v}</div></div>`).join("")}</div>

        ${type === "tv" ? `<section class="sub-section"><h3 class="sub-section__title">Episodes</h3>
          ${d.seasons.length > 1 ? `<select class="season-select" id="season">${d.seasons.map(s => `<option value="${s.season_number}">${esc(s.name)} · ${s.episode_count} episodes</option>`).join("")}</select>` : ""}
          <div id="episodes" style="margin-top:6px"></div></section>` : ""}

        ${d.universes && d.universes.length ? `<div class="tags">${d.universes.map(u => `<a class="tag" href="#/universe/${esc(u)}" style="color:var(--amber)">${esc(universeName(u) || u)} · watch order</a>`).join("")}</div>` : ""}
        <div id="extras">${type === "tv" ? `<div class="loader">Loading rating, network and cast…</div>` : ""}</div>
        <div id="related"><div class="loader">Finding related titles…</div></div>

        ${d.sourceUrl ? `<p class="attrib">Source: <a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener" style="color:var(--amber)">open page ${ICON.ext}</a></p>` : ""}
        <div style="height:40px"></div>
      </div>`;

    // Related titles: same universe, same franchise, then similar titles from the index.
    api.related(d, 16).then(rel => {
      const box = $("#related", el); if (!box || !el.isConnected) return;
      const rail = (title, sub, items, opts) => items.length ? `<section class="sub-section"><h3 class="sub-section__title">${esc(title)}</h3>${sub ? `<span class="eyebrow" style="display:block;margin:-6px 0 10px">${esc(sub)}</span>` : ""}<div class="row">${items.map(i => card(i, Object.assign({ showType: true, rating: true }, opts))).join("")}</div></section>` : "";
      box.innerHTML =
        rail(`Same universe · ${rel.universeName}`, "Films and series that share the universe", rel.universe) +
        rail("Same franchise", "Titles that share the name", rel.franchise) +
        rail("More like this", "Same genres, close release years", rel.similar) ||
        "";
    }).catch(() => { const box = $("#related", el); if (box) box.innerHTML = ""; });
    $$("[data-universe]", el).forEach(b => b.addEventListener("click", () => { const id = b.dataset.universe; state.filters.movie = Object.assign(defaultFilters(), { universe: id }); state.filters.tv = Object.assign(defaultFilters(), { universe: id, sort: "popularity" }); saveFilters(); state.renderedTab = null; location.hash = type === "tv" ? "#/shows" : "#/movies"; }));

    // TVmaze extras for series: rating, where it airs or streams, status, schedule, cast.
    if (type === "tv") {
      api.extras(d).then(x => {
        const box = $("#extras", el); if (!box || !el.isConnected) return;
        if (!x || !x.matched) { box.innerHTML = ""; return; }
        const where = [x.web && x.web.name ? `<span class="provider">${esc(x.web.name)}${x.web.country ? ` <span class="opt__hint">${esc(x.web.country)}</span>` : ""}</span>` : "", x.network && x.network.name ? `<span class="provider">${esc(x.network.name)}${x.network.country ? ` <span class="opt__hint">${esc(x.network.country)}</span>` : ""}</span>` : ""].filter(Boolean).join("");
        box.innerHTML = `
          <div class="facts" style="margin-top:0">
            ${x.rating ? `<div class="fact"><div class="fact__k">TVmaze rating</div><div class="fact__v amber">${x.rating.toFixed(1)}</div></div>` : ""}
            ${x.status ? `<div class="fact"><div class="fact__k">Status</div><div class="fact__v">${esc(x.status)}</div></div>` : ""}
            ${x.runtime ? `<div class="fact"><div class="fact__k">Runtime</div><div class="fact__v">${x.runtime}m <span class="meta">/ ep</span></div></div>` : ""}
          </div>
          ${where ? `<section class="sub-section"><h3 class="sub-section__title">Where it airs or streams</h3><div class="providers">${where}</div>${x.schedule ? `<p class="attrib">${esc(x.schedule)} · data by TVmaze</p>` : `<p class="attrib">Data by TVmaze</p>`}</section>` : ""}
          ${!d.overview && x.summary ? `<p class="overview" style="margin-top:12px">${esc(x.summary)}</p>` : ""}
          ${x.cast.length ? `<section class="sub-section"><h3 class="sub-section__title">Cast</h3><div class="cast">${x.cast.map(c => `<div class="person"><div class="person__pic">${c.pic ? `<img src="${esc(c.pic)}" alt="" loading="lazy">` : ""}</div><div class="person__name">${esc(c.name)}</div><div class="person__role">${esc(c.role)}</div></div>`).join("")}</div></section>` : ""}`;
      }).catch(() => { const box = $("#extras", el); if (box) box.innerHTML = ""; });
    }

    $("[data-back]", el).addEventListener("click", goBack);
    $$("[data-save]", el).forEach(b => b.addEventListener("click", () => {
      toggleList(d);
      const on = inList(d);
      $$("[data-save]", el).forEach(x => { x.classList.toggle("is-on", on); const sp = $("span", x); if (sp) sp.textContent = on ? "Saved" : "My list"; });
    }));
    $("[data-more]", el)?.addEventListener("click", e => { $("#ov", el).classList.remove("is-clamped"); e.currentTarget.remove(); });
    $$("[data-genre]", el).forEach(a => a.addEventListener("click", () => { state.filters[type] = Object.assign(defaultFilters(), { genres: [a.dataset.genre] }); saveFilters(); state.renderedTab = null; }));

    const box = $("#episodes", el);
    if (box) {
      const sel = $("#season", el);
      const paint = () => {
        const n = sel ? +sel.value : (d.seasons[0] ? d.seasons[0].season_number : 1);
        const eps = d.episodes.filter(e => e.season === n);
        box.innerHTML = eps.map(e => episodeRow(d, e)).join("") || `<p class="empty__text">No episodes listed yet.</p>`;
      };
      if (sel) { const current = entry ? entry.season : d.seasons[d.seasons.length - 1].season_number; sel.value = String(current); sel.addEventListener("change", paint); }
      paint();
    }
    el.scrollTop = 0;
  }

  /* ---------- Watch ---------- */
  async function openWatch(showId, epId) {
    const r = root();
    const el = document.createElement("div"); el.className = "detail watch"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `<button class="detail__back" data-back aria-label="Back">${ICON.back}</button>
      <div class="watch__player"><div class="player"><div class="player__loading"><span class="spinner"></span>Finding sources…</div></div></div>
      <div class="detail__body" id="watch-info"><div class="skel skel-line" style="width:60%;height:24px"></div><div class="skel skel-line" style="width:35%"></div></div>`;
    r.appendChild(el); syncRoot();
    $("[data-back]", el).addEventListener("click", goBack);

    let ctx;
    try { ctx = await api.episode(showId, epId); await ensureMeta(ctx.show.type); }
    catch (e) { $("#watch-info", el).innerHTML = emptyState("Could not open this episode", e.message, `<a class="btn btn--primary" href="#/home">Home</a>`); return; }
    if (!el.isConnected) return;
    const { show, episode, prev, next, index, total } = ctx;
    const type = show.type;
    document.title = `${type === "tv" ? episode.title + " — " : ""}${show.title} — Flixer`;

    const info = $("#watch-info", el);
    const paintInfo = () => {
      info.innerHTML = `
        <div class="eyebrow">${type === "tv" ? `${epLabel(type, episode)} of ${total}` : "Film"} · <a href="#/${type}/${esc(show.id)}" style="color:var(--amber)">${esc(show.title)}</a></div>
        <h1 class="h-display watch__title">${esc(type === "tv" ? episode.title : show.title)}</h1>
        <div class="meta watch__meta"><b>${esc(show.year || "—")}</b>${show.genreIds.length ? " · " + esc(show.genreIds.slice(0, 3).map(g => genreName(type, g)).filter(Boolean).join(", ")) : ""}</div>
        <div class="watch__controls">
          ${prev ? `<a class="btn btn--ghost btn--sm" href="#/watch/${esc(show.id)}/${esc(prev.id)}">${ICON.prev} Previous</a>` : ""}
          ${next ? `<a class="btn btn--ghost btn--sm" href="#/watch/${esc(show.id)}/${esc(next.id)}">Next ${ICON.next}</a>` : ""}
          ${type === "tv" && total > 1 ? `<button type="button" class="watch__toggle ${state.settings.autoplay ? "is-on" : ""}" data-autoplay><span class="opt__check">${ICON.check}</span>Autoplay next</button>` : ""}
          ${episode.sourceUrl ? `<a class="btn btn--outline btn--sm" href="${esc(episode.sourceUrl)}" target="_blank" rel="noopener">Source ${ICON.ext}</a>` : ""}
        </div>
        ${show.overview ? `<p class="overview is-clamped" id="w-ov">${esc(show.overview)}</p>${show.overview.length > 220 ? `<button class="more" data-more>Read more</button>` : ""}` : ""}
        ${type === "tv" && total > 1 ? `<section class="sub-section"><h3 class="sub-section__title">Episodes</h3><div id="w-episodes">${show.episodes.filter(e => e.season === episode.season).map(e => episodeRow(show, e, episode.id)).join("")}</div></section>` : ""}
        <div style="height:40px"></div>`;
      $("[data-more]", info)?.addEventListener("click", e => { $("#w-ov", info).classList.remove("is-clamped"); e.currentTarget.remove(); });
      $("[data-autoplay]", info)?.addEventListener("click", e => { state.settings.autoplay = !state.settings.autoplay; saveSettings(); e.currentTarget.classList.toggle("is-on", state.settings.autoplay); });
    };
    paintInfo();

    let sources;
    try { sources = await api.stream(episode.id, episode.sourceUrl, show); }
    catch (e) { sources = { servers: [] }; }
    if (!el.isConnected) return;

    let lastSave = 0;
    state.player = FlixerPlayer.mount($(".watch__player", el), {
      servers: sources.servers,
      poster: episode.still || show.backdrop || show.poster,
      title: `${show.title}${type === "tv" ? " · " + episode.title : ""}`,
      startAt: resumeAt(episode.id),
      sourceUrl: episode.sourceUrl,
      onProgress: (pos, dur) => { const now = Date.now(); if (now - lastSave > 5000) { lastSave = now; setProgress(episode.id, show.id, pos, dur); } },
      onEnded: () => {
        markFinished(episode.id, show.id);
        if (next && state.settings.autoplay) startCountdown(el, show, next);
      }
    });
    el.scrollTop = 0;
  }

  function startCountdown(el, show, next) {
    clearInterval(state.countdown);
    let n = 6;
    const box = document.createElement("div"); box.className = "watch__next";
    const paint = () => { box.innerHTML = `<p>Next episode in ${n}s</p><strong>${esc(epLabel(show.type, next))} · ${esc(next.title)}</strong><div class="watch__next-actions"><a class="btn btn--primary btn--sm" href="#/watch/${esc(show.id)}/${esc(next.id)}">${ICON.play} Play now</a><button type="button" class="btn btn--ghost btn--sm" data-cancel>Cancel</button></div>`; $("[data-cancel]", box).addEventListener("click", () => { clearInterval(state.countdown); box.remove(); }); };
    paint();
    $(".watch__player", el).appendChild(box);
    state.countdown = setInterval(() => { n -= 1; if (n <= 0) { clearInterval(state.countdown); location.hash = `#/watch/${show.id}/${next.id}`; } else paint(); }, 1000);
  }

  /* ---------- Settings ---------- */
  async function openSettings() {
    const s = state.settings;
    const generated = await api.generatedAt().catch(() => null);
    const st = await api.stats().catch(() => null);
    const watched = Object.values(state.progress).filter(p => p && p.finished).length;
    openSheet({
      title: "Settings",
      body: `
        <div class="optlist">
          <button class="opt ${s.autoplay ? "is-on" : ""}" data-autoplay><span>Autoplay next episode<br><span class="opt__hint">Start the next episode 6 seconds after one ends</span></span><span class="opt__check">${ICON.check}</span></button>
        </div>
        <div class="field" style="margin-top:16px"><button class="btn btn--outline btn--block" data-wipe style="color:var(--rose)">Clear my list, searches and watch history</button>
          <p class="hint">${state.watchlist.length} saved · ${watched} watched · ${Object.keys(state.progress).length - watched} in progress</p></div>
        ${st ? `<div class="facts" style="margin-top:0"><div class="fact"><div class="fact__k">Titles</div><div class="fact__v amber">${st.total.toLocaleString()}</div></div><div class="fact"><div class="fact__k">Films</div><div class="fact__v">${st.films.toLocaleString()}</div></div><div class="fact"><div class="fact__k">Series</div><div class="fact__v">${st.series.toLocaleString()} <span class="meta">· ${st.rated.toLocaleString()} rated</span></div></div></div>` : ""}
        <p class="attrib">Flixer · index ${generated ? "built " + esc(generated.slice(0, 10)) : "bundled with the app"}${st && st.lastSync ? " · live sync " + new Date(st.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}. New titles are picked up every 3 minutes while the app is open; synopsis and episodes load when a title is opened. Series ratings, popularity, networks, cast and episode guides come from TVmaze. Playback comes from third-party players; Flixer hosts no video.</p>`,
      onOpen: sh => {
        $("[data-autoplay]", sh).addEventListener("click", e => { s.autoplay = !s.autoplay; saveSettings(); e.currentTarget.classList.toggle("is-on", s.autoplay); });
        $("[data-wipe]", sh).addEventListener("click", () => { if (confirm("Clear your saved list, recent searches and watch history on this device?")) { state.watchlist = []; state.recent = []; state.progress = {}; saveWatchlist(); store.set("recent", []); saveProgress(); closeSheet(); state.renderedTab = null; route(); toast("Cleared"); } });
      }
    });
  }

  /* ---------- Image fallback: a missing series poster is replaced from TVmaze ---------- */
  document.addEventListener("error", e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.art || img.dataset.tried) return;
    img.dataset.tried = "1";
    api.posterFallback(img.dataset.art).then(src => { if (src && src !== img.src) img.src = src; else img.remove(); }).catch(() => img.remove());
  }, true);

  /* ---------- Live catalogue updates ---------- */
  window.addEventListener("flixer:catalog", e => {
    const n = e.detail && e.detail.added;
    if (!n) return;
    toast(`${n} new title${n === 1 ? "" : "s"} added`);
    state.meta.genres = {};
    if (state.renderedTab === "home" && !$("#sheet-root > .detail")) { state.renderedTab = null; renderTab("home"); }
  });

  /* ---------- Boot ---------- */
  $("#btn-settings").addEventListener("click", openSettings);
  window.addEventListener("hashchange", () => { state.hasHistory = true; route(); });
  route();
})();
