// Loads the catalogue, keeps it fresh (SSE in server mode, periodic re-fetch in static mode) and
// exposes a language-scoped view: only the shows of the active UI language, with localised labels.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useLang, channelName } from '../lib/i18n.jsx';

const Ctx = createContext(null);

export const thumbsOf = (videoId) => (videoId ? {
  max: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
  sd: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
  hq: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  mq: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
} : null);

/** Turn the lean list payload into the full-looking objects the pages use. */
function normalizeCatalog(raw) {
  if (!raw) return raw;
  const channelMap = new Map((raw.channels || []).map((c) => [c.id, c]));
  const shows = raw.shows.map((s) => {
    const channel = s.channel || channelMap.get(s.channelId) || null;
    const show = {
      ...s,
      channel,
      lang: s.lang || channel?.lang || 'ar',
      poster: s.poster || thumbsOf(s.posterId),
      synopsis: s.synopsis || s.blurb || '',
      altTitles: s.altTitles || [],
      seasons: s.seasons || [],
    };
    show.episodes = (s.episodes || []).map((e) => ({ ...e, showId: s.id, thumbs: e.thumbs || thumbsOf(e.id), synopsis: e.synopsis || '' }));
    return show;
  });
  return { ...raw, shows };
}

/** Restrict a catalogue to one language and localise tag/channel labels. */
function scopeCatalog(all, lang) {
  if (!all) return null;
  const shows = all.shows.filter((s) => (s.lang || 'ar') === lang);
  const channels = (all.channels || []).filter((c) => (c.lang || 'ar') === lang).map((c) => ({ ...c, name: channelName(c, lang) }));
  const tags = (all.tags || []).map((t) => ({ ...t, label: lang === 'en' ? (t.labelEn || t.label) : t.label, count: lang === 'en' ? (t.countEn ?? t.count) : (t.countAr ?? t.count) })).filter((t) => t.count > 0);
  const stats = {
    ...all.stats,
    shows: shows.length,
    series: shows.filter((s) => s.kind === 'series').length,
    films: shows.filter((s) => s.kind === 'film').length,
    episodes: shows.reduce((a, s) => a + s.episodeCount, 0),
    channels: channels.length,
    totalHours: Math.round(shows.reduce((a, s) => a + (s.totalDurationSec || 0), 0) / 3600),
  };
  return { ...all, shows, channels, tags, stats, lang };
}

export function CatalogProvider({ children }) {
  const { lang, t } = useLang();
  const [all, setAll] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(true);   // first request still in flight
  const [building, setBuilding] = useState(false); // server answered 503: catalogue being built
  const loadingRef = useRef(false);

  const pushToast = useCallback((tt) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((ts) => [...ts, { id, ...tt }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), tt.ttl ?? 9000);
  }, []);
  const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const c = await api.catalog();
      setAll(normalizeCatalog(c));
      setError(null);
      setBuilding(false);
    } catch (e) {
      if (e.status === 503) { setStatus(e.body?.status || null); setError(null); setBuilding(true); }
      else setError(e.message);
    } finally { loadingRef.current = false; setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Server mode: SSE for status + catalogue updates. Static mode: poll status.json every 10 min.
  useEffect(() => {
    if (api.static) {
      let stop = false;
      const tick = async () => {
        try {
          const s = await api.status();
          setStatus((prev) => ({ ...s, refreshing: false, static: true }));
          setConnected(true);
          if (s.generatedAt && all?.generatedAt && s.generatedAt !== all.generatedAt) load();
        } catch { setConnected(false); }
      };
      tick();
      const id = setInterval(() => !stop && tick(), 10 * 60e3);
      return () => { stop = true; clearInterval(id); };
    }
    let es;
    let retry = 1000;
    let closed = false;
    const connect = () => {
      es = new EventSource('/api/events');
      es.onopen = () => { setConnected(true); retry = 1000; };
      es.addEventListener('status', (ev) => setStatus(JSON.parse(ev.data)));
      es.addEventListener('update', (ev) => {
        const u = JSON.parse(ev.data);
        load();
        const n = u.diff?.newEpisodes?.length || 0;
        if (n && !u.diff.initial) {
          const first = u.diff.newEpisodes[0];
          pushToast({
            kind: 'new',
            title: n === 1 ? t('toast_new_one') : t('toast_new_many', { n }),
            body: n === 1 ? `${first.title} — ${first.showTitle}${first.channel ? ` (${first.channel})` : ''}` : `${first.showTitle} ${t('toast_and_more', { n: n - 1 })}`,
            to: n === 1 ? `/watch/${first.showId}/${first.id}` : '/browse?sort=latest',
            ttl: 14000,
          });
        } else if (u.diff?.initial) {
          pushToast({ kind: 'info', title: t('toast_built'), body: `${u.stats.shows} • ${u.stats.episodes}` });
        }
      });
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!closed) setTimeout(connect, Math.min(retry *= 2, 30000));
      };
    };
    connect();
    return () => { closed = true; es?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, pushToast, all?.generatedAt]);

  const refresh = useCallback(async (full = false) => {
    try { await api.refresh(full); pushToast({ kind: 'info', title: t('toast_refreshing'), body: t('toast_refreshing_body'), ttl: 5000 }); }
    catch (e) { pushToast({ kind: 'error', title: t('toast_refresh_failed'), body: e.message }); }
  }, [pushToast, t]);

  const catalog = useMemo(() => scopeCatalog(all, lang), [all, lang]);

  const derived = useMemo(() => {
    if (!catalog) return { tagMap: new Map(), channelMap: new Map(), showMap: new Map(), episodeIndex: new Map(), recentEpisodes: [] };
    const tagMap = new Map(catalog.tags.map((x) => [x.id, x]));
    const channelMap = new Map((catalog.channels || []).map((c) => [c.id, c]));
    const showMap = new Map(catalog.shows.map((s) => [s.id, s]));
    const episodeIndex = new Map();
    const list = [];
    for (const s of catalog.shows) for (const e of s.episodes) { episodeIndex.set(e.id, { show: s, episode: e }); list.push({ show: s, episode: e }); }
    const recentEpisodes = list
      .filter((x) => x.episode.publishedAt)
      .sort((a, b) => b.episode.publishedAt.localeCompare(a.episode.publishedAt))
      .slice(0, 40);
    return { tagMap, channelMap, showMap, episodeIndex, recentEpisodes };
  }, [catalog]);

  // Shows of the other language are still reachable by id (shared links), via allShowMap.
  const allShowMap = useMemo(() => new Map((all?.shows || []).map((s) => [s.id, s])), [all]);

  const value = useMemo(() => ({
    catalog, all, allShowMap, error, status, connected, loading, building, toasts, pushToast, dismissToast, refresh, reload: load, ...derived,
  }), [catalog, all, allShowMap, error, status, connected, loading, building, toasts, pushToast, dismissToast, refresh, load, derived]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCatalog() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCatalog outside provider');
  return v;
}

/**
 * Full show record (complete synopsis, per-episode synopses). Returns the lite show immediately
 * and swaps in the full one once fetched. Works for shows of either language.
 */
export function useFullShow(id) {
  const { allShowMap, all } = useCatalog();
  const lite = allShowMap.get(id) || null;
  const [full, setFull] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setFull(null);
    if (!id) return undefined;
    api.show(id).then((s) => {
      if (cancelled) return;
      const channel = s.channel || lite?.channel || null;
      const show = { ...s, channel, lang: s.lang || channel?.lang || 'ar', poster: s.poster || thumbsOf(s.posterVideoId), altTitles: s.altTitles || [], seasons: s.seasons || [] };
      show.episodes = (s.episodes || []).map((e) => ({ ...e, showId: s.id, thumbs: e.thumbs || thumbsOf(e.id) }));
      setFull(show);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, all?.generatedAt]);
  return full && full.id === id ? full : lite;
}
