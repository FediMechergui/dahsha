import { DOCUMENTARIES } from '../lib/product.js';
// Loads the catalogue section of the active language, keeps it fresh (SSE in server mode; in static
// mode status.json is checked every 10 min, on tab focus/visibility, on app resume and on demand)
// and exposes a language-scoped view with localised labels. Sections that were loaded earlier stay
// cached so switching back is instant.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useLang, channelName } from '../lib/i18n.jsx';
import { cleanTitle, decodeEntities, episodeHeadline, isolate } from '../lib/text.js';
import {
  fillMissing, mergeAliases, mergeEpisodes, newEpisodesBetween, recentEpisodesOf, rowFitsSection, shouldReload, withChannelStats,
} from '../lib/catalog-helpers.js';
import { migrateShowIds } from './useProgress.js';

const Ctx = createContext(null);
const NO_ALIASES = Object.freeze({});
const LIVE_ROWS_MAX = 3000;

export const thumbsOf = (videoId) => (videoId && /^[\w-]{11}$/.test(videoId) ? {
  max: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
  sd: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
  hq: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  mq: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
} : null);

// C9: live rows and cached data can bypass the build-time decoding.
const cleanEpisode = (e, showId) => ({ ...e, showId, title: cleanTitle(e.title), thumbs: e.thumbs || thumbsOf(e.id), synopsis: decodeEntities(e.synopsis || '') });

/** Turn the lean list payload into the full-looking objects the pages use. */
function normalizeCatalog(raw) {
  if (!raw || !Array.isArray(raw.shows)) return { shows: [], channels: [], tags: [], stats: {}, generatedAt: null, ...(raw || {}), shows: [] };
  const channelMap = new Map((raw.channels || []).map((c) => [c.id, c]));
  const shows = raw.shows.map((s) => {
    const channel = s.channel || channelMap.get(s.channelId || (!DOCUMENTARIES ? 'myflixer' : null)) || null;
    const sourcePoster = s.poster || (!DOCUMENTARIES && s.wpId ? { custom: `https://myflixerz.day/wp-content/uploads/posters/${s.wpId}_medium.jpg`, hq: `https://myflixerz.day/wp-content/uploads/posters/${s.wpId}.jpg` } : null);
    const show = {
      ...s,
      channel,
      title: cleanTitle(s.title),
      lang: s.lang || channel?.lang || raw.lang || null, // null = language-neutral (Flixer catalogue)
      // Keep the plain YouTube thumbnail set as fallbacks even when a custom poster is present.
      poster: sourcePoster ? { ...(thumbsOf(s.posterId) || {}), ...sourcePoster } : thumbsOf(s.posterId),
      synopsis: decodeEntities(s.synopsis || s.blurb || ''),
      altTitles: (s.altTitles || []).map(cleanTitle).filter(Boolean),
      seasons: s.seasons || [],
      // C3: only latestAt marks something as new in Dahsha; a missing value is never "latest".
      latestAt: s.latestAt || (!DOCUMENTARIES ? s.publishedAt : null) || null,
      firstAt: s.firstAt || s.publishedAt || null,
    };
    show.episodes = (s.episodes?.length ? s.episodes : !DOCUMENTARIES && s.kind === 'film' ? [{ id: s.id, title: s.title, publishedAt: s.publishedAt }] : []).map((e) => cleanEpisode(e, s.id));
    return show;
  });
  return { ...raw, shows, stats: raw.stats || {} };
}

/** Restrict a catalogue to one language and localise tag/channel labels. */
function scopeCatalog(all, lang) {
  if (!all) return null;
  // In Flixer, all shows are international movies & TV series.
  // Prioritize matching language if any, otherwise fallback to all shows so nothing is ever hidden.
  const shows = DOCUMENTARIES ? all.shows.filter(s => s.lang === lang) : all.shows;
  const channels = withChannelStats(all.channels || [], shows, DOCUMENTARIES ? lang : null).map((c) => ({ ...c, name: channelName(c, lang) || c.title || c.id }));
  const tags = (all.tags || []).map((t) => ({ ...t, label: lang === 'en' ? (t.labelEn || t.label) : t.label, count: lang === 'en' ? (t.countEn ?? t.count) : (t.countAr ?? t.count) })).filter((t) => t.count > 0);
  const stats = {
    ...all.stats,
    shows: shows.length,
    series: shows.filter((s) => s.kind === 'series').length,
    films: shows.filter((s) => s.kind === 'film').length,
    episodes: shows.reduce((a, s) => a + (s.episodeCount || 0), 0),
    channels: channels.length,
    totalHours: Math.round(shows.reduce((a, s) => a + (s.totalDurationSec || 0), 0) / 3600),
  };
  return { ...all, shows, channels, tags, stats, lang };
}

export function CatalogProvider({ children }) {
  const { lang, t } = useLang();
  const [sections, setSections] = useState({}); // lang → normalized payload
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(true);   // active section's first request in flight
  const [building, setBuilding] = useState(false); // server answered 503: catalogue being built
  const [checking, setChecking] = useState(false); // manual update check in flight
  const inflight = useRef(new Set());
  // Refs keep the polling/listener effect mounted once instead of re-running on every update.
  const sectionsRef = useRef(sections);
  const langRef = useRef(lang);
  const tRef = useRef(t);
  sectionsRef.current = sections; langRef.current = lang; tRef.current = t;
  const version = useRef({ value: null, at: 0 }); // newest deployment version seen in status.json
  const reloadAttempt = useRef({ version: null, at: 0 });
  const liveRows = useRef(new Map()); // rows registered from live endpoints, re-merged after reloads
  const checkRef = useRef(null);

  const pushToast = useCallback((tt) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((ts) => [...ts, { id, ...tt }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), tt.ttl ?? 9000);
  }, []);
  const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const applyStatus = useCallback((s) => {
    if (s?.generatedAt) version.current = { value: s.generatedAt, at: Date.now() };
    setStatus({ ...s, refreshing: false, static: true });
    setConnected(true);
  }, []);

  // Static mode: the catalogue URL carries the deployment version, so status.json is read first
  // (it is tiny) unless a recent value is already known.
  const knownVersion = useCallback(async () => {
    if (!api.static) return null;
    if (version.current.value && Date.now() - version.current.at < 2 * 60e3) return version.current.value;
    try { const s = await api.status(); applyStatus(s); return s.generatedAt || null; }
    catch { setConnected(false); return version.current.value; }
  }, [applyStatus]);

  // Static deploy updates have no SSE diff, so announce new episodes by comparing the sections.
  const announce = useCallback((prev, next) => {
    const fresh = newEpisodesBetween(prev, next);
    if (!fresh.length) return;
    const tt = tRef.current;
    const n = fresh.length;
    const first = fresh[0];
    const head = episodeHeadline(first.show, first.episode, { lang: langRef.current, withShow: true });
    pushToast({
      kind: 'new',
      title: n === 1 ? tt('toast_new_one') : tt('toast_new_many', { n }),
      body: n === 1 ? [head.title, head.sub].filter(Boolean).map(isolate).join(' — ') : `${isolate(cleanTitle(first.show.title))} ${tt('toast_and_more', { n: n - 1 })}`,
      to: n === 1 ? `/watch/${first.show.id}/${first.episode.id}` : '/browse?sort=latest',
      ttl: 14000,
    });
  }, [pushToast]);

  const load = useCallback(async (l, { version: wanted } = {}) => {
    if (inflight.current.has(l)) return false;
    inflight.current.add(l);
    try {
      const v = wanted || await knownVersion();
      const c = await api.catalog(l, { version: v });
      const norm = normalizeCatalog(c);
      // Keep live discovery/search rows that the fresh catalogue does not contain (canonical wins).
      const ids = new Set();
      for (const s of norm.shows) { ids.add(s.id); for (const o of s.offerings || []) ids.add(o.id); }
      const extra = [...liveRows.current.values()].filter((r) => !ids.has(r.id) && (!DOCUMENTARIES || rowFitsSection(r, l)));
      if (extra.length) norm.shows = [...norm.shows, ...normalizeCatalog({ ...c, shows: extra }).shows];
      const prev = sectionsRef.current[l];
      setSections(p => DOCUMENTARIES ? ({ ...p, [l]: norm }) : ({ ...p, ar: norm, en: norm }));
      setError(null);
      setBuilding(false);
      if (api.static && l === langRef.current && prev?.generatedAt && norm.generatedAt && prev.generatedAt !== norm.generatedAt) announce(prev, norm);
      return true;
    } catch (e) {
      if (e.status === 503) { setStatus(e.body?.status || null); setError(null); setBuilding(true); }
      else if (e.status === 404 && api.static) { setSections((prev) => ({ ...prev, [l]: { shows: [], channels: [], tags: [], stats: {}, lang: l, generatedAt: null } })); }
      else if (!sectionsRef.current[l]) setError(e.message); // a failed background reload keeps the loaded data
      return false;
    } finally { inflight.current.delete(l); setLoading(false); }
  }, [knownVersion, announce]);

  // Load the active section whenever the language changes (cached sections are kept).
  useEffect(() => { if (!sections[lang]) { setLoading(true); load(lang); } }, [lang, sections, load]);

  const reloadAll = useCallback((v) => {
    const keys = Object.keys(sectionsRef.current);
    for (const l of keys.length ? keys : [langRef.current]) load(l, { version: typeof v === 'string' ? v : undefined });
  }, [load]);

  // Server mode: SSE for status + catalogue updates. Static mode: check status.json every 10 min,
  // when the tab/app becomes visible again (throttled) and on demand.
  useEffect(() => {
    if (api.static || !DOCUMENTARIES) {
      let stop = false;
      let lastCheck = Date.now(); // the first load already read status.json
      const tick = async (force = false) => {
        if (stop || (!force && Date.now() - lastCheck < 60e3)) return 'skipped';
        lastCheck = Date.now();
        try {
          const s = await api.status();
          if (stop) return 'skipped';
          applyStatus(s);
          const current = sectionsRef.current[langRef.current]?.generatedAt;
          if (shouldReload({ statusVersion: s.generatedAt, sectionVersion: current, attempt: reloadAttempt.current })) {
            reloadAttempt.current = { version: s.generatedAt, at: Date.now() };
            reloadAll(s.generatedAt);
            return 'updating';
          }
          return s.generatedAt && current && s.generatedAt !== current ? 'pending' : 'current';
        } catch {
          if (!stop) setConnected(false);
          return 'offline';
        }
      };
      checkRef.current = tick;
      const interval = setInterval(() => tick(true), 10 * 60e3);
      const onVisible = () => { if (document.visibilityState !== 'hidden') tick(); };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
      window.addEventListener('online', onVisible);
      // Android app: the native @capacitor/app plugin is registered in the APK; no JS dependency needed.
      let resume = null;
      const app = window.Capacitor?.Plugins?.App;
      if (app?.addListener) {
        try {
          Promise.resolve(app.addListener('resume', () => tick())).then((h) => { if (stop) h?.remove?.(); else resume = h; }, () => {});
        } catch { /* plugin unavailable */ }
      }
      return () => {
        stop = true;
        checkRef.current = null;
        clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', onVisible);
        window.removeEventListener('online', onVisible);
        resume?.remove?.();
      };
    }
    let es;
    let retry = 1000;
    let closed = false;
    let reconnectTimer;
    const connect = () => {
      es = new EventSource(`${import.meta.env.VITE_API_BASE || ''}/api/events`);
      es.onopen = () => { setConnected(true); retry = 1000; };
      es.addEventListener('status', (ev) => setStatus(JSON.parse(ev.data)));
      es.addEventListener('update', (ev) => {
        const u = JSON.parse(ev.data);
        reloadAll();
        const n = u.diff?.newEpisodes?.length || 0;
        const tt = tRef.current;
        if (n && !u.diff.initial) {
          const first = u.diff.newEpisodes[0];
          pushToast({
            kind: 'new',
            title: n === 1 ? tt('toast_new_one') : tt('toast_new_many', { n }),
            body: n === 1 ? `${isolate(cleanTitle(first.title))} — ${isolate(cleanTitle(first.showTitle))}${first.channel ? ` (${first.channel})` : ''}` : `${isolate(cleanTitle(first.showTitle))} ${tt('toast_and_more', { n: n - 1 })}`,
            to: n === 1 ? `/watch/${first.showId}/${first.id}` : '/browse?sort=latest',
            ttl: 14000,
          });
        } else if (u.diff?.initial) {
          pushToast({ kind: 'info', title: tt('toast_built'), body: `${u.stats.shows} • ${u.stats.episodes}` });
        }
      });
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!closed) reconnectTimer = setTimeout(connect, Math.min(retry *= 2, 30000));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(reconnectTimer); es?.close(); };
  }, [applyStatus, reloadAll, pushToast]);

  /** Manual "check for updates" (static mode): forces a status read and reloads on a new deploy. */
  const checkNow = useCallback(async () => {
    const tt = tRef.current;
    if (!checkRef.current) { reloadAll(); return; }
    setChecking(true);
    try {
      reloadAttempt.current = { version: null, at: 0 };
      const result = await checkRef.current(true);
      if (result === 'updating') pushToast({ kind: 'info', title: tt('toast_updating'), body: tt('toast_updating_body'), ttl: 5000 });
      else if (result === 'offline') pushToast({ kind: 'error', title: tt('toast_refresh_failed'), ttl: 6000 });
      else pushToast({ kind: 'info', title: tt('toast_up_to_date'), body: tt('toast_up_to_date_body'), ttl: 4000 });
    } finally { setChecking(false); }
  }, [pushToast, reloadAll]);

  const refresh = useCallback(async (full = false) => {
    const tt = tRef.current;
    try {
      if (api.static || !DOCUMENTARIES) { await checkNow(); return; }
      await api.refresh(full);
      pushToast({ kind: 'info', title: tt('toast_refreshing'), body: tt('toast_refreshing_body'), ttl: 5000 });
    }
    catch (e) { pushToast({ kind: 'error', title: tt('toast_refresh_failed'), body: e.message }); }
  }, [pushToast, checkNow]);

  // "all" = every section loaded so far (used for cross-language show links and global stats).
  const all = useMemo(() => {
    const loaded = Object.values(sections).filter(Boolean);
    if (!loaded.length) return null;
    const base = sections[lang] || loaded[0];
    const seen = new Set();
    const shows = [];
    for (const s of loaded) for (const x of s.shows) if (!seen.has(x.id)) { seen.add(x.id); shows.push(x); }
    const channels = []; const cseen = new Set();
    for (const s of loaded) for (const c of s.channels || []) if (!cseen.has(c.id)) { cseen.add(c.id); channels.push(c); }
    return { ...base, shows, channels, idAliases: mergeAliases(loaded) };
  }, [sections, lang]);

  const idAliases = all?.idAliases && Object.keys(all.idAliases).length ? all.idAliases : NO_ALIASES;
  // C1: move favourites/progress from renamed show ids (runs once per alias map).
  useEffect(() => { if (idAliases !== NO_ALIASES) migrateShowIds(idAliases); }, [idAliases]);

  const catalog = useMemo(() => scopeCatalog(sections[lang] ? all : null, lang), [all, sections, lang]);

  const derived = useMemo(() => {
    if (!catalog) return { tagMap: new Map(), channelMap: new Map(), showMap: new Map(), episodeIndex: new Map(), recentEpisodes: [] };
    const tagMap = new Map(catalog.tags.map((x) => [x.id, x]));
    const channelMap = new Map((catalog.channels || []).map((c) => [c.id, c]));
    const showMap = new Map(catalog.shows.map((s) => [s.id, s]));
    const episodeIndex = new Map();
    for (const s of catalog.shows) for (const e of s.episodes) episodeIndex.set(e.id, { show: s, episode: e });
    // At most two cards per show: one series whose episodes share a date cannot fill the row.
    const recentEpisodes = recentEpisodesOf(catalog.shows, { perShow: 2, limit: 40 });
    return { tagMap, channelMap, showMap, episodeIndex, recentEpisodes };
  }, [catalog]);

  const allShowMap = useMemo(() => {
    const map = new Map();
    for (const show of all?.shows || []) { map.set(show.id,show); for (const offering of show.offerings || []) map.set(offering.id,show); }
    return map;
  }, [all]);

  // Live rows go only into the section of their language; canonical catalogue fields win, live
  // rows fill gaps. Nothing changes (no re-render) when no loaded section takes the rows.
  const registerShows = useCallback(rows => {
    const valid = (rows || []).filter((r) => r && typeof r.id === 'string');
    if (!valid.length) return;
    for (const r of valid) { liveRows.current.delete(r.id); liveRows.current.set(r.id, r); }
    while (liveRows.current.size > LIVE_ROWS_MAX) liveRows.current.delete(liveRows.current.keys().next().value);
    setSections(previous => {
      let changed = false;
      const next = { ...previous };
      for (const key of Object.keys(previous)) {
        const section = previous[key];
        const fit = DOCUMENTARIES ? valid.filter((r) => rowFitsSection(r, key)) : valid;
        if (!fit.length) continue;
        const normalized = normalizeCatalog({ ...section, shows: fit }).shows;
        const map = new Map(section.shows.map(show => [show.id, show]));
        for (const show of normalized) {
          const old = map.get(show.id);
          map.set(show.id, old ? fillMissing(old, show) : show);
        }
        next[key] = { ...section, shows: [...map.values()] };
        changed = true;
      }
      return changed ? next : previous;
    });
  }, []);

  const value = useMemo(() => ({
    catalog, all, allShowMap, idAliases, registerShows, error, status, connected, loading, building, checking, toasts, pushToast, dismissToast, refresh, checkNow, reload: reloadAll, ...derived,
  }), [catalog, all, allShowMap, idAliases, registerShows, error, status, connected, loading, building, checking, toasts, pushToast, dismissToast, refresh, checkNow, reloadAll, derived]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCatalog() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCatalog outside provider');
  return v;
}

/**
 * Full show record (complete synopsis, per-episode synopses). Returns the lite show immediately
 * (when its section is loaded) and swaps in the full one once fetched; works for shows of either
 * language, even when their section is not loaded (shared links). The per-show file is versioned
 * with the deployment so it never lags the catalogue.
 */
export function useFullShow(id) {
  const { allShowMap, all } = useCatalog();
  const lite = allShowMap.get(id) || null;
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const liteRef = useRef(lite);
  liteRef.current = lite;
  useEffect(() => {
    let cancelled = false;
    setFull(null);
    if (!id) return undefined;
    setLoading(true); setError(null);
    const base = liteRef.current;
    api.show(id, {
      sources: base?.offerings?.map(o=>o.sourceUrl).filter(Boolean) || [],
      source: base?.offerings?.find(o => ['fmovies', 'hdtoday'].includes(o.provider))?.sourceUrl || base?.sourceUrl,
      version: all?.generatedAt || undefined,
    }).then((s) => {
      if (cancelled) return;
      const liteNow = liteRef.current;
      const channel = s.channel || liteNow?.channel || null;
      const show = {
        ...s, requestedId: id, channel,
        title: cleanTitle(s.title || liteNow?.title),
        synopsis: decodeEntities(s.synopsis || s.blurb || liteNow?.synopsis || ''),
        lang: s.lang || channel?.lang || liteNow?.lang || null,
        poster: s.poster || liteNow?.poster || thumbsOf(s.posterVideoId || s.posterId),
        portrait: s.portrait || liteNow?.portrait || null,
        latestAt: s.latestAt || liteNow?.latestAt || null,
        altTitles: (s.altTitles || []).map(cleanTitle).filter(Boolean),
        seasons: s.seasons || liteNow?.seasons || [],
        tags: s.tags || liteNow?.tags || [],
      };
      const rawEpisodes = s.episodes?.length ? s.episodes : !DOCUMENTARIES && s.kind === 'film' ? [{ id: s.id, title: s.title, publishedAt: s.publishedAt }] : [];
      // A catalogue episode missing from the full record (mismatched deploys) is kept, not lost.
      show.episodes = mergeEpisodes(rawEpisodes, liteNow?.id === s.id ? liteNow.episodes : []).map((e) => cleanEpisode(e, s.id));
      show.episodeCount = Math.max(show.episodeCount || 0, show.episodes.length);
      setFull(show);
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, all?.generatedAt]);
  const show = full && full.requestedId === id ? full : lite;
  return show ? { ...show, detailsLoading: loading, detailsError: error } : loading ? { id, episodes: [], tags: [], altTitles: [], detailsLoading: true } : null;
}
