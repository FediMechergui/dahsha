// Stable show ids across rebuilds (contract 2).
// A show's id is first the hash of its normalised title key (catalog.js), so a title fix, an English
// re-title or an upstream rename would re-key the show: favourites, shared links, artwork and overrides
// keyed by id would be orphaned. Given the previous catalogue, a show keeps the id of the previous show
// whose episodes it mostly holds, and an id that still disappears is aliased ({oldId: liveId}) to the
// show now holding most of its episodes. The alias map is carried forward from one catalogue to the
// next, since a CI run rebuilds two or three times and a plain previous/next diff would lose it.
// Ids therefore depend on that history: showIdState() is the part of a catalogue they depend on, to be
// kept beside it, so a build without the catalogue can still start from it.
import { shortHash } from './text.js';

const isShowId = (id) => typeof id === 'string' && id.startsWith('s_');
const isRecord = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const STATE_VERSION = 'show-ids/1';

/**
 * The previous catalogue's s_ shows as Map<id, units>. A unit is one listed episode: the ids it goes by,
 * itself first, then its copies (episode.offerings: re-uploads, sister-channel copies, provider ids).
 * `previous` is a catalogue or the id state showIdState() made of one.
 */
function previousUnits(previous) {
  const out = new Map();
  if (previous?.version === STATE_VERSION && isRecord(previous.units)) {
    for (const [id, units] of Object.entries(previous.units)) {
      if (!isShowId(id) || !Array.isArray(units)) continue;
      out.set(id, units.filter(Array.isArray).map((ids) => [...new Set(ids.filter((x) => typeof x === 'string' && x))]).filter((ids) => ids.length));
    }
    return out;
  }
  for (const s of Array.isArray(previous?.shows) ? previous.shows : []) {
    if (!isShowId(s?.id)) continue;
    const units = out.get(s.id) || [];
    for (const e of Array.isArray(s.episodes) ? s.episodes : []) {
      const ids = [e?.id, ...(Array.isArray(e?.offerings) ? e.offerings.map((o) => o?.id) : [])].filter((x) => typeof x === 'string' && x);
      if (ids.length) units.push([...new Set(ids)]);
    }
    out.set(s.id, units);
  }
  return out;
}

/** Units per holder: a unit belongs to the holder of the first of its ids that has one. */
function holdings(units, holderOf) {
  const counts = new Map();
  let total = 0;
  for (const ids of units) {
    let h;
    for (const id of ids) { h = holderOf(id); if (h !== undefined) break; }
    if (h === undefined) continue;
    total++;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  return { counts, total };
}

/**
 * Which previous ids the shows being built keep.
 * - groups: the shows being built, in build order; videosOf(group) lists the video ids it holds.
 * - A previous s_ show's id goes to the group holding a strict majority of its surviving episodes (those
 *   found in this build). Several previous ids wanting one group are settled greedily: episodes held,
 *   then the group's own title id (preferredOf), then id. mayReuse(group, id) can refuse a pairing.
 * Returns { reused: Map<group, id>, claim(group, id, taken) }. claim settles the title id of a group that
 * reuses nothing: it keeps it unless taken(id), it is an id another group reuses, or it is a previous
 * show's id whose surviving episodes all sit in other groups (that id is aliased to them instead). Then
 * the group gets s_<hash(keyOf(group) | its smallest video id)>. An old id that is only an alias may come
 * back (buildIdAliases then drops the alias). Without a previous catalogue nothing is reused and claim
 * returns the title id unchanged, so a cold build gives exactly the title-hash ids.
 */
export function assignShowIds(groups, previous, { videosOf = (g) => g.videos, keyOf = (g) => g.key, preferredOf = () => null, mayReuse = () => true } = {}) {
  const prevShows = previousUnits(previous);
  const reused = new Map();
  if (!prevShows.size) return { reused, claim: (group, id) => id };

  const holder = new Map(); // video id → group (the first group listing it)
  const videos = new Map(); // group → its video ids
  for (const g of groups) {
    const list = [...(videosOf(g) || [])];
    videos.set(g, list);
    for (const v of list) if (!holder.has(v)) holder.set(v, g);
  }
  const heldBy = new Map(); // previous id → Map<group, units held> (only ids with surviving episodes)
  const pairs = [];
  for (const [pid, units] of prevShows) {
    const { counts, total } = holdings(units, (v) => holder.get(v));
    if (!total) continue;
    heldBy.set(pid, counts);
    for (const [g, n] of counts) if (n * 2 > total && mayReuse(g, pid)) pairs.push({ pid, g, n, pref: preferredOf(g) === pid });
  }
  pairs.sort((a, b) => b.n - a.n || b.pref - a.pref || (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0));
  const owner = new Map(); // reused previous id → group
  for (const { pid, g } of pairs) {
    if (reused.has(g) || owner.has(pid)) continue;
    reused.set(g, pid);
    owner.set(pid, g);
  }
  const blocked = (id, group) => (owner.has(id) && owner.get(id) !== group) || (heldBy.has(id) && !heldBy.get(id).has(group));
  const claim = (group, id, taken = () => false) => {
    if (!taken(id) && !blocked(id, group)) return id;
    const smallest = [...(videos.get(group) || [])].sort()[0] || '';
    const base = `${keyOf(group)}|${smallest}`;
    for (let i = 0; ; i++) {
      const next = `s_${shortHash(i ? `${base}|${i}` : base)}`;
      if (!taken(next) && !blocked(next, group)) return next;
    }
  };
  return { reused, claim };
}

/**
 * The catalogue's idAliases ({oldId: liveId}): the seed (committed one-off repairs), then the previous
 * catalogue's aliases, then every previous s_ id no longer live, pointing to the live show holding most
 * of its episodes (ties: smaller id). Episode copies count (sister-channel merges and re-uploads list
 * the absorbed show's videos as offerings). Chains are flattened to their live end; keys that are live
 * again and targets that are not live are dropped; keys are sorted, so the map is a stable fingerprint.
 */
export function buildIdAliases(previous, shows, seed = {}) {
  const live = new Set((shows || []).map((s) => s.id));
  const holder = new Map(); // video id → live show id; episodes first, then their copies
  for (const s of shows || []) for (const e of s.episodes || []) if (e?.id && !holder.has(e.id)) holder.set(e.id, s.id);
  for (const s of shows || []) for (const e of s.episodes || []) for (const o of e?.offerings || []) if (o?.id && !holder.has(o.id)) holder.set(o.id, s.id);
  const map = { ...(isRecord(seed) ? seed : {}), ...(isRecord(previous?.idAliases) ? previous.idAliases : {}) };
  for (const [pid, units] of previousUnits(previous)) {
    if (live.has(pid)) continue;
    const { counts } = holdings(units, (v) => holder.get(v));
    let best = null, most = 0;
    for (const [sid, n] of counts) if (n > most || (n === most && sid < best)) { best = sid; most = n; }
    if (best) map[pid] = best;
  }
  const resolve = (id) => {
    const seen = new Set([id]);
    let current = id;
    while (!live.has(current)) {
      const next = Object.hasOwn(map, current) ? map[current] : null;
      if (typeof next !== 'string' || !next || seen.has(next)) return null;
      seen.add(next);
      current = next;
    }
    return current;
  };
  const out = {};
  for (const key of Object.keys(map).sort()) {
    if (live.has(key)) continue;
    const target = resolve(key);
    if (target) out[key] = target;
  }
  return out;
}

/**
 * The video ids the previous catalogue (or its id state) listed as episodes. Of the copies of one work
 * (re-uploads, re-posted parts), the one listed before stays the episode (catalog.js), so a rebuild does
 * not swap the episode's id, date and thumbnail and announce it as a new episode.
 */
export function previousEpisodeIds(previous) {
  const out = new Set();
  for (const units of previousUnits(previous).values()) for (const ids of units) out.add(ids[0]);
  return out;
}

/**
 * The id state of a catalogue, small enough to be kept beside it: the units of each s_ show and the
 * alias map, in a JSON-safe form. buildCatalog takes it as `previous` (only show-ids.js reads that), so
 * a build whose catalogue is missing or unreadable keeps the show ids, aliases and episode copies a
 * build from the catalogue keeps, instead of falling back to title-hash ids with no aliases.
 */
export function showIdState(catalog) {
  const units = {};
  for (const [id, list] of previousUnits(catalog)) units[id] = list;
  return { version: STATE_VERSION, generatedAt: catalog?.generatedAt || null, units, idAliases: isRecord(catalog?.idAliases) ? { ...catalog.idAliases } : {} };
}
