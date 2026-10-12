// Orchestrates refreshes: lists playlists + uploads per channel, detects changes, fetches details,
// rebuilds the catalogue and emits events that the HTTP layer forwards to browsers over SSE.
import { EventEmitter } from 'node:events';
import { readJson, writeJson, DEFAULT_SOURCES, DEFAULT_OVERRIDES } from './store.js';
import {
  listChannelPlaylists, listChannelUploads, getPlaylistVideos, getVideoDetails, fetchChannelFeed, pool, resolveSource, detectProfile,
} from './youtube.js';
import { buildCatalog, diffCatalog } from './catalog.js';

const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 15);
const FEED_MINUTES = Number(process.env.FEED_MINUTES || 3);
const uploadsKey = (channelId) => `UPLOADS:${channelId}`;

// Fill in fields that older sources.json files did not have.
function normalizeSource(s) {
  const det = detectProfile(s.id, s.title, s.url);
  return {
    scanUploads: s.type === 'channel',
    maxUploads: det.profile === 'dw' ? 1500 : 400,
    ...s,
    profile: s.profile || det.profile,
    lang: s.lang || det.lang,
    short: s.short || det.short || s.title,
    brands: s.brands || det.brands || [s.title],
  };
}

export class Catalogue extends EventEmitter {
  constructor() {
    super();
    this.sources = readJson('sources.json', DEFAULT_SOURCES).sources.map(normalizeSource);
    this.overrides = { ...DEFAULT_OVERRIDES, ...readJson('overrides.json', DEFAULT_OVERRIDES) };
    this.playlists = readJson('playlists.json', {});
    this.details = readJson('details.json', {});
    this.seen = readJson('seen.json', {});
    this.catalog = readJson('catalog.json', null);
    this.status = { refreshing: false, stage: 'idle', progress: null, lastRefreshAt: this.catalog?.generatedAt || null, lastError: null, nextRefreshAt: null };
    this.feedSeen = new Set();
    this._timers = [];
  }

  // ---- lifecycle -------------------------------------------------------------------------
  async start() {
    if (!this.catalog) {
      console.log('[catalogue] no catalogue on disk - building for the first time (this takes a few minutes)');
      this.refresh({ full: true }).catch((e) => console.error('[catalogue] initial build failed', e));
    } else {
      console.log(`[catalogue] loaded ${this.catalog.stats.shows} shows / ${this.catalog.stats.episodes} episodes from disk`);
      this.refresh().catch(() => {});
    }
    this._timers.push(setInterval(() => this.refresh().catch(() => {}), REFRESH_MINUTES * 60e3));
    this._timers.push(setInterval(() => this.fastPoll().catch(() => {}), FEED_MINUTES * 60e3));
    this._scheduleNext();
  }

  stop() { this._timers.forEach(clearInterval); }

  _scheduleNext() { this.status.nextRefreshAt = new Date(Date.now() + REFRESH_MINUTES * 60e3).toISOString(); }

  _setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.status);
  }

  // ---- sources ---------------------------------------------------------------------------
  async addSource(input) {
    const src = await resolveSource(input);
    if (this.sources.some((s) => s.id === src.id)) throw new Error('هذا المصدر موجود بالفعل');
    this.sources.push(normalizeSource({ ...src, addedAt: new Date().toISOString() }));
    writeJson('sources.json', { sources: this.sources });
    this.refresh().catch(() => {});
    return src;
  }

  removeSource(id) {
    const before = this.sources.length;
    this.sources = this.sources.filter((s) => s.id !== id);
    if (this.sources.length === before) throw new Error('المصدر غير موجود');
    writeJson('sources.json', { sources: this.sources });
    for (const [pid, pl] of Object.entries(this.playlists)) if (pl.sourceId === id) delete this.playlists[pid];
    writeJson('playlists.json', this.playlists);
    this.rebuild();
  }

  // ---- refresh ---------------------------------------------------------------------------
  /** Rebuild the catalogue from cached data only (no network). */
  rebuild() {
    this.overrides = { ...DEFAULT_OVERRIDES, ...readJson('overrides.json', DEFAULT_OVERRIDES) };
    const next = buildCatalog({ playlists: this.playlists, details: this.details, seen: this.seen, overrides: this.overrides, sources: this.sources });
    const diff = diffCatalog(this.catalog, next);
    this.catalog = next;
    writeJson('catalog.json', next);
    this.emit('update', { diff, generatedAt: next.generatedAt, stats: next.stats });
    return diff;
  }

  async refresh({ full = false } = {}) {
    if (this.status.refreshing) return null;
    this._setStatus({ refreshing: true, stage: 'listing', progress: null, lastError: null });
    const t0 = Date.now();
    try {
      const toFetch = [];
      const uploadJobs = [];
      for (const src of this.sources) {
        if (src.type === 'channel') {
          const listed = await listChannelPlaylists(src.id).catch((e) => { console.warn(`[catalogue] playlists of ${src.title}: ${e.message}`); return null; });
          if (listed) {
            const listedIds = new Set(listed.map((p) => p.id));
            for (const pid of Object.keys(this.playlists)) {
              const pl = this.playlists[pid];
              if (pl.sourceId === src.id && !pl.isUploads && !listedIds.has(pid)) delete this.playlists[pid];
            }
            for (const p of listed) {
              const cached = this.playlists[p.id];
              if (full || !cached || cached.signature !== p.signature) toFetch.push({ ...p, sourceId: src.id });
            }
          }
          if (src.scanUploads) uploadJobs.push(src);
        } else if (src.type === 'playlist') {
          toFetch.push({ id: src.id, title: src.title, signature: null, sourceId: src.id });
        }
      }

      this._setStatus({ stage: 'playlists', progress: { done: 0, total: toFetch.length + uploadJobs.length } });
      let done = 0;
      const tick = () => this._setStatus({ progress: { done: ++done, total: toFetch.length + uploadJobs.length } });
      await pool(toFetch, async (p) => {
        const data = await getPlaylistVideos(p.id);
        this.playlists[p.id] = { ...data, title: data.title || p.title, signature: p.signature, sourceId: p.sourceId, fetchedAt: new Date().toISOString() };
        tick();
      }, 4);
      // Uploads tab: incremental (stop at the first already-known video) unless a full refresh.
      await pool(uploadJobs, async (src) => {
        const key = uploadsKey(src.id);
        const cached = this.playlists[key];
        const knownIds = !full && cached ? new Set(cached.videos.map((v) => v.id)) : null;
        const { videos } = await listChannelUploads(src.id, { max: src.maxUploads || 400, knownIds });
        const merged = new Map();
        for (const v of videos) merged.set(v.id, v);
        if (cached && !full) for (const v of cached.videos) if (!merged.has(v.id)) merged.set(v.id, v);
        this.playlists[key] = {
          id: key, title: '__uploads__', isUploads: true, sourceId: src.id, signature: null,
          videos: [...merged.values()].slice(0, Math.max(src.maxUploads || 400, videos.length)), fetchedAt: new Date().toISOString(),
        };
        tick();
      }, 2);
      if (toFetch.length || uploadJobs.length) writeJson('playlists.json', this.playlists);

      // Details for videos we have not seen yet. Full episodes first so the catalogue grows fastest.
      const minSec = this.overrides.minEpisodeSeconds ?? 420;
      const pending = [];
      const nowIso = new Date().toISOString();
      for (const pl of Object.values(this.playlists)) {
        for (const v of pl.videos || []) {
          if (!this.seen[v.id]) this.seen[v.id] = nowIso;
          if (!this.details[v.id]) pending.push(v);
        }
      }
      const uniq = [...new Map(pending.map((v) => [v.id, v])).values()].sort((a, b) => (b.durationSec >= minSec) - (a.durationSec >= minSec));
      if (uniq.length) {
        this._setStatus({ stage: 'details', progress: { done: 0, total: uniq.length } });
        let since = 0;
        await pool(uniq, async (v) => {
          this.details[v.id] = await getVideoDetails(v.id);
          if (++since % 50 === 0) writeJson('details.json', this.details);
        }, 4, (d, total) => this._setStatus({ progress: { done: d, total } }));
        writeJson('details.json', this.details);
      }
      writeJson('seen.json', this.seen);

      this._setStatus({ stage: 'building', progress: null });
      const diff = this.rebuild();
      const ms = Date.now() - t0;
      console.log(`[catalogue] refresh done in ${(ms / 1000).toFixed(1)}s - playlists fetched ${toFetch.length}, uploads scanned ${uploadJobs.length}, details ${uniq.length}, new episodes ${diff.newEpisodes.length}, new shows ${diff.newShows.length}`);
      this._scheduleNext();
      this._setStatus({ refreshing: false, stage: 'idle', progress: null, lastRefreshAt: new Date().toISOString() });
      return diff;
    } catch (e) {
      console.error('[catalogue] refresh failed:', e);
      this._scheduleNext();
      this._setStatus({ refreshing: false, stage: 'idle', progress: null, lastError: e.message });
      throw e;
    }
  }

  /** Cheap RSS poll: if a channel uploaded something we don't know, trigger a refresh. */
  async fastPoll() {
    if (this.status.refreshing) return;
    const known = new Set(Object.values(this.playlists).flatMap((p) => (p.videos || []).map((v) => v.id)));
    let trigger = false;
    for (const src of this.sources) {
      if (src.type !== 'channel') continue;
      try {
        const feed = await fetchChannelFeed(src.id);
        for (const e of feed) {
          if (!known.has(e.id) && !this.feedSeen.has(e.id)) { this.feedSeen.add(e.id); trigger = true; }
        }
      } catch (e) { /* feed hiccup - ignore */ }
    }
    if (trigger) {
      console.log('[catalogue] new upload spotted in feed - refreshing');
      await this.refresh();
    }
  }

  // ---- read API --------------------------------------------------------------------------
  getCatalog() { return this.catalog; }
  getShow(id) { return this.catalog?.shows.find((s) => s.id === id) || null; }
  getStatus() {
    return { ...this.status, refreshMinutes: REFRESH_MINUTES, feedMinutes: FEED_MINUTES, stats: this.catalog?.stats || null, generatedAt: this.catalog?.generatedAt || null };
  }
}
