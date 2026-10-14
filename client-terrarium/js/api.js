/* Flixer data layer. Same surface as Terrarium's TmdbApi/DemoApi so the views stay untouched.
   Tiers:
   - the bundled index (data/catalog.json): every title, lean (no synopsis), loads instantly and
     works offline; filters, sorting, search and relations run on it. Series carry TVmaze data
     (popularity weight, rating, network / web channel) merged at build time;
   - the live source tier: the Flixer endpoints (/api/...) when the app is served next to them,
     otherwise the source's public JSON API directly (same requests the Flixer server makes).
     Keeps the index fresh (new titles every few minutes), fetches synopsis and episodes when a
     title is opened, widens search;
   - TVmaze (keyless, series only): rating, where it airs or streams, status, cast, episode guide,
     poster fallback. Universes and franchises come from js/universes.js (title patterns).
   Normalized item shape (what the views consume):
   { id, type: 'movie'|'tv', title, date, year, poster, backdrop, rating, votes, genreIds, overview,
     lang, country[], episodeCount, firstEpisodeId, sourceUrl, weight, service, universes[], stem } */

(function () {
  const CFG = window.FLIXER_CONFIG || {};
  const DATA_BASE = (CFG.dataBase || "").replace(/\/$/, "");
  const API_BASE = (CFG.apiBase || "").replace(/\/$/, "");
  const PER_PAGE = 24;
  const SOURCE = "https://myflixerz.day";
  const WP = SOURCE + "/wp-json/wp/v2";
  const SYNC_EVERY = 3 * 60 * 1000;
  const DELTA_CAP = 2500;
  const UNI = window.FlixerUniverses;
  const GENRES = [
    [39, "Action", "action"], [42, "Adventure", "adventure"], [97, "Animation", "animation"], [2343589, "Biography", "biography"],
    [46, "Comedy", "comedy"], [160, "Crime", "crime"], [212, "Documentary", "documentary"], [56, "Drama", "drama"],
    [99, "Family", "family"], [48, "Fantasy", "fantasy"], [236, "History", "history"], [237, "Horror", "horror"],
    [238, "Music", "music"], [40, "Mystery", "mystery"], [130, "Romance", "romance"], [2716699, "Sci-Fi", "sci-fi"],
    [2340416, "Sport", "sport"], [45, "Thriller", "thriller"], [150, "War", "war"], [220, "Western", "western"]
  ];
  const GENRE_NAME = new Map(GENRES.map(g => [g[0], g[1]]));
  const GENRE_SLUG_ID = new Map(GENRES.map(g => [g[2], g[0]]));
  const SLUG_LABEL = new Map(GENRES.map(g => [g[2], g[1]]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem("flixer:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("flixer:" + k, JSON.stringify(v)); } catch { /* quota or unavailable */ } }
  };

  async function getJson(url, ms = 12000) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = null; }
      if (!res.ok || body == null) {
        const e = new Error((body && body.error) || (res.ok ? "Not found" : "Request failed (" + res.status + ")"));
        e.status = res.ok ? 404 : res.status;
        throw e;
      }
      return { body, headers: res.headers };
    } finally { if (timer) clearTimeout(timer); }
  }

  const titleCase = s => String(s || "").replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
  const decodeEntities = s => String(s || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") { const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return NAMED[code.toLowerCase()] || m;
  });
  const plain = html => decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const posterFor = wpId => wpId ? `${SOURCE}/wp-content/uploads/posters/${wpId}_medium.jpg` : null;
  const backdropFor = wpId => wpId ? `${SOURCE}/wp-content/uploads/posters/${wpId}.jpg` : null;
  const byAdded = (a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title);
  const byYearDesc = (a, b) => (+b.year || 0) - (+a.year || 0) || byAdded(a, b);
  const byYearAsc = (a, b) => (+a.year || 0) - (+b.year || 0) || byAdded(a, b);
  const byEpisodes = (a, b) => (b.episodeCount || 0) - (a.episodeCount || 0) || byAdded(a, b);
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const byWeight = (a, b) => (b.weight || 0) - (a.weight || 0) || (b.rating || 0) - (a.rating || 0) || byAdded(a, b);
  const byRating = (a, b) => (b.rating || 0) - (a.rating || 0) || byWeight(a, b);

  // The source sometimes titles a show in its original language while the slug keeps the
  // international name ("Poketto monsutâ" / pokemon). The slug, minus the source's random
  // de-duplication suffix ("-hx3bz"), is used as an alternate title.
  function slugTitle(slug) {
    const parts = String(slug || "").split("-").filter(Boolean);
    if (parts.length > 1 && /^(?=.*d)[a-z0-9]{4,6}$/.test(parts[parts.length - 1])) parts.pop();
    return parts.join(" ");
  }

  /* ----- raw show -> view item ----- */
  function normalize(s) {
    const type = s.kind === "series" ? "tv" : "movie";
    const date = String([s.providerUpdatedAt,s.latestAt,s.publishedAt,s.firstSeenAt].filter(Boolean).sort().pop() || "").slice(0,10);
    const poster = s.poster || {};
    const episodes = Array.isArray(s.episodes) ? s.episodes : [];
    const tvm = s.tvm || null;
    const title = decodeEntities(s.title);
    return {
      id: s.id,
      offerings: s.offerings || [],
      versions: s.versions || [],
      sourceUrl: s.sourceUrl,
      type,
      title,
      date,
      year: s.year ? String(s.year) : (date ? date.slice(0, 4) : ""),
      poster: s.portrait || poster.custom || poster.default || posterFor(s.wpId),
      backdrop: poster.backdrop || poster.hq || backdropFor(s.wpId) || poster.custom || null,
      rating: tvm ? tvm.r || 0 : 0,
      votes: 0,
      weight: tvm ? tvm.w || 0 : 0,
      service: tvm && tvm.svc ? tvm.svc : "",
      status: tvm && tvm.st ? tvm.st : "",
      tvmazeId: tvm ? tvm.id || null : null,
      tvImage: tvm && tvm.img ? tvm.img : null,
      genreIds: Array.isArray(s.tags) ? s.tags : [],
      overview: decodeEntities(s.synopsis || s.blurb),
      lang: s.contentLang || s.lang || "",
      country: tvm && tvm.c ? [tvm.c] : [],
      episodeCount: s.episodeCount || episodes.length || (type === "movie" ? 1 : 0),
      firstEpisodeId: episodes[0] ? episodes[0].id : s.firstEpisodeId || s.id,
      sourceUrl: s.sourceUrl || (type === "tv" ? `${SOURCE}/series/${s.slug}/` : `${SOURCE}/${s.slug}/`),
      alt: (() => { const a = slugTitle(s.slug); return a && UNI.norm(a) !== UNI.norm(title) ? a : ""; })(),
      universes: [...new Set([...UNI.detect(title), ...UNI.detect(slugTitle(s.slug)), ...(s._uni || [])])],
      stem: UNI.stem(title)
    };
  }

  // "The Trap – Season 1 Episode 1: The Monster" -> "The Monster"
  function episodeTitle(raw, show, isMovie) {
    if (isMovie) return show.title || raw || "";
    const t = String(raw || "");
    const m = t.match(/(?:season\s*\d+\s*)?episode\s*\d+\s*[:\-–—]\s*(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
    const stripped = t.replace(new RegExp("^" + (show.title || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[-–—:]\\s*", "i"), "").trim();
    return stripped || t;
  }
  function normalizeEpisode(e, i, show) {
    const isMovie = show.kind !== "series";
    const thumbs = e.thumbs || {};
    const slug = e.slug || String(e.id || "").replace(/^mf:[mse]:/, "");
    return {
      id: e.id,
      offerings: e.offerings || [],
      showId: show.id,
      n: e.number || e.episode || i + 1,
      season: e.season || 1,
      title: decodeEntities(episodeTitle(e.title, show, isMovie)),
      overview: "",
      still: thumbs.custom || thumbs.default || posterFor(show.wpId) || null,
      date: "",
      runtime: null,
      sourceUrl: e.sourceUrl || (isMovie ? show.sourceUrl : `${SOURCE}/episodes/${slug}/`) || ""
    };
  }
  const movieEpisode = s => ({ id: s.id, slug: s.slug, title: s.title, season: 1, number: 1, sourceUrl: s.sourceUrl || `${SOURCE}/${s.slug}/` });

  /* ----- live source tier: the same requests the Flixer server makes ----- */
  const live = {
    hasServer: null,
    years: null,
    async serverOk() {
      if (this.hasServer != null) return this.hasServer;
      try { await getJson(`${API_BASE}/api/genres`, 5000); this.hasServer = true; }
      catch { this.hasServer = false; }
      return this.hasServer;
    },
    async yearTerms() {
      if (this.years) return this.years;
      const cached = store.get("years", null);
      if (cached && Date.now() - cached.t < 7 * 86400e3) { this.years = new Map(cached.map); return this.years; }
      const map = new Map();
      for (let page = 1; page <= 8; page++) {
        const { body } = await getJson(`${WP}/release-year?per_page=100&page=${page}&_fields=id,name`, 8000);
        if (!Array.isArray(body) || !body.length) break;
        body.forEach(r => { if (/^\d{4}$/.test(r.name)) map.set(r.id, r.name); });
        if (body.length < 100) break;
      }
      this.years = map;
      store.set("years", { t: Date.now(), map: [...map] });
      return map;
    },
    format(row, years, kind) {
      const isMovie = kind === "movie";
      const year = (row["release-year"] || []).map(id => years.get(id)).find(Boolean);
      const genres = (row.categories || []).map(id => GENRE_NAME.get(id)).filter(Boolean);
      const slug = row.slug;
      const synopsis = plain((row.content && row.content.rendered) || (row.excerpt && row.excerpt.rendered) || "");
      return {
        id: `mf:${isMovie ? "m" : "s"}:${slug}`,
        wpId: row.id, slug,
        kind: isMovie ? "film" : "series",
        title: plain((row.title && row.title.rendered) || row.title),
        synopsis,
        year: year ? Number(year) : null,
        tags: genres.map(g => g.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
        publishedAt: row.date || row.date_gmt || null,
        modifiedAt: row.modified || null,
        sourceUrl: isMovie ? `${SOURCE}/${slug}/` : `${SOURCE}/series/${slug}/`
      };
    },
    async list(kind, { page = 1, perPage = 50, category, search, fields } = {}) {
      if (await this.serverOk()) {
        if (search) {
          const {body} = await getJson(`${API_BASE}/api/search?q=${encodeURIComponent(search)}`);
          const items=(Array.isArray(body)?body:body.items || []).filter(s=>s.kind===(kind==='movie'?'film':'series'));
          return {items,total:items.length,totalPages:1};
        }
        const p = new URLSearchParams({ page: String(page), perPage: String(perPage) });
        if (category) p.set("category", category);
        if (search) p.set("q", search);
        const { body } = await getJson(`${API_BASE}/api/${kind === "movie" ? "movies" : "series"}?${p}`);
        return { items: body.items || [], total: body.total || 0, totalPages: body.totalPages || 1 };
      }
      const years = await this.yearTerms();
      const p = new URLSearchParams({ per_page: String(perPage), page: String(page), orderby: "modified", order: "desc", _fields: fields || "id,slug,title,date,date_gmt,modified,categories,release-year,excerpt" });
      const cat = category && GENRE_SLUG_ID.get(category);
      if (cat) p.set("categories", String(cat));
      if (search) p.set("search", search);
      const { body, headers } = await getJson(`${WP}/${kind === "movie" ? "posts" : "tvshows"}?${p}`);
      return { items: (Array.isArray(body) ? body : []).map(r => this.format(r, years, kind)), total: Number(headers.get("x-wp-total") || 0), totalPages: Number(headers.get("x-wp-totalpages") || 1) };
    },
    async details(id, sources = []) {
      const isSeries = id.startsWith("mf:s:");
      const slug = id.replace(/^mf:[mse]:/, "");
      if (await this.serverOk()) {
        const params = new URLSearchParams({id});
        sources.filter(Boolean).forEach(source => params.append('source', source));
        const { body } = await getJson(`${API_BASE}/api/title?${params}`);
        return body;
      }
      const years = await this.yearTerms();
      const { body } = await getJson(`${WP}/${isSeries ? "tvshows" : "posts"}?slug=${encodeURIComponent(slug)}&_fields=id,slug,title,date,date_gmt,modified,categories,release-year,content,excerpt`);
      const row = Array.isArray(body) ? body[0] : null;
      if (!row) throw new Error("Title not found on the source.");
      const item = this.format(row, years, isSeries ? "series" : "movie");
      if (isSeries) item.episodes = await this.episodes(slug).catch(() => []);
      return item;
    },
    async episodes(slug) {
      const res = await fetch(`${SOURCE}/series/${slug}/`);
      if (!res.ok) return [];
      const doc = await res.text();
      const out = [];
      const seen = new Set();
      const re = /"title":"((?:[^"\\]|\\.)*)","permalink":"((?:[^"\\]|\\.)*)","season":(\d+),"episode":(\d+)/g;
      let m;
      while ((m = re.exec(doc)) !== null) {
        const permalink = m[2].replace(/\\\//g, "/");
        const em = /\/episodes\/([^/]+)\/?$/.exec(permalink);
        const epSlug = em && em[1];
        if (!epSlug || seen.has(epSlug)) continue;
        seen.add(epSlug);
        let title = m[1];
        try { title = JSON.parse(`"${m[1]}"`); } catch { /* keep raw */ }
        const season = Number(m[3]), episode = Number(m[4]);
        out.push({ id: `mf:e:${epSlug}`, slug: epSlug, title: plain(title).replace(/^.*?\bS\d{1,3}\s*E\d{1,4}\b\s*[-–—:]?\s*/i, "").trim() || `Episode ${episode}`, season, number: episode, episode, sourceUrl: `${SOURCE}/episodes/${epSlug}/` });
      }
      return out;
    }
  };

  class FlixerApi {
    constructor() {
      this.isDemo = false;
      this._catalog = null;
      this._loading = null;
      this._byId = new Map();
      this._details = new Map();
      this._syncing = false;
      this._lastSync = 0;
      this._timer = null;
      this.liveEnabled = CFG.live !== false;
      this.settings = {};
      this.tvmaze = new window.FlixerTvMaze.TvMaze();
      this._guides = new Map();
    }
    today() { return new Date().toISOString().slice(0, 10); }
    setSettings(s) { this.settings = s || {}; }

    /* ----- index ----- */
    catalog() {
      if (this._catalog) return Promise.resolve(this._catalog);
      if (!this._loading) {
        this._loading = (async () => {
          const { body: c } = await getJson(`${CFG.mobile ? "" : DATA_BASE}/data/bootstrap.json`).catch(() => getJson(`${DATA_BASE}/data/catalog.json`, 60000));
          if (c.product !== 'flixer') throw new Error('Flixer requires its own exported catalogue');
          const shows = Array.isArray(c.shows) ? c.shows : [];
          this._catalog = { shows, items: [], genres: { movie: [], tv: [] }, years: [1900, new Date().getFullYear()], generatedAt: c.generatedAt || null, tvmazeAt: c.tvmazeAt || null, lite: !!c.lite, tagLabels: new Map((c.tags || []).map(t => [t.id, t.labelEn || t.label || titleCase(t.id)])) };
          this._byId = new Map();
          shows.forEach(s => this._byId.set(s.id, s));
          const delta = store.get("delta", []);
          if (Array.isArray(delta)) delta.forEach(s => { if (!this._byId.has(s.id)) { shows.push(s); this._byId.set(s.id, s); } else Object.assign(this._byId.get(s.id),s); });
          this._universeData = new Map(); this._serviceLogos = new Map();
          this._indexReady = Promise.allSettled([
            getJson(`${CFG.mobile ? "" : DATA_BASE}/data/index.json`, 60000).then(({body}) => {
              if (body.product !== 'flixer') throw new Error('Wrong product index');
              this._merge(body.shows || []);
            }),
            getJson(`${CFG.mobile ? "" : DATA_BASE}/data/universes.json`).then(({body}) => {
              this._universeData = new Map((body.universes || []).map(x => [x.id,x]));
              this._universeData.forEach(x => { const cached = store.get("uni:" + x.id, null); if (cached && Array.isArray(cached.members)) this._mergeMembers(x,cached.members,cached.t); });
            }),
            getJson(`${CFG.mobile ? "" : DATA_BASE}/data/services.json`).then(({body}) => { this._serviceLogos = new Map((body.services || []).map(x => [x.name,x.logo])); })
          ]).then(() => {
            this._reindex(); window.dispatchEvent(new CustomEvent("flixer:catalog", {detail:{updated:true}}));
          });
          this._reindex();
          this._startSync();
          return this._catalog;
        })().catch(e => { this._loading = null; throw e; });
      }
      return this._loading;
    }
    /* ----- Universe membership, recomputed on every reindex (so live additions join at once) ----- */
    _key(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^(the|a|an)\s+/, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim(); }
    _titleIndex() {
      if (this._titleIdx) return this._titleIdx;
      const m = new Map();
      this._catalog.items.forEach(i => { [i.title, i.alt].forEach(t => { const k = this._key(t); if (!k) return; const arr = m.get(k); if (!arr) m.set(k, [i]); else if (!arr.includes(i)) arr.push(i); }); });
      return (this._titleIdx = m);
    }
    _tokenIndex() {
      if (this._tokIdx) return this._tokIdx;
      const idx = new Map();
      this._catalog.items.forEach(i => { new Set(UNI.tokens(i.title + " " + (i.alt || ""))).forEach(t => { let s = idx.get(t); if (!s) idx.set(t, s = []); s.push(i); }); });
      return (this._tokIdx = idx);
    }
    // Match an external record { title, year, type } onto an index item: exact normalised title first,
    // then fuzzy (shared tokens, containment) with year and type checks.
    _matchMember(m) {
      const pickYear = list => (m.year && (list.find(i => +i.year === m.year) || list.find(i => Math.abs(+i.year - m.year) <= 1))) || (list.length === 1 || !m.year ? list[0] : null);
      const exactAll = this._titleIndex().get(this._key(m.title)) || [];
      const exact = exactAll.filter(i => !m.type || i.type === m.type);
      let hit = exact.length ? pickYear(exact) : (exactAll.length === 1 ? exactAll[0] : null);
      if (hit) return hit;
      const toks = [...new Set(UNI.tokens(m.title))];
      if (!toks.length) return null;
      const counts = new Map();
      toks.forEach(t => { const list = this._tokenIndex().get(t); if (list && list.length <= 400) list.forEach(i => counts.set(i, (counts.get(i) || 0) + 1)); });
      let best = null, bestScore = 0;
      counts.forEach((n, i) => {
        if (n < Math.ceil(toks.length / 2)) return;
        if (m.year && +i.year && Math.abs(+i.year - m.year) > 2) return;
        let s = Math.max(UNI.similarity(m.title, i.title), i.alt ? UNI.similarity(m.title, i.alt) : 0);
        if (m.type && i.type !== m.type) s -= 0.15;
        if (m.year && +i.year === m.year) s += 0.1;
        if (s > bestScore) { bestScore = s; best = i; }
      });
      if (bestScore >= 0.6) return best;
      // Head match: one title is the other's main title before a subtitle, same type, same year.
      if (m.year) {
        const head = t => this._key(String(t).split(/[:–—(]| - /)[0]);
        const mk = this._key(m.title), mh = head(m.title);
        const cands = (this._tokenIndex().get(toks[0]) || []).filter(i => +i.year === m.year && (!m.type || i.type === m.type));
        const h = cands.find(i => head(i.title) === mk || this._key(i.title) === mh || (i.alt && this._key(i.alt) === mk));
        if (h) return h;
      }
      return null;
    }
    _applyUniverses() {
      const c = this._catalog;
      this._titleIdx = null; this._tokIdx = null;
      const data = this._universeData || new Map();
      // Name-derived patterns for universes that only exist in the Wikidata data.
      const auto = [...data.values()].filter(u => !UNI.byId(u.id)).map(u => ({ id: u.id, patterns: UNI.autoPatterns(u.name, u.short) })).filter(u => u.patterns.length);
      if (auto.length) c.items.forEach(i => { const extra = [...new Set([...UNI.detect(i.title, auto), ...(i.alt ? UNI.detect(i.alt, auto) : [])])]; if (extra.length > i.universes.length) i.universes = [...new Set([...i.universes, ...extra])]; });
      // Wikidata members matched onto the live index.
      const itemById = new Map(c.items.map(i => [i.id, i]));
      data.forEach(u => {
        let inFlixer = 0;
        u.members.forEach(m => {
          const hit = this._matchMember(m);
          m.id = hit ? hit.id : null;
          if (hit) { inFlixer += 1; const it = itemById.get(hit.id); if (it && !it.universes.includes(u.id)) it.universes.push(u.id); }
        });
        u.inFlixer = inFlixer;
      });
    }
    _mergeMembers(u, members, at) {
      const seen = new Set(u.members.map(m => m.q));
      members.forEach(m => { if (m.q && !seen.has(m.q)) { u.members.push(Object.assign({}, m, { id: null })); seen.add(m.q); } });
      u.members.sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")) || a.title.localeCompare(b.title));
      u.numbered = u.members.filter(m => m.ordinal != null).length >= 3;
      if (at) u.refreshedAt = at;
    }
    // Live refresh of a universe's members from Wikidata (same query as the build), once a day.
    async refreshUniverse(id) {
      const u = this._universeData && this._universeData.get(id);
      if (!u || !u.qids || !u.qids.length) return false;
      const cached = store.get("uni:" + id, null);
      if (cached && Date.now() - cached.t < 86400e3) return false;
      const FILM = ["Q11424", "Q24869", "Q202866", "Q506240", "Q226730", "Q20667187", "Q2431196"], TV = ["Q5398426", "Q581714", "Q63952888", "Q1259759", "Q15416", "Q117467246", "Q3464665"];
      const values = u.qids.map(q => "wd:" + q).join(" ");
      const query = u.mode === "company"
        ? `SELECT ?item ?itemLabel ?date ?start ?type WHERE { VALUES ?c { ${values} } ?item wdt:P272 ?c . ?item wdt:P31 ?type . FILTER(?type IN (${[...FILM, ...TV].map(t => "wd:" + t).join(",")})) OPTIONAL { ?item wdt:P577 ?date } OPTIONAL { ?item wdt:P580 ?start } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`
        : `SELECT ?item ?itemLabel ?date ?start ?ordinal ?type WHERE { VALUES ?u { ${values} } { ?item p:P179 ?st . ?st ps:P179 ?u . OPTIONAL { ?st pq:P1545 ?ordinal } } UNION { ?item wdt:P8345 ?u } UNION { ?item wdt:P1434 ?u } UNION { ?item wdt:P361 ?u } OPTIONAL { ?item wdt:P577 ?date } OPTIONAL { ?item wdt:P580 ?start } OPTIONAL { ?item wdt:P31 ?type } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
      const { body } = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, 8000);
      const map = new Map();
      ((body.results && body.results.bindings) || []).forEach(b => {
        const q = b.item.value.split("/").pop();
        const cur = map.get(q) || { q, title: null, dates: [], ordinal: null, types: new Set() };
        const label = b.itemLabel && b.itemLabel.value;
        if (label && label !== q) cur.title = label;
        if (b.date) cur.dates.push(b.date.value.slice(0, 10));
        if (b.start) cur.dates.push(b.start.value.slice(0, 10));
        if (b.ordinal && !Number.isNaN(+b.ordinal.value)) cur.ordinal = +b.ordinal.value;
        if (b.type) cur.types.add(b.type.value.split("/").pop());
        map.set(q, cur);
      });
      const members = [...map.values()].filter(m => m.title).map(m => {
        const type = [...m.types].some(t => TV.includes(t)) ? "tv" : [...m.types].some(t => FILM.includes(t)) ? "movie" : (m.types.size ? null : "movie");
        const date = m.dates.filter(x => /^\d{4}/.test(x)).sort()[0] || null;
        return { q: m.q, title: m.title, year: date ? +date.slice(0, 4) : null, date, type, ordinal: m.ordinal };
      }).filter(m => m.type);
      const before = u.members.length;
      this._mergeMembers(u, members, Date.now());
      store.set("uni:" + id, { t: Date.now(), members: members.map(m => ({ q: m.q, title: m.title, year: m.year, date: m.date, type: m.type, ordinal: m.ordinal })) });
      if (u.members.length !== before) this._applyUniverses(); else { u.members.forEach(m => { const hit = this._matchMember(m); m.id = hit ? hit.id : null; }); u.inFlixer = u.members.filter(m => m.id).length; }
      return u.members.length !== before;
    }

    /* ----- Universe pages ----- */
    async universeList() {
      const c = await this.catalog();
      return UNI.UNIVERSES.map(u => ({ id: u.id, name: u.name, short: u.short })).concat([...(this._universeData || new Map()).values()].filter(x => !UNI.byId(x.id)).map(x => ({ id: x.id, name: x.name, short: x.short })))
        .map(u => { const d = this._universeData && this._universeData.get(u.id); return { id: u.id, name: d ? d.name : u.name, short: d ? d.short : u.short, count: c.universeCounts.get(u.id) || 0, logo: d ? d.logo : null, isLogo: d ? d.isLogo : false, description: d ? d.description : "", home: d ? d.home : [], services: d ? d.services : [], total: d ? d.members.length : 0, inFlixer: d ? d.inFlixer : 0 }; })
        .filter(u => u.count || u.total)
        .sort((a, b) => b.count - a.count || b.total - a.total);
    }
    async universe(id) {
      const c = await this.catalog(); await this._indexReady;
      const base = UNI.byId(id) || { id, name: id, short: id };
      if (this.liveEnabled) { try { await this.refreshUniverse(id); } catch (e) { console.warn("[flixer] universe refresh skipped:", e.message); } }
      const d = this._universeData && this._universeData.get(id);
      if(this.liveEnabled && d && !this._resolvedUniverses?.has(id)) {
        this._resolvedUniverses ||= new Set(); this._resolvedUniverses.add(id);
        const missing=d.members.filter(m=>!m.id);
        // Resolve a small batch in the background; never delay opening the guide.
        (async()=>{ for(const member of missing.slice(0,20)) {
          try { const {body}=await getJson(`${API_BASE}/api/search?q=${encodeURIComponent(member.title)}`,15000);
            const rows=Array.isArray(body)?body:body.items || [];
            this._merge(rows.filter(row=>this._key(row.title)===this._key(member.title) && (!member.year || +row.year===+member.year) && (!member.type || (row.kind==='series'?'tv':'movie')===member.type)));
          } catch {} }
          this._reindex(); window.dispatchEvent(new CustomEvent("flixer:catalog",{detail:{updated:true}}));
        })();
      }
      const inIndex = c.items.filter(i => i.universes.includes(id));
      const seen = new Set();
      // Watch order: Wikidata members by release date (numbered where ordinals exist), then titles that
      // only the title patterns found, by year.
      // Several Wikidata items can resolve to one Flixer title (e.g. two "Pokémon" 1997 entries):
      // list each Flixer title once, at its first position, keeping the first ordinal.
      const members = (d ? d.members : []).map(m => { const item = m.id ? c.items.find(i => i.id === m.id) : null; if (item && seen.has(item.id)) return null; if (item) seen.add(item.id); return { q: m.q, title: item ? item.title : m.title, year: m.year || (item ? +item.year : null), date: m.date, type: m.type, ordinal: m.ordinal, item }; }).filter(Boolean);
      inIndex.filter(i => !seen.has(i.id)).sort((a, b) => (+a.year || 0) - (+b.year || 0)).forEach(i => members.push({ q: null, title: i.title, year: +i.year || null, date: i.date, type: i.type, ordinal: null, item: i }));
      // Services: TVmaze network / web channel of every series in this universe (in the index).
      const services = new Map();
      inIndex.forEach(i => { if (i.service) services.set(i.service, (services.get(i.service) || 0) + 1); });
      (d ? d.services : []).forEach(s => { if (!services.has(s.name)) services.set(s.name, s.count); });
      return { id, name: d ? d.name : base.name, short: d ? d.short : base.short, description: d ? d.description : "", logo: d ? d.logo : null, isLogo: d ? d.isLogo : false, wiki: d ? d.wiki : null, home: d ? d.home : [], services: [...services].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })), numbered: !!(d && d.numbered), members, inFlixer: members.filter(m => m.item).length, generatedAt: (d && d.refreshedAt) ? new Date(d.refreshedAt).toISOString() : c.universesAt, live: !!(d && d.refreshedAt) };
    }
    _reindex() {
      const c = this._catalog;
      c.items = c.shows.map(normalize);
      const genresOf = type => {
        const counts = new Map();
        c.items.filter(i => i.type === type).forEach(i => i.genreIds.forEach(g => counts.set(g, (counts.get(g) || 0) + 1)));
        return [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: c.tagLabels.get(id) || SLUG_LABEL.get(id) || titleCase(id), count: n }));
      };
      c.genres = { movie: genresOf("movie"), tv: genresOf("tv") };
      let min = Infinity, max = new Date().getFullYear();
      c.items.forEach(i => { const y = +i.year; if (y) { if (y < min) min = y; if (y > max) max = y; } });
      c.years = [min === Infinity ? 1900 : min, max];
      this._applyUniverses();
      // Services (where series air / stream), universes and franchise stems.
      const svc = new Map();
      c.items.forEach(i => { if (i.service) svc.set(i.service, (svc.get(i.service) || 0) + 1); });
      c.services = [...svc].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
      const uni = new Map();
      c.items.forEach(i => i.universes.forEach(u => uni.set(u, (uni.get(u) || 0) + 1)));
      c.universeCounts = uni;
      const stems = new Map();
      c.items.forEach(i => { if (i.stem && i.stem.length > 2) { const arr = stems.get(i.stem); if (arr) arr.push(i); else stems.set(i.stem, [i]); } });
      c.stems = stems;
    }
    _merge(rows) {
      const c = this._catalog;
      let added = 0;
      const identities=new Map();
      const identity=r=>r.tmdbId?`${r.kind}:tmdb:${r.tmdbId}`:r.year?`${r.kind}:${this._key(r.title)}:${r.year}`:null;
      c.shows.forEach(show=>{ for(const key of [identity(show),show.year?`${show.kind}:${this._key(show.title)}:${show.year}`:null]) if(key) identities.set(key,identities.has(key)?null:show); });
      rows.forEach(r => {
        if (!r || !r.id) return;
        const candidate=identities.get(identity(r)) || (r.year && identities.get(`${r.kind}:${this._key(r.title)}:${r.year}`));
        const cur = this._byId.get(r.id) || (candidate && !(candidate.tmdbId && r.tmdbId && +candidate.tmdbId!==+r.tmdbId) && candidate);
        if(cur) this._byId.set(r.id,cur);
        if (cur) {
          if (r.title) cur.title = r.title;
          if (r.synopsis && (!cur.synopsis || r.synopsis.length > cur.synopsis.length)) cur.synopsis = r.synopsis;
          if (r.tags && r.tags.length) cur.tags = [...new Set([...(cur.tags || []),...r.tags])];
          if (r.year) cur.year = r.year;
          for (const key of ["publishedAt","latestAt","providerUpdatedAt","firstSeenAt","tmdbId","imdbId","firstEpisodeId"]) if (r[key]) cur[key] = r[key];
          if (r.episodeCount) cur.episodeCount = Math.max(cur.episodeCount || 0,r.episodeCount);
          if (r.wpId) cur.wpId = r.wpId;
          if (r.tvm) cur.tvm = r.tvm;
          if (r.offerings) cur.offerings = [...new Map([...(cur.offerings || []),...r.offerings].map(o=>[o.provider+":"+o.id,o])).values()];
          if (r.versions) cur.versions = r.versions;
          if (r.sourceUrl) cur.sourceUrl = r.sourceUrl;
          if (r.poster) cur.poster = r.poster;
          if (Array.isArray(r.episodes) && r.episodes.length >= (cur.episodes || []).length) { cur.episodes = r.episodes; cur.episodeCount = r.episodes.length; }
        } else {
          c.shows.push(r); this._byId.set(r.id, r); if(identity(r)) identities.set(identity(r),r); added += 1;
        }
      });
      if (rows.length && rows.length < 500) this._persistDelta(rows.filter(r => r && r.id).map(r=>this._byId.get(r.id) || r));
      return added;
    }
    _persistDelta(rows) {
      const delta = store.get("delta", []);
      const incoming=new Map(rows.map(r=>[r.id, {id:r.id,kind:r.kind,title:r.title,year:r.year,tags:r.tags,slug:r.slug,wpId:r.wpId,publishedAt:r.publishedAt,latestAt:r.latestAt,providerUpdatedAt:r.providerUpdatedAt,tvm:r.tvm,offerings:r.offerings,versions:r.versions,sourceUrl:r.sourceUrl,poster:r.poster,tmdbId:r.tmdbId,documentary:r.documentary}]));
      store.set("delta",[...incoming.values(),...delta.filter(r=>!incoming.has(r.id))].slice(0,DELTA_CAP));
    }

    /* ----- background sync: newest titles on the source, every few minutes ----- */
    _startSync() {
      if (!this.liveEnabled || this._timer) return;
      const tick = () => this.sync().catch(() => {});
      setTimeout(tick, 1500);
      this._timer = setInterval(tick, SYNC_EVERY);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - this._lastSync > SYNC_EVERY / 2) tick(); });
    }
    async sync() {
      if (this._syncing || !this._catalog) return 0;
      this._syncing = true;
      let added = 0;
      try {
        const results = await Promise.allSettled(["film","series"].map(kind => getJson(`${API_BASE}/api/discover?kind=${kind}&latest=true&page=1`, 18000)));
        const recent = new Set(), groups=[]; let successful = false;
        results.forEach(result => { if(result.status === "fulfilled") {
          successful = true;
          const rows=result.value.body.items || [];
          added += this._merge(rows);
          for(const provider of ["myflixer","fmovies","hdtoday"]) groups.push(rows.filter(row=>(row.offerings || []).some(o=>o.provider===provider) || row.id.startsWith({myflixer:"mf:",fmovies:"fm:",hdtoday:"hd:"}[provider])).map(row=>this._byId.get(row.id)?.id || row.id));
        }});
        if(!successful) throw new Error("Providers are temporarily unavailable");
        for(let index=0;groups.some(group=>index<group.length);index++) groups.forEach(group=>{if(group[index])recent.add(group[index]);});
        this._recentIds = recent;
        this._enrichServices([...recent]).catch(()=>{});
        this._reindex();
        this._lastSync = Date.now();
        window.dispatchEvent(new CustomEvent("flixer:catalog", { detail: { added, updated:true, total: this._catalog.shows.length } }));
        window.dispatchEvent(new CustomEvent("flixer:sync", { detail: { ok: true, added, at: this._lastSync } }));
      } catch (e) {
        window.dispatchEvent(new CustomEvent("flixer:sync", { detail: { ok: false, error: e.message } }));
        throw e;
      } finally { this._syncing = false; }
      return added;
    }

    async _enrichServices(ids) {
      for(const id of ids) {
        const raw=this._byId.get(id);
        if(!raw || raw.kind!=='series' || raw.tvm || raw._serviceTried) continue;
        raw._serviceTried=true;
        const item=normalize(raw), match=await this.tvmaze.show(item);
        if(!match || this._key(match.name)!==this._key(item.title) || (item.year && match.year && +item.year!==match.year)) continue;
        raw.tvm={id:match.id,w:match.weight,r:match.rating,svc:match.service,st:match.status,c:match.web?.country || match.network?.country};
        this._persistDelta([raw]); this._reindex();
        window.dispatchEvent(new CustomEvent("flixer:catalog",{detail:{updated:true}}));
      }
    }
    async all(type) { const c = await this.catalog(); return type ? c.items.filter(i => i.type === type) : c.items; }
    async item(id) { const c = await this.catalog(); return c.items.find(i => i.id === id) || null; }
    async yearRange() { const c = await this.catalog(); return c.years; }
    async generatedAt() { const c = await this.catalog(); return c.generatedAt; }
    async stats() { const c = await this.catalog(); return { total: c.shows.length, films: c.items.filter(i => i.type === "movie").length, series: c.items.filter(i => i.type === "tv").length, rated: c.items.filter(i => i.rating).length, lastSync: this._lastSync, live: this.liveEnabled, tvmazeAt: c.tvmazeAt }; }
    ratingOf(id) { const s = this._byId.get(id); const r = s && s.tvm && s.tvm.r; return r ? { rating: r } : null; }

    /* ----- Home rails ----- */
    async trending() {
      const items=await this.all();
      const live=this._recentIds ? [...this._recentIds].map(id=>this._byId.get(id)).filter(Boolean).map(normalize) : [];
      return [...live, ...items.slice().sort(byAdded).filter(i=>!this._recentIds?.has(i.id))].slice(0,24);
    }
    async nowPlaying() { return (await this.all("movie")).slice().sort(byAdded).slice(0, 14); }
    async onTheAir() { return (await this.all("tv")).slice().sort(byAdded).slice(0, 14); }
    async popular(type, n = 14) { return (await this.all(type)).filter(i => i.weight > 0).sort(byWeight).slice(0, n); }
    async topRated(type, n = 14) {
      const list = (await this.all(type)).slice();
      const rated = list.filter(i => i.rating > 0);
      return (rated.length ? rated.sort(byRating) : type === "tv" ? list.sort(byEpisodes) : list.sort(byYearDesc)).slice(0, n);
    }
    async universeRail(id, n = 14) { return (await this.all()).filter(i => i.universes.includes(id)).sort(byWeight).slice(0, n); }
    async topUniverses(n = 4) { const c = await this.catalog(); return [...c.universeCounts].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, count]) => ({ id, count, ...UNI.byId(id) })); }
    async universes() { const c = await this.catalog(); return UNI.UNIVERSES.map(u => ({ id: u.id, name: u.name, short: u.short, count: c.universeCounts.get(u.id) || 0 })); }
    async serviceList(n = 40) {
      const c = await this.catalog();
      const logos = this._serviceLogos || new Map();
      return c.services.slice(0, n).map(s => ({ name: s.name, count: s.count, logo: logos.get(s.name) || null }));
    }
    async services(type) { const c = await this.catalog(); if (!type) return c.services; const m = new Map(); c.items.filter(i => i.type === type && i.service).forEach(i => m.set(i.service, (m.get(i.service) || 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })); }

    /* ----- Browse ----- */
    async discover(type, f, page = 1) {
      await this.catalog(); await this._indexReady;
      this._browseSessions ||= new Map();
      const key=JSON.stringify([type,f]);
      if(page===1 || !this._browseSessions.has(key)) this._browseSessions.set(key,{seen:new Set(),remotePage:0,totalPages:1,buffer:[]});
      const session=this._browseSessions.get(key);
      // Every scroll advances all upstream lists, even while cached titles remain.
      if(this.liveEnabled && session.remotePage < session.totalPages) {
        const genre=GENRES.find(g=>g[2]===(f.genres || [])[0]);
        const params=new URLSearchParams({kind:type==='tv'?'series':'film',page:String(session.remotePage+1)});
        if(genre) params.set('genre',genre[2]);
        if(f.yearFrom && f.yearFrom===f.yearTo) params.set('year',f.yearFrom);
        session.pending ||= getJson(`${API_BASE}/api/discover?${params}`,18000).then(({body})=>{
          session.remotePage++; session.totalPages=body.totalPages || session.remotePage;
          this._merge(body.items || []); this._reindex();
          session.buffer.push(...(body.items || []).map(row=>this._byId.get(row.id)?.id || row.id));
        }).catch(()=>{}).finally(()=>{session.pending=null;});
        if(page===1) await Promise.race([session.pending,new Promise(resolve=>setTimeout(resolve,300))]);
        else await session.pending;
      }
      let list = await this.all(type);
      if (f.genres && f.genres.length) list = list.filter(i => f.genres.every(g => i.genreIds.includes(g)));
      if (f.yearFrom) list = list.filter(i => +i.year >= f.yearFrom);
      if (f.yearTo) list = list.filter(i => +i.year <= f.yearTo);
      if (f.services && f.services.length) { const set = new Set(f.services); list = list.filter(i => set.has(i.service)); }
      if (f.minRating) list = list.filter(i => i.rating >= f.minRating);
      if (f.universe) list = list.filter(i => i.universes.includes(f.universe));
      const sorters = { added: byAdded, year: byYearDesc, oldest: byYearAsc, episodes: byEpisodes, title: byTitle, popularity: byWeight, rating: byRating };
      list = list.slice().sort(sorters[f.sort] || byAdded);
      const ranked=new Map(list.map(i=>[i.id,i]));
      const priority=session.buffer.map(id=>ranked.get(id)).filter(Boolean);
      const available=[...priority,...list].filter(i=>!session.seen.has(i.id));
      const items=[];
      for(const item of available) { if(session.seen.has(item.id)) continue; session.seen.add(item.id); items.push(item); if(items.length===PER_PAGE) break; }
      session.buffer=session.buffer.filter(id=>!session.seen.has(id));
      const more=list.some(i=>!session.seen.has(i.id)) || session.remotePage < session.totalPages;
      return {items,page,totalPages:more?page+1:page,total:list.length};
    }
    async genres(type) { const c = await this.catalog(); return c.genres[type] || []; }
    async countries() { return []; }
    async languages() { return []; }

    /* ----- Relations: same universe, same franchise, then similar ----- */
    async related(item, n = 16) {
      const c = await this.catalog();
      const seen = new Set([item.id]);
      const take = (list, k) => { const out = []; for (const i of list) { if (out.length >= k) break; if (!seen.has(i.id)) { seen.add(i.id); out.push(i); } } return out; };
      const universe = item.universes.length ? take(c.items.filter(i => i.universes.some(u => item.universes.includes(u))).sort(byWeight), n) : [];
      const franchise = item.stem && item.stem.length > 2 ? take((c.stems.get(item.stem) || []).slice().sort(byYearAsc), n) : [];
      const y = +item.year || 0;
      const similar = take(c.items.filter(i => i.type === item.type && i.genreIds.length && i.genreIds.filter(g => item.genreIds.includes(g)).length >= Math.min(2, item.genreIds.length) && (!y || Math.abs((+i.year || 0) - y) <= 3)).sort(byWeight), n);
      return { universe, universeName: item.universes.length ? (UNI.byId(item.universes[0]) || {}).name : "", franchise, similar };
    }

    /* ----- Details: index entry completed live (synopsis, episodes) + TVmaze guide ----- */
    async show(id) {
      await this.catalog();
      if (this._byId.has(id)) return this._byId.get(id);
      try {
        const { body } = await getJson(`${DATA_BASE}/data/shows/${encodeURIComponent(encodeURIComponent(id))}.json`, 8000);
        this._merge([body]); this._reindex();
        return body;
      } catch { /* not in the bundle */ }
      const r = await live.details(id);
      this._merge([r]); this._reindex();
      return r;
    }
    async details(_type, id) {
      const raw = await this.show(id);
      // Episode lists live in bundled per-series files (data/shows/<id>.json); pull them in once.
      if (raw.kind === "series" && !(raw.episodes || []).length && !raw._episodesTried) {
        raw._episodesTried = true;
        try { const { body } = await getJson(`${DATA_BASE}/data/shows/${encodeURIComponent(encodeURIComponent(id))}.json`, 8000); if (body && Array.isArray(body.episodes) && body.episodes.length) { raw.episodes = body.episodes; raw.episodeCount = body.episodes.length; } }
        catch { /* not bundled: the live tier fills it below */ }
      }
      const needsLive = this.liveEnabled;
      if (needsLive && !this._details.has(id)) {
        const cached = store.get("title:" + id, null);
        if (cached && Date.now() - cached.t < 6 * 3600e3) { this._merge([cached.show]); }
        else {
          try {
            const fresh = await live.details(id, [raw.sourceUrl, ...(raw.offerings || []).map(o => o.sourceUrl)]);
            if (fresh) { this._merge([fresh]); store.set("title:" + id, { t: Date.now(), show: fresh }); }
          } catch (e) { console.warn("[flixer] live details unavailable:", e.message); }
        }
        this._details.set(id, true);
      }
      return this._build(this._byId.get(id) || raw);
    }
    async _build(raw) {
      const item = normalize(raw);
      const c = await this.catalog();
      const labels = new Map(c.genres[item.type].map(g => [g.id, g.name]));
      // A series whose episode list is unavailable still gets one entry so it can be played from the
      // source page (the player resolves the servers from there).
      const list = raw.kind === "series" && (raw.episodes || []).length ? raw.episodes : [Object.assign(movieEpisode(raw), raw.kind === "series" ? { title: "Whole series", sourceUrl: raw.sourceUrl || `${SOURCE}/series/${raw.slug}/` } : {})];
      const episodes = list.map((e, i) => normalizeEpisode(e, i, raw));
      // TVmaze episode guide: titles, stills, air dates and summaries for the source's episodes.
      if (raw.kind === "series" && item.tvmazeId && episodes.length) {
        const guide = await this._guide(item).catch(() => null);
        if (guide) episodes.forEach(e => { const g = guide.get(e.season + ":" + e.n); if (g) { if (g.still) e.still = g.still; if (g.date) e.date = g.date; if (g.runtime) e.runtime = g.runtime; if (g.overview) e.overview = g.overview; if (g.title && /^episode \d+$/i.test(e.title)) e.title = g.title; } });
      }
      const seasonNums = [...new Set(episodes.map(e => e.season))].sort((a, b) => a - b);
      const seasons = seasonNums.map(n => ({ season_number: n, name: "Season " + n, episode_count: episodes.filter(e => e.season === n).length }));
      return Object.assign(item, {
        tagline: "",
        genres: item.genreIds.map(g => ({ id: g, name: labels.get(g) || SLUG_LABEL.get(g) || titleCase(g) })),
        runtime: null,
        seasons, seasonCount: seasons.length, episodeCount: episodes.length,
        episodes, firstEpisodeId: episodes[0] ? episodes[0].id : item.id,
        cast: [], trailer: null, providers: null,
        similar: [],
        backdropLarge: item.backdrop, posterLarge: item.poster
      });
    }
    async _guide(item) {
      if (this._guides.has(item.id)) return this._guides.get(item.id);
      const cached = store.get("guide:" + item.id, null);
      let eps = cached && Date.now() - cached.t < 3 * 86400e3 ? cached.eps : null;
      if (!eps) { eps = await this.tvmaze.episodes(item.tvmazeId); store.set("guide:" + item.id, { t: Date.now(), eps: eps.map(e => ({ season: e.season, n: e.n, title: e.title, date: e.date, runtime: e.runtime, still: e.still, overview: (e.overview || "").slice(0, 240) })) }); }
      const map = new Map(eps.map(e => [e.season + ":" + e.n, e]));
      this._guides.set(item.id, map);
      return map;
    }
    async season(id, n) { const d = await this.details(null, id); return d.episodes.filter(e => e.season === n); }
    async episode(showId, epId) {
      const show = await this.details(null, showId);
      const index = show.episodes.findIndex(e => e.id === epId);
      if (index < 0) throw new Error("Episode not found.");
      return { show, episode: show.episodes[index], index, prev: show.episodes[index - 1] || null, next: show.episodes[index + 1] || null, total: show.episodes.length };
    }
    // TVmaze extras for a series: rating, where it airs or streams, status, cast, summary.
    async extras(item) {
      if (item.type !== "tv") return null;
      const s = await this.tvmaze.show(item);
      if (!s) return { matched: false };
      let cast = [];
      try { cast = await this.tvmaze.cast(s.id); } catch { /* optional */ }
      return Object.assign({ matched: true, cast }, s);
    }
    async posterFallback(id) {
      const item = await this.item(id);
      if (!item || item.type !== "tv") return null;
      if (item.tvImage) return item.tvImage;
      const s = await this.tvmaze.show(item).catch(() => null);
      return s && s.image ? s.image.medium : null;
    }

    /* ----- Search: index first, widened by the source's own search ----- */
    async search(q) {
      // Same normalization as shared/search.js, kept local for the classic-script client.
      const norm = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&amp;/g,'&').replace(/&/g,' and ').replace(/['’‘]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
      const terms = norm(q).split(/\s+/).filter(Boolean);
      if(!terms.length)return {items:[],totalPages:1};
      const hit = value => {const text=norm(value);return terms.every(term=>text.includes(term));};
      await this.catalog(); await this._indexReady;
      const local = (await this.all()).filter(i => hit(i.title) || (i.alt && hit(i.alt))).sort(byWeight).slice(0, 60);
      if (!this.liveEnabled) return { items: local, totalPages: 1 };
      const liveHits = await Promise.race([
        Promise.all([live.list("movie", { page: 1, perPage: 20, search: q }), live.list("tv", { page: 1, perPage: 20, search: q })]).then(([m, s]) => [...m.items, ...s.items]).catch(() => []),
        new Promise(res => setTimeout(() => res([]), 3500))
      ]);
      if (liveHits.length && this._merge(liveHits)) this._reindex();
      const seen = new Set(local.map(i => i.id));
      const extra = liveHits.map(r => this._byId.get(r.id) || r).map(normalize).filter(i => !seen.has(i.id));
      return { items: [...local, ...extra], totalPages: 1 };
    }

    /* ----- Playback sources (unchanged contract) ----- */
    async stream(id, sourceUrl, show = {}) {
      const toAbsolute = url => !url ? null : (/^https?:\/\//.test(url) ? url : API_BASE + url);
      try {
        const params = new URLSearchParams({id});
        if (show.id) params.set('showId',show.id);
        [show.sourceUrl, ...(show.offerings || []).map(o => o.sourceUrl)].filter(Boolean).forEach(source => params.append('source',source));
        const { body: data } = await getJson(`${API_BASE}/api/stream?${params}`, 45000);
        const servers = [];
        (Array.isArray(data.servers) ? data.servers : []).forEach((s, idx) => {
          if(s.requiresBrowserVerification || /^https:\/\/hdtoday\.sx\//i.test(s.embedUrl || ''))return;
          const streamUrl = toAbsolute(s.streamUrl || s.rawStreamUrl);
          const embedUrl = toAbsolute(s.embedUrl || s.rawEmbedUrl);
          if (streamUrl || embedUrl) servers.push({ ...s, id: s.id != null ? s.id : idx, name: s.name || "Player " + (idx + 1), type: s.type || (streamUrl ? "hls" : "embed"), streamUrl, embedUrl });
        });
        if (!servers.length && Array.isArray(data.streams)) data.streams.forEach((s, idx) => { const u = toAbsolute(s.proxyUri || s.uri); if (u) servers.push({ id: idx, name: s.quality || s.name || "Server " + (idx + 1), type: "hls", streamUrl: u }); });
        if (!servers.length && data.streamUrl) servers.push({ id: 0, name: "Player 1 (HLS)", type: "hls", streamUrl: toAbsolute(data.streamUrl) });
        if (!servers.length && data.embedUrl) servers.push({ id: 0, name: "Player 1", type: "embed", embedUrl: toAbsolute(data.embedUrl) });
        if (servers.length) return { servers, via: "api" };
      } catch (e) {
        console.warn("[flixer] stream endpoint unavailable:", e.message);
      }
      if(/^hd:/.test(id) || /^https:\/\/hdtoday\.sx\//i.test(sourceUrl || ''))return {servers:[],via:'unavailable'};
      const page = sourceUrl || `${SOURCE}/${String(id).replace(/^mf:[mse]:/, "")}/`;
      try {
        const res = await fetch(page);
        if (res.ok) {
          const html = await res.text();
          const tabs = [];
          const reTab = /<button[^>]*class="[^"]*player-tab-btn[^"]*"[^>]*data-player-url="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi;
          let m;
          while ((m = reTab.exec(html)) !== null) {
            const url = m[1].trim().replace(/&#038;/g, "&");
            const name = m[2].replace(/<[^>]+>/g, "").trim() || "Player " + (tabs.length + 1);
            if (url && !tabs.some(t => t.url === url)) tabs.push({ id: tabs.length + 1, name, url });
          }
          if (tabs.length) return { servers: tabs.map(t => ({ id: "tab_" + t.id, name: t.name, type: "embed", embedUrl: t.url })), via: "page" };
        }
      } catch (e) {
        console.warn("[flixer] client-side source lookup failed:", e.message);
      }
      return { servers: page ? [{ id: "direct", name: "Source page", type: "embed", embedUrl: page }] : [], via: "direct" };
    }
  }

  window.Api = { FlixerApi };
})();
