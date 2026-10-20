// Watch progress + favourites, kept in localStorage and shared app-wide through a tiny store.
import { useSyncExternalStore } from 'react';

import { PRODUCT } from '../lib/product.js';
import { aliasSignature, migrateStoredIds, toggleFavorite } from '../lib/catalog-helpers.js';
const KEY_PROGRESS = `${PRODUCT}.progress.v1`;
const KEY_FAV = `${PRODUCT}.favorites.v1`;
const KEY_ALIASES = `${PRODUCT}.aliases-applied.v1`;

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

let progress = load(KEY_PROGRESS, {});
let favorites = load(KEY_FAV, []);
const listeners = new Set();
function emit() { for (const l of listeners) l(); }
function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }

window.addEventListener('storage', (e) => {
  if (e.key === KEY_PROGRESS) { progress = load(KEY_PROGRESS, {}); emit(); }
  if (e.key === KEY_FAV) { favorites = load(KEY_FAV, []); emit(); }
});

export const progressStore = {
  get: (epId) => progress[epId] || null,
  set(epId, { showId, position, duration }) {
    const finished = duration > 0 && position / duration > 0.95;
    progress = { ...progress, [epId]: { showId, position, duration, finished, at: Date.now() } };
    save(KEY_PROGRESS, progress);
    emit();
  },
  clear(epId) {
    const { [epId]: _, ...rest } = progress;
    progress = rest; save(KEY_PROGRESS, progress); emit();
  },
  all: () => progress,
};

export const favoritesStore = {
  has: (showId) => favorites.includes(showId),
  /**
   * Adds the card, or removes it under every id it may be stored as (`ids`, see favoriteIdsOf: a
   * favourite saved under a provider card that is now one of its versions or offerings).
   */
  toggle(showId, ids = [showId]) {
    favorites = toggleFavorite(favorites, showId, ids);
    save(KEY_FAV, favorites); emit();
  },
  all: () => favorites,
};

/**
 * C1: show ids can be renamed by a rebuild (catalog.idAliases = { oldId: newId }). Rewrites the
 * stored favourites and progress entries once per alias map; idempotent if it runs again.
 */
export function migrateShowIds(aliases) {
  if (!aliases || !Object.keys(aliases).length) return false;
  const signature = aliasSignature(aliases);
  try { if (localStorage.getItem(KEY_ALIASES) === signature) return false; } catch { return false; }
  const result = migrateStoredIds({ progress, favorites }, aliases);
  if (result.changed) {
    progress = result.progress; favorites = result.favorites;
    save(KEY_PROGRESS, progress); save(KEY_FAV, favorites);
    emit();
  }
  try { localStorage.setItem(KEY_ALIASES, signature); } catch { /* storage unavailable */ }
  return result.changed;
}

export function useProgress() {
  return useSyncExternalStore(subscribe, () => progress);
}
export function useFavorites() {
  return useSyncExternalStore(subscribe, () => favorites);
}

/** Episodes in progress (not finished), most recent first. */
export function continueWatching(progressMap, catalog, limit = 12) {
  if (!catalog) return [];
  const byEp = new Map();
  for (const s of catalog.shows) for (const e of s.episodes) { byEp.set(e.id, {show:s,episode:e}); for (const offering of e.offerings || []) byEp.set(offering.id,{show:s,episode:e}); }
  // An uncertain version (show.versions[], its own page /show/<versionId>) keeps progress under its own episode ids.
  for (const s of catalog.shows) for (const v of s.versions || []) {
    const show = { ...v, lang: v.lang || s.lang, poster: v.poster || s.poster, channel: s.channel };
    for (const e of v.episodes || []) for (const id of [e.id, ...(e.offerings || []).map((o) => o.id)]) if (id && !byEp.has(id)) byEp.set(id, { show, episode: { ...e, showId: v.id } });
  }
  return Object.entries(progressMap)
    .filter(([id, p]) => !p.finished && p.position > 30 && byEp.has(id))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, limit)
    .map(([id, p]) => ({ ...byEp.get(id), progress: p }));
}
