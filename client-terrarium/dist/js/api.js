/* Flixer data layer. Same surface as Terrarium's TmdbApi/DemoApi so the views stay untouched.
   Two tiers:
   - the bundled index (data/catalog.json): every title, lean (no synopsis), loads instantly and
     works offline; filters, sorting and search run on it;
   - the live tier: the Flixer endpoints (/api/...) when the app is served next to them, otherwise
     the source's public JSON API directly (same requests the Flixer server makes). It keeps the
     index fresh in the background (new titles every few minutes), fetches synopsis and episodes
     when a title is opened, and widens search.
   Normalized item shape (what the views consume):
   { id, type: 'movie'|'tv', title, date, year, poster, backdrop, rating, votes, genreIds, overview,
     lang, country[], episodeCount, firstEpisodeId, sourceUrl } */

(function () {
  const CFG = window.FLIXER_CONFIG || {};
  const DATA_BASE = (CFG.dataBase || "").replace(/\/$/, "");
  const API_BASE = (CFG.apiBase || "").replace(/\/$/, "");
  const PER_PAGE = 24;
  const SOURCE = "https://myflixerz.day";
  const WP = SOURCE + "/wp-json/wp/v2";
  const SYNC_EVERY = 10 * 60 * 1000;
  const DELTA_CAP = 2500;
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

  /* ----- raw show -> view item ----- */
  function normalize(s) {
    const type = s.kind === "series" ? "tv" : "movie";
    const date = String(s.publishedAt || "").slice(0, 10);
    const poster = s.poster || {};
    const episodes = Array.isArray(s.episodes) ? s.episodes : [];
    return {
      id: s.id,
      type,
      title: decodeEntities(s.title),
      date,
      year: s.year ? String(s.year) : (date ? date.slice(0, 4) : ""),
      poster: s.portrait || poster.custom || poster.default || posterFor(s.wpId),
      backdrop: poster.backdrop || poster.hq || backdropFor(s.wpId) || poster.custom || null,
      rating: 0,
      votes: 0,
      genreIds: Array.isArray(s.tags) ? s.tags : [],
      overview: decodeEntities(s.synopsis),
      lang: "",
      country: [],
      episodeCount: s.episodeCount || episodes.length || (type === "movie" ? 1 : 0),
      firstEpisodeId: episodes[0] ? episodes[0].id : s.id,
      sourceUrl: s.sourceUrl || (type === "tv" ? `${SOURCE}/series/${s.slug}/` : `${SOURCE}/${s.slug}/`)
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
  // A movie's only "episode" is the film itself.
  const movieEpisode = s => ({ id: s.id, slug: s.slug, title: s.title, season: 1, number: 1, sourceUrl: s.sourceUrl || `${SOURCE}/${s.slug}/` });

  /* ----- live tier: the same requests the Flixer server makes ----- */
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
    // Same shape the server's formatItem produces (lean when the row carries no content).
    format(row, years, kind) {
      const isMovie = kind === "movie";
      const year = (row["release-year"] || []).map(id => years.get(id)).find(Boolean);
      const genres = (row.categories || []).map(id => GENRE_NAME.get(id)).filter(Boolean);
      const slug = row.slug;
      const synopsis = plain((row.content && row.content.rendered) || (row.excerpt && row.excerpt.rendered) || "");
      return {
        id: `mf:${isMovie ? "m" : "s"}:${slug}`,
        wpId: row.id,
        slug,
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
    async details(id) {
      const isSeries = id.startsWith("mf:s:");
      const slug = id.replace(/^mf:[mse]:/, "");
      if (await this.serverOk()) {
        const { body } = await getJson(`${API_BASE}/api/title/${encodeURIComponent(id)}`);
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
    // Episode list from the series page (same parsing as the Flixer server's fetchSeriesEpisodes).
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
    }
    today() { return new Date().toISOString().slice(0, 10); }

    /* ----- index ----- */
    catalog() {
      if (this._catalog) return Promise.resolve(this._catalog);
      if (!this._loading) {
        this._loading = (async () => {
          const { body: c } = await getJson(`${DATA_BASE}/data/catalog.json?v=${Math.floor(Date.now() / 600000)}`, 60000);
          const shows = Array.isArray(c.shows) ? c.shows : [];
          this._catalog = { shows, items: [], genres: { movie: [], tv: [] }, years: [1900, new Date().getFullYear()], generatedAt: c.generatedAt || null, lite: !!c.lite, tagLabels: new Map((c.tags || []).map(t => [t.id, t.labelEn || t.label || titleCase(t.id)])) };
          this._byId = new Map();
          shows.forEach(s => this._byId.set(s.id, s));
          // Titles learned live in earlier sessions.
          const delta = store.get("delta", []);
          if (Array.isArray(delta)) delta.forEach(s => { if (!this._byId.has(s.id)) { shows.push(s); this._byId.set(s.id, s); } });
          this._reindex();
          this._startSync();
          return this._catalog;
        })().catch(e => { this._loading = null; throw e; });
      }
      return this._loading;
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
    }
    // Merge live rows into the index. Returns the number of titles that were new.
    _merge(rows) {
      const c = this._catalog;
      let added = 0;
      rows.forEach(r => {
        if (!r || !r.id) return;
        const cur = this._byId.get(r.id);
        if (cur) {
          if (r.title) cur.title = r.title;
          if (r.synopsis && (!cur.synopsis || r.synopsis.length > cur.synopsis.length)) cur.synopsis = r.synopsis;
          if (r.tags && r.tags.length) cur.tags = r.tags;
          if (r.year) cur.year = r.year;
          if (r.publishedAt) cur.publishedAt = r.publishedAt;
          if (r.wpId) cur.wpId = r.wpId;
          if (Array.isArray(r.episodes) && r.episodes.length > (cur.episodes || []).length) { cur.episodes = r.episodes; cur.episodeCount = r.episodes.length; }
        } else {
          c.shows.push(r); this._byId.set(r.id, r); added += 1;
        }
      });
      if (added) this._persistDelta(rows.filter(r => r && r.id));
      return added;
    }
    _persistDelta(rows) {
      const delta = store.get("delta", []);
      const known = new Set(delta.map(d => d.id));
      const lean = rows.filter(r => !known.has(r.id)).map(r => ({ id: r.id, wpId: r.wpId, slug: r.slug, kind: r.kind, title: r.title, year: r.year, tags: r.tags, publishedAt: r.publishedAt }));
      store.set("delta", [...lean, ...delta].slice(0, DELTA_CAP));
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
        for (const kind of ["movie", "tv"]) {
          for (let page = 1; page <= 6; page++) {
            const r = await live.list(kind, { page, perPage: 50 });
            const n = this._merge(r.items);
            added += n;
            if (!r.items.length || (page > 1 && n === 0) || (page === 1 && n === 0 && r.items.every(i => this._byId.has(i.id)))) break;
          }
        }
        this._lastSync = Date.now();
        if (added) { this._reindex(); window.dispatchEvent(new CustomEvent("flixer:catalog", { detail: { added, total: this._catalog.shows.length } })); }
        window.dispatchEvent(new CustomEvent("flixer:sync", { detail: { ok: true, added } }));
      } catch (e) {
        window.dispatchEvent(new CustomEvent("flixer:sync", { detail: { ok: false, error: e.message } }));
        throw e;
      } finally { this._syncing = false; }
      return added;
    }

    async all(type) { const c = await this.catalog(); return type ? c.items.filter(i => i.type === type) : c.items; }
    async item(id) { const c = await this.catalog(); return c.items.find(i => i.id === id) || null; }
    async yearRange() { const c = await this.catalog(); return c.years; }
    async generatedAt() { const c = await this.catalog(); return c.generatedAt; }
    async stats() { const c = await this.catalog(); return { total: c.shows.length, films: c.items.filter(i => i.type === "movie").length, series: c.items.filter(i => i.type === "tv").length, lastSync: this._lastSync, live: this.liveEnabled }; }

    /* ----- Home rails ----- */
    async trending() { return (await this.all()).slice().sort(byAdded).slice(0, 20); }
    async nowPlaying() { return (await this.all("movie")).slice().sort(byAdded).slice(0, 14); }
    async onTheAir() { return (await this.all("tv")).slice().sort(byAdded).slice(0, 14); }
    async topRated(type) {
      const list = (await this.all(type)).slice();
      return (type === "tv" ? list.sort(byEpisodes) : list.sort(byYearDesc)).slice(0, 14);
    }

    /* ----- Browse ----- */
    async discover(type, f, page = 1) {
      let list = await this.all(type);
      if (f.genres && f.genres.length) list = list.filter(i => f.genres.every(g => i.genreIds.includes(g)));
      if (f.yearFrom) list = list.filter(i => +i.year >= f.yearFrom);
      if (f.yearTo) list = list.filter(i => +i.year <= f.yearTo);
      const sorters = { added: byAdded, year: byYearDesc, oldest: byYearAsc, episodes: byEpisodes, title: byTitle };
      list = list.slice().sort(sorters[f.sort] || byAdded);
      const start = (page - 1) * PER_PAGE;
      return { items: list.slice(start, start + PER_PAGE), page, totalPages: Math.max(1, Math.ceil(list.length / PER_PAGE)), total: list.length };
    }
    async genres(type) { const c = await this.catalog(); return c.genres[type] || []; }
    async countries() { return []; }
    async languages() { return []; }

    /* ----- Details: index entry completed live (synopsis, episodes) ----- */
    async show(id) {
      await this.catalog();
      if (this._byId.has(id)) return this._byId.get(id);
      try {
        const { body } = await getJson(`${DATA_BASE}/data/shows/${encodeURIComponent(id)}.json`, 8000);
        this._merge([body]); this._reindex();
        return body;
      } catch { /* not in the bundle */ }
      const r = await live.details(id);
      this._merge([r]); this._reindex();
      return r;
    }
    async details(_type, id) {
      const raw = await this.show(id);
      const needsLive = this.liveEnabled && (!raw.synopsis || (raw.kind === "series" && (raw.episodes || []).length <= 1));
      if (needsLive && !this._details.has(id)) {
        const cached = store.get("title:" + id, null);
        if (cached && Date.now() - cached.t < 6 * 3600e3) { this._merge([cached.show]); }
        else {
          try {
            const fresh = await live.details(id);
            if (fresh) { this._merge([fresh]); store.set("title:" + id, { t: Date.now(), show: { id: fresh.id, synopsis: fresh.synopsis, episodes: fresh.episodes || [], year: fresh.year, tags: fresh.tags } }); }
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
      const list = raw.kind === "series" ? (raw.episodes || []) : [movieEpisode(raw)];
      const episodes = list.map((e, i) => normalizeEpisode(e, i, raw));
      const seasonNums = [...new Set(episodes.map(e => e.season))].sort((a, b) => a - b);
      const seasons = seasonNums.map(n => ({ season_number: n, name: "Season " + n, episode_count: episodes.filter(e => e.season === n).length }));
      const similar = c.items.filter(i => i.id !== raw.id && i.type === item.type && i.genreIds.some(g => item.genreIds.includes(g))).sort(byAdded).slice(0, 12);
      return Object.assign(item, {
        tagline: "",
        genres: item.genreIds.map(g => ({ id: g, name: labels.get(g) || SLUG_LABEL.get(g) || titleCase(g) })),
        runtime: null, status: "",
        seasons, seasonCount: seasons.length, episodeCount: episodes.length,
        episodes, firstEpisodeId: episodes[0] ? episodes[0].id : item.id,
        cast: [], trailer: null, providers: null, similar,
        backdropLarge: item.backdrop, posterLarge: item.poster
      });
    }
    async season(id, n) { const d = await this.details(null, id); return d.episodes.filter(e => e.season === n); }
    async episode(showId, epId) {
      const show = await this.details(null, showId);
      const index = show.episodes.findIndex(e => e.id === epId);
      if (index < 0) throw new Error("Episode not found.");
      return { show, episode: show.episodes[index], index, prev: show.episodes[index - 1] || null, next: show.episodes[index + 1] || null, total: show.episodes.length };
    }

    /* ----- Search: index first, widened by the source's own search ----- */
    async search(q) {
      const needle = q.toLowerCase();
      const local = (await this.all()).filter(i => i.title.toLowerCase().includes(needle)).sort(byAdded).slice(0, 60);
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
    async stream(id, sourceUrl) {
      const toAbsolute = url => !url ? null : (/^https?:\/\//.test(url) ? url : API_BASE + url);
      try {
        const { body: data } = await getJson(`${API_BASE}/api/stream?id=${encodeURIComponent(id)}`, 20000);
        const servers = [];
        (Array.isArray(data.servers) ? data.servers : []).forEach((s, idx) => {
          const streamUrl = toAbsolute(s.streamUrl || s.rawStreamUrl);
          const embedUrl = toAbsolute(s.embedUrl || s.rawEmbedUrl);
          if (streamUrl || embedUrl) servers.push({ id: s.id != null ? s.id : idx, name: s.name || "Player " + (idx + 1), type: s.type || (streamUrl ? "hls" : "embed"), streamUrl, embedUrl });
        });
        if (!servers.length && Array.isArray(data.streams)) data.streams.forEach((s, idx) => { const u = toAbsolute(s.proxyUri || s.uri); if (u) servers.push({ id: idx, name: s.quality || s.name || "Server " + (idx + 1), type: "hls", streamUrl: u }); });
        if (!servers.length && data.streamUrl) servers.push({ id: 0, name: "Player 1 (HLS)", type: "hls", streamUrl: toAbsolute(data.streamUrl) });
        if (!servers.length && data.embedUrl) servers.push({ id: 0, name: "Player 1", type: "embed", embedUrl: toAbsolute(data.embedUrl) });
        if (servers.length) return { servers, via: "api" };
      } catch (e) {
        console.warn("[flixer] stream endpoint unavailable:", e.message);
      }
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
