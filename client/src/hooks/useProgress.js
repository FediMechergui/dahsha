// Watch progress + favourites, kept in localStorage and shared app-wide through a tiny store.
import { useSyncExternalStore } from 'react';

const KEY_PROGRESS = 'ng.progress.v1';
const KEY_FAV = 'ng.favorites.v1';

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
  toggle(showId) {
    favorites = favorites.includes(showId) ? favorites.filter((x) => x !== showId) : [showId, ...favorites];
    save(KEY_FAV, favorites); emit();
  },
  all: () => favorites,
};

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
  for (const s of catalog.shows) for (const e of s.episodes) byEp.set(e.id, { show: s, episode: e });
  return Object.entries(progressMap)
    .filter(([id, p]) => !p.finished && p.position > 30 && byEp.has(id))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, limit)
    .map(([id, p]) => ({ ...byEp.get(id), progress: p }));
}
