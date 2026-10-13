/* TVmaze tier for Flixer: keyless, series only. Gives rating, popularity weight, network or web
   channel (where it streams), status, summary, portrait image, cast and the episode guide. Results
   are cached on the device. Movies are not covered by TVmaze. */
(function () {
  const BASE = "https://api.tvmaze.com";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("flixer:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("flixer:" + k, JSON.stringify(v)); } catch { /* quota */ } }
  };
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^(the|a|an)\s+/, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const plain = html => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  async function getJson(url, ms = 10000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status === 404) return null;
      if (res.status === 429) { await new Promise(r => setTimeout(r, 1500)); return getJson(url, ms); }
      if (!res.ok) throw new Error("TVmaze request failed (" + res.status + ")");
      return res.json();
    } finally { clearTimeout(t); }
  }

  const shape = s => s ? ({
    id: s.id, name: s.name, year: +String(s.premiered || "").slice(0, 4) || 0,
    weight: s.weight || 0, rating: (s.rating && s.rating.average) || 0,
    genres: s.genres || [], status: s.status || "", type: s.type || "", language: s.language || "",
    network: s.network ? { name: s.network.name, country: s.network.country && s.network.country.code } : null,
    web: s.webChannel ? { name: s.webChannel.name, country: s.webChannel.country && s.webChannel.country.code } : null,
    service: (s.webChannel && s.webChannel.name) || (s.network && s.network.name) || "",
    schedule: s.schedule && s.schedule.days && s.schedule.days.length ? `${s.schedule.days.join(", ")}${s.schedule.time ? " · " + s.schedule.time : ""}` : "",
    runtime: s.averageRuntime || s.runtime || null,
    summary: plain(s.summary),
    image: s.image ? { medium: s.image.medium, original: s.image.original } : null,
    url: s.url || "", imdb: s.externals && s.externals.imdb || null
  }) : null;

  class TvMaze {
    constructor() { this.cache = store.get("tvm:shows", {}); this._inflight = new Map(); }
    _save() {
      const keys = Object.keys(this.cache);
      if (keys.length > 600) keys.slice(0, keys.length - 600).forEach(k => delete this.cache[k]);
      store.set("tvm:shows", this.cache);
    }
    // Resolve a Flixer series to a TVmaze show (by id from the index when present, else by title + year).
    async show(item) {
      const key = item.id;
      const cached = this.cache[key];
      if (cached && Date.now() - cached.t < 3 * 86400e3) return cached.s;
      if (this._inflight.has(key)) return this._inflight.get(key);
      const p = (async () => {
        let s = null;
        try {
          if (item.tvmazeId) s = shape(await getJson(`${BASE}/shows/${item.tvmazeId}`));
          if (!s) {
            const rows = await getJson(`${BASE}/search/shows?q=${encodeURIComponent(item.title)}`) || [];
            const want = norm(item.title), y = +item.year || 0;
            const cands = rows.map(r => r.show).filter(x => norm(x.name) === want);
            const pick = (y && cands.find(x => +String(x.premiered || "").slice(0, 4) === y)) || (y && cands.find(x => Math.abs(+String(x.premiered || "").slice(0, 4) - y) <= 1)) || cands[0] || (rows[0] && rows[0].score > 0.9 ? rows[0].show : null);
            s = shape(pick);
          }
        } catch (e) { console.warn("[tvmaze]", e.message); }
        this.cache[key] = { t: Date.now(), s };
        this._save();
        return s;
      })();
      this._inflight.set(key, p);
      try { return await p; } finally { this._inflight.delete(key); }
    }
    async cast(tvmId) {
      const rows = await getJson(`${BASE}/shows/${tvmId}/cast`) || [];
      return rows.slice(0, 12).map(c => ({ name: c.person && c.person.name, role: c.character && c.character.name, pic: c.person && c.person.image ? c.person.image.medium : null }));
    }
    async episodes(tvmId) {
      const rows = await getJson(`${BASE}/shows/${tvmId}/episodes`) || [];
      return rows.map(e => ({ season: e.season, n: e.number, title: e.name, date: e.airdate || "", runtime: e.runtime || null, still: e.image ? e.image.medium : null, overview: plain(e.summary) }));
    }
  }

  window.FlixerTvMaze = { TvMaze };
})();
