import { classifyUpload } from './classify-upload.js';
// Builds the show catalogue from raw playlist/uploads data + per-video details.
import {
  normalizeArabic, shortHash, parseTitle, isGenericPlaylist, isBranding, cleanDescription,
  synopsisQuality, similarity, relativeToMs, episodeNumberFromTitle, hasArabic, FILM_EPISODE_TITLE, FILM_EPISODE_TITLE_EN,
  alJazeeraPlaylistIsSeries,
} from './text.js';
import { tagShow, allTagDefs } from './tagger.js';

const FUZZY_MERGE = 0.9;

// Description cleaning is regex-heavy; descriptions rarely change, so cache per video.
const cleanCache = new Map();
function cleanedDescription(videoId, description = '') {
  const hit = cleanCache.get(videoId);
  if (hit && hit.len === description.length) return hit.text;
  const text = cleanDescription(description);
  if (cleanCache.size > 50000) cleanCache.clear();
  cleanCache.set(videoId, { len: description.length, text });
  return text;
}

function thumbUrls(videoId) {
  return {
    max: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    sd: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    hq: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    mq: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}

function templatedSynopsis(show) {
  const n = show.episodes.length;
  const channel = show.channel?.short || show.channel?.title || '';
  if (show.lang === 'en') {
    if (show.kind === 'film') return `A ${Math.round(show.episodes[0].durationSec / 60)}-minute documentary from ${channel || 'the channel'}: "${show.title}".`;
    const names = show.episodes.slice(0, 3).map((e) => `"${e.title}"`).join(', ');
    return `${show.title}${channel ? ` from ${channel}` : ''}. ${n} full episode${n === 1 ? '' : 's'}${n ? `, including ${names}` : ''}.`;
  }
  if (show.kind === 'film') return `فيلم وثائقي من ${channel || 'المصدر'} بعنوان «${show.title}»، مدته ${Math.round(show.episodes[0].durationSec / 60)} دقيقة.`;
  const names = show.episodes.slice(0, 3).map((e) => `«${e.title}»`).join('، ');
  const count = n === 1 ? 'حلقة كاملة واحدة' : n === 2 ? 'حلقتان كاملتان' : n <= 10 ? `${n} حلقات كاملة` : `${n} حلقة كاملة`;
  return `${show.title}${channel ? ` من ${channel}` : ''}. يضم هذا العرض ${count}${n ? `، من بينها ${names}` : ''}.`;
}

// Sort episodes, pick synopsis + poster, compute aggregates and tags. Mutates the show.
// `art` is an optional TMDB match ({ poster, backdrop, overview, overviewLang }).
function finalizeShow(show, art) {
  const ov = show._ov || {};
  const synopsisCandidates = show._syn || [];
  delete show._ov; delete show._syn; delete show.rawTitle;
  const episodes = show.episodes;
  if (ov.contentLang) show.contentLang = ov.contentLang;

  episodes.sort((a, b) => {
    const sa = a.season ?? 0, sb = b.season ?? 0;
    if (sa !== sb) return sa - sb;
    if (a.number != null && b.number != null && a.number !== b.number) return a.number - b.number;
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : Infinity;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : Infinity;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title, 'ar');
  });
  show.episodeCount = episodes.length;
  show.kind = episodes.length === 1 && (episodes[0].title === FILM_EPISODE_TITLE || episodes[0].title === FILM_EPISODE_TITLE_EN) ? 'film' : 'series';
  show.altTitles = [...new Set(show.altTitles)].filter((t) => t && t !== show.title);
  show.playlistIds = [...new Set(show.playlistIds)];
  show.seasons = [...new Set(episodes.map((e) => e.season).filter((s) => s != null))].sort((a, b) => a - b);

  // Synopsis: override → best episode description → best promo description → template.
  let synopsis = ov.synopsis || '';
  if (!synopsis) {
    const best = synopsisCandidates.filter((c) => c.q > 0).sort((a, b) => (b.isEpisode - a.isEpisode) * 0 + (b.q - a.q))[0];
    synopsis = best?.text || '';
  }
  show.synopsis = synopsis || null;
  show.synopsisGenerated = false;
  // TMDB overview (in the section's language) beats a templated fallback.
  if (!show.synopsis && art?.overview && art.overviewLang === (show.lang === 'en' ? 'en' : 'ar')) show.synopsis = art.overview;
  if (!show.synopsis) { show.synopsis = templatedSynopsis(show); show.synopsisGenerated = true; }

  // Poster = override → TMDB backdrop (16:9, matches the cards) → most-viewed episode's thumbnail.
  const cover = [...episodes].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
  show.posterVideoId = cover.id;
  // Only non-YouTube items (ids that are not 11-char video ids) carry their own absolute poster URL;
  // YouTube listing thumbnails are signed and expire, so YouTube shows always use the plain CDN set.
  const isYouTube = /^[\w-]{11}$/.test(cover.id);
  const customCover = !isYouTube ? (cover.thumbs?.custom || (cover.thumb?.startsWith('http') ? cover.thumb : null)) : null;
  show.poster = ov.poster ? { custom: ov.poster } : art?.backdrop ? { custom: art.backdrop, ...(isYouTube ? thumbUrls(cover.id) : {}) } : customCover ? { custom: customCover } : thumbUrls(cover.id);
  show.portrait = ov.portrait || art?.poster || customCover || null; // 2:3 poster for the show page
  if (art?.tmdbId) show.tmdbId = art.tmdbId;
  show.latestAt = episodes.reduce((m, e) => (e.publishedAt && (!m || e.publishedAt > m) ? e.publishedAt : m), null);
  show.firstAt = episodes.reduce((m, e) => (e.publishedAt && (!m || e.publishedAt < m) ? e.publishedAt : m), null);
  show.totalViews = episodes.reduce((a, e) => a + (e.views || 0), 0);
  show.totalDurationSec = episodes.reduce((a, e) => a + e.durationSec, 0);

  const classifications = episodes.map(e => e.classification).filter(Boolean);
  if (classifications.length) {
    show.classification = classifications.find(c => c.status === 'uncertain') || classifications[0];
    show.documentary = show.classification.status === 'documentary';
    if (!show.documentary && show.synopsisGenerated) show.synopsis = show.lang === 'en'
      ? `An upload from ${show.channel?.short || show.channel?.title || 'the channel'}: "${show.title}".`
      : `فيديو من ${show.channel?.short || show.channel?.title || 'المصدر'} بعنوان «${show.title}».`;
  }
  const tagged = tagShow(show);
  const extraTags = (show._extraTags || []).filter(Boolean);
  show.tags = ov.tags?.length ? ov.tags : [...new Set([...tagged.tags, ...extraTags])];
  show.primaryTag = ov.tags?.length ? ov.tags[0] : (tagged.primaryTag || show.tags[0]);
  delete show._extraTags;
  // Content in another language than its section (e.g. French shows in the English section) gets a language tag.
  if (show.contentLang && show.contentLang !== show.lang) show.tags = [...show.tags.filter((t) => !t.startsWith('lang-')), `lang-${show.contentLang}`];
  return show;
}

const LANG_TAGS = {
  fr: { label: 'بالفرنسية', labelEn: 'In French', color: '#6c8cff' },
  en: { label: 'بالإنجليزية', labelEn: 'In English', color: '#6c8cff' },
  ar: { label: 'بالعربية', labelEn: 'In Arabic', color: '#6c8cff' },
  de: { label: 'بالألمانية', labelEn: 'In German', color: '#6c8cff' },
  es: { label: 'بالإسبانية', labelEn: 'In Spanish', color: '#6c8cff' },
};

/**
 * @param {object} args
 * @param {Record<string, object>} args.playlists raw playlists (and UPLOADS:* pseudo-playlists) keyed by id
 * @param {Record<string, object>} args.details per-video details keyed by video id
 * @param {Record<string, string>} args.seen video id → first-seen ISO date
 * @param {object} args.overrides
 * @param {object[]} args.sources
 */
export function buildCatalog({ playlists, details, seen, overrides, sources, artwork = {} }) {
  const minSec = overrides?.minEpisodeSeconds ?? 420;
  const aliasMap = new Map(Object.entries(overrides?.aliases || {}).map(([a, b]) => [normalizeArabic(a), normalizeArabic(b)]));
  const aliasDisplay = new Map(Object.values(overrides?.aliases || {}).map((b) => [normalizeArabic(b), b]));
  const now = Date.now();
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const channelInfo = (src) => src ? { id: src.id, title: src.title, short: src.short || src.title, lang: src.lang || 'ar', contentLang: src.contentLang || src.lang || 'ar', profile: src.profile || 'generic', url: src.url } : null;

  // 1) Candidates: every video of every playlist, parsed with its channel profile.
  //    A video can sit in several playlists; keep ONE candidate per video, preferring a dedicated
  //    show playlist over generic collections / the uploads tab.
  const byVideo = new Map();
  let scanned = 0;
  for (const pl of Object.values(playlists)) {
    if (!pl || pl.error) continue;
    const src = sourceById.get(pl.sourceId) || sources[0];
    if (!src) continue;
    const profile = src.profile || 'generic';
    const lang = src.lang || 'ar';
    let generic = pl.isUploads || isGenericPlaylist(pl.title) || profile === 'creator' || src.playlistsGeneric === true
      || (lang === 'en' && /\b(shorts|trailers?|clips?|best of|top \d+|compilation|playlist of the week|most (watched|popular|streamed)|interviews?)\b/i.test(pl.title));
    let playlistSeries;
    if (!generic && profile === 'aljazeera') {
      // Topic collections ("المغرب", "سيرة ذاتية") are not series: only playlists whose videos
      // reference the playlist name (or carry episode numbers) group their videos.
      playlistSeries = alJazeeraPlaylistIsSeries(pl.title, (pl.videos || []).map((v) => v.title));
      if (!playlistSeries) generic = true;
    }
    const ctx = { profile, lang, brands: src.brands || [src.title, src.short].filter(Boolean), playlistTitle: generic ? null : pl.title, playlistGeneric: generic, playlistSize: (pl.videos || []).length, playlistSeries };
    for (const v of pl.videos || []) {
      scanned++;
      const parsed = (v.parsed && v.parsed.showTitle) ? v.parsed : parseTitle(v.title, ctx);
      const showName = v.showTitle || parsed.showTitle || (generic ? null : pl.title) || parsed.episodeTitle;
      let key = normalizeArabic(showName);
      if (aliasMap.has(key)) key = aliasMap.get(key);
      const cand = { v, parsed, showName, key, pl, generic, src, playlistIds: new Set([pl.id]) };
      const prev = byVideo.get(v.id);
      if (!prev) byVideo.set(v.id, cand);
      else {
        prev.playlistIds.add(pl.id);
        if (prev.generic && !generic) { cand.playlistIds = prev.playlistIds; byVideo.set(v.id, cand); }
      }
    }
  }
  const candidates = [...byVideo.values()];

  // 1b) Prefix clustering (DW, Al Jazeera): standalone films whose titles share a prefix such as
  //     "صراع البوارج.. X" / "حكاية أغنية - X" at least 3 times in the same channel are a series.
  const prefixOf = (title) => {
    const m = title.match(/^(.{3,}?)\s*(?:\.\.+|\s[-–—]+\s|[:：]\s)\s*(.{2,})$/);
    if (!m) return null;
    const pre = m[1].trim();
    if (normalizeArabic(pre).split(' ').length < 2 && !/\.\./.test(title)) return null; // one-word dash/colon prefixes are too ambiguous
    return { pre, rest: m[2].trim() };
  };
  const prefixCounts = new Map();
  for (const c of candidates) {
    if (c.parsed.kind !== 'film' || !['dw', 'aljazeera'].includes(c.src.profile)) continue;
    const p = prefixOf(c.showName);
    if (!p) continue;
    const k = `${c.src.id}|${normalizeArabic(p.pre)}`;
    prefixCounts.set(k, (prefixCounts.get(k) || 0) + 1);
  }
  for (const c of candidates) {
    if (c.parsed.kind !== 'film' || !['dw', 'aljazeera'].includes(c.src.profile)) continue;
    const p = prefixOf(c.showName);
    if (!p) continue;
    const k = `${c.src.id}|${normalizeArabic(p.pre)}`;
    if ((prefixCounts.get(k) || 0) < 3) continue;
    c.showName = p.pre;
    c.key = aliasMap.get(normalizeArabic(p.pre)) || normalizeArabic(p.pre);
    c.parsed = { ...c.parsed, showTitle: p.pre, episodeTitle: p.rest, kind: 'series', number: c.parsed.number ?? episodeNumberFromTitle(p.rest) };
  }

  // 2) Group by canonical key within each channel (exact, then fuzzy). Deterministic order → stable ids.
  const scoped = (c) => `${c.src.id}|${c.key}`;
  const keysByChannel = new Map();
  for (const c of candidates) {
    if (!c.key) continue;
    if (!keysByChannel.has(c.src.id)) keysByChannel.set(c.src.id, new Set());
    keysByChannel.get(c.src.id).add(c.key);
  }
  const canonical = new Map(); // scopedKey → canonical scopedKey
  for (const [chId, keys] of keysByChannel) {
    // Near-identical keys (Dice ≥ 0.9) share their first word, so compare within first-word buckets
    // only; this keeps the pass linear-ish for channels with thousands of film titles.
    const buckets = new Map();
    for (const k of [...keys].sort()) {
      const b = k.split(' ')[0];
      if (!buckets.has(b)) buckets.set(b, []);
      const canonicalKeys = buckets.get(b);
      let target = null;
      for (const ck of canonicalKeys) if (Math.abs(ck.length - k.length) <= 6 && similarity(k, ck) >= FUZZY_MERGE) { target = ck; break; }
      if (!target) { canonicalKeys.push(k); target = k; }
      canonical.set(`${chId}|${k}`, `${chId}|${target}`);
    }
  }

  const showsByKey = new Map();
  for (const c of candidates) {
    const sk = canonical.get(scoped(c)) || scoped(c);
    if (!c.key) continue;
    let show = showsByKey.get(sk);
    if (!show) {
      show = { scopedKey: sk, key: sk.slice(sk.indexOf('|') + 1), src: c.src, names: new Map(), playlistTitles: new Map(), playlistIds: new Set(), videos: new Map() };
      showsByKey.set(sk, show);
    }
    show.names.set(c.showName, (show.names.get(c.showName) || 0) + 1);
    if (!c.generic) {
      show.playlistTitles.set(c.pl.title, (show.playlistTitles.get(c.pl.title) || 0) + 1);
      show.playlistIds.add(c.pl.id);
    }
    show.videos.set(c.v.id, c);
  }

  // 3) Materialize shows and episodes.
  const shows = [];
  const usedIds = new Map(); // id → scopedKey (collision guard across channels)
  const sourceIndex = new Map(sources.map((s, i) => [s.id, i]));
  const ordered = [...showsByKey.values()].sort((a, b) => (sourceIndex.get(a.src.id) - sourceIndex.get(b.src.id)) || a.key.localeCompare(b.key));
  for (const s of ordered) {
    const rank = (entries) => [...entries].sort((a, b) => (hasArabic(b[0]) - hasArabic(a[0])) || (b[1] - a[1]))[0]?.[0];
    const titleFromPlaylist = rank(s.playlistTitles.entries());
    const titleFromNames = rank(s.names.entries());
    const title = aliasDisplay.get(s.key)
      || (titleFromPlaylist && normalizeArabic(titleFromPlaylist) === s.key ? titleFromPlaylist : null)
      || titleFromNames || titleFromPlaylist;
    const altTitles = [...new Set([...s.names.keys(), ...s.playlistTitles.keys()])].filter((t) => t !== title);
    let id = `s_${shortHash(s.key)}`;
    if (usedIds.has(id) && usedIds.get(id) !== s.scopedKey) id = `s_${shortHash(s.scopedKey)}`;
    usedIds.set(id, s.scopedKey);
    const ov = overrides?.shows?.[id] || overrides?.shows?.[title] || {};
    if (ov.hidden) continue;

    const episodes = [];
    const promos = [];
    const synopsisCandidates = [];
    for (const c of s.videos.values()) {
      const d = details[c.v.id];
      const durationSec = d?.durationSec || c.v.durationSec || 0;
      if (d?.isPrivate) continue;
      const cleaned = d ? cleanedDescription(c.v.id, d.description) : '';
      const q = cleaned ? synopsisQuality(cleaned, title, s.src.lang || 'ar') : 0;
      if (durationSec < minSec) {
        if (cleaned) synopsisCandidates.push({ text: cleaned, q, isEpisode: false });
        promos.push(c.v.id); continue;
      }
      // Classify only uploads that have no real playlist membership. The next refresh
      // automatically restores playlist treatment when the channel files the video.
      const uploadsOnly = c.parsed.kind === 'film' && c.pl.isUploads && [...c.playlistIds].every(pid => playlists[pid]?.isUploads);
      const classification = uploadsOnly ? classifyUpload(c.v, d || {}, c.src, overrides) : null;
      if (classification?.status === 'non-documentary') continue;
      if (cleaned) synopsisCandidates.push({ text: cleaned, q, isEpisode: true });
      let publishedAt = d?.publishedAt ? new Date(d.publishedAt).toISOString() : null;
      let approx = false;
      if (!publishedAt && c.v.relative) {
        const ago = relativeToMs(c.v.relative);
        if (ago != null) { publishedAt = new Date(now - ago).toISOString(); approx = true; }
      }
      let epTitle = c.parsed.episodeTitle || c.v.title;
      const nEp = normalizeArabic(epTitle);
      if (c.parsed.kind !== 'film' && (nEp === s.key || nEp === normalizeArabic(title))) epTitle = s.src.lang === 'en' ? 'Full episode' : 'الحلقة الكاملة';
      episodes.push({
        id: c.v.id,
        ...(classification ? { classification } : {}),
        showId: id,
        title: epTitle,
        fullTitle: c.v.title,
        number: c.parsed.number ?? episodeNumberFromTitle(epTitle),
        season: c.parsed.season ?? null,
        label: c.parsed.label ?? null,
        durationSec,
        views: d?.viewCount || null,
        viewsText: c.v.views || null,
        publishedAt,
        publishedApprox: approx,
        addedAt: seen[c.v.id] || null,
        synopsis: q > 0 ? cleaned : '',
        thumbs: /^[\w-]{11}$/.test(c.v.id) ? thumbUrls(c.v.id) : (c.v.thumb?.startsWith('http') ? { custom: c.v.thumb } : thumbUrls(c.v.id)),
        sourceUrl: d?.sourceUrl || c.v.sourceUrl || null,
        embedUrl: d?.embedUrl || c.v.embedUrl || null,
        playlistIds: [...c.playlistIds],
      });
    }
    if (!episodes.length) continue;
    const extraTags = [...new Set(Array.from(s.videos.values()).flatMap((cand) => cand.v.tags || []))];
    shows.push({
      id, key: s.key, title: ov.title || title, rawTitle: title, altTitles, episodes, promos,
      channel: channelInfo(s.src), lang: s.src.lang || 'ar', contentLang: s.src.contentLang || s.src.lang || 'ar', profile: s.src.profile || 'generic',
      playlistIds: [...s.playlistIds], _ov: ov, _syn: synopsisCandidates, _extraTags: extraTags,
    });
  }

  // 3b) Nat Geo / generic only: fold "Show: Episode" single-video entries into the parent show and
  //     re-file pipe-less "KnownShow: Episode" videos that sat in another show's playlist.
  const byKey = new Map(shows.map((s) => [`${s.channel.id}|${s.key}`, s]));
  const lookup = (show, name) => byKey.get(`${show.channel.id}|${normalizeArabic(name)}`);
  for (const sub of [...shows]) {
    if (!['natgeo', 'generic'].includes(sub.profile)) continue;
    if (sub.episodes.length !== 1 || sub.episodes[0].title !== 'الحلقة الكاملة') continue;
    const m = sub.rawTitle.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const base = lookup(sub, m[1]);
    if (!base || base === sub) continue;
    const ep = sub.episodes[0];
    ep.title = m[2].trim();
    ep.showId = base.id;
    ep.number = episodeNumberFromTitle(ep.title);
    base.episodes.push(ep);
    base.promos.push(...sub.promos);
    base.playlistIds.push(...sub.playlistIds);
    base.altTitles.push(sub.title);
    base._syn.push(...sub._syn);
    shows.splice(shows.indexOf(sub), 1);
    byKey.delete(`${sub.channel.id}|${sub.key}`);
  }
  for (const show of shows) {
    if (!['natgeo', 'generic'].includes(show.profile)) continue;
    for (const ep of [...show.episodes]) {
      const segs = ep.fullTitle.replace(/\s+/g, ' ').split(/\s*\|\s*/).map((p) => p.trim()).filter((p) => p && !isBranding(p));
      if (segs.length !== 1) continue;
      const raw = segs[0];
      const m = raw.match(/^(.+?)\s*[:：]\s*(.+)$/);
      let target = null, newTitle = null;
      if (m && lookup(show, m[1])) { target = lookup(show, m[1]); newTitle = m[2].trim(); }
      else if (lookup(show, raw)) { target = lookup(show, raw); newTitle = 'الحلقة الكاملة'; }
      if (!target || target === show) continue;
      ep.title = newTitle;
      ep.showId = target.id;
      ep.number = episodeNumberFromTitle(newTitle);
      target.episodes.push(ep);
      show.episodes.splice(show.episodes.indexOf(ep), 1);
    }
  }
  for (const show of [...shows]) if (!show.episodes.length) { shows.splice(shows.indexOf(show), 1); }

  for (const show of shows) finalizeShow(show, artwork[show.id]);

  shows.sort((a, b) => (b.latestAt || '').localeCompare(a.latestAt || '') || a.title.localeCompare(b.title, 'ar'));

  const tagCounts = new Map();
  for (const s of shows) for (const t of s.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tagCountsByLang = { ar: new Map(), en: new Map() };
  for (const s of shows) for (const t of s.tags) { const m = tagCountsByLang[s.lang === 'en' ? 'en' : 'ar']; m.set(t, (m.get(t) || 0) + 1); }
  const langTagDefs = Object.entries(LANG_TAGS).map(([code, d]) => ({ id: `lang-${code}`, ...d }));
  const tags = [...allTagDefs(), ...langTagDefs]
    .map((t) => ({ id: t.id, label: t.label, labelEn: t.labelEn || t.label, color: t.color, count: tagCounts.get(t.id) || 0, countAr: tagCountsByLang.ar.get(t.id) || 0, countEn: tagCountsByLang.en.get(t.id) || 0 }))
    .filter((t) => t.count > 0);

  const channels = sources.filter((s) => s.type === 'channel' || true).map((s) => {
    const mine = shows.filter((x) => x.channel.id === s.id);
    return {
      id: s.id, title: s.title, short: s.short || s.title, url: s.url, lang: s.lang || 'ar', profile: s.profile || 'generic',
      shows: mine.length, series: mine.filter((x) => x.kind === 'series').length, films: mine.filter((x) => x.kind === 'film').length,
      episodes: mine.reduce((a, x) => a + x.episodeCount, 0),
      latestAt: mine.reduce((m, x) => (x.latestAt && (!m || x.latestAt > m) ? x.latestAt : m), null),
    };
  }).filter((c) => c.shows > 0);

  return {
    generatedAt: new Date().toISOString(),
    minEpisodeSeconds: minSec,
    sources: sources.map((s) => ({ type: s.type, id: s.id, title: s.title, short: s.short, url: s.url, lang: s.lang, profile: s.profile })),
    channels,
    langs: [...new Set(shows.map((s) => s.lang))],
    stats: {
      shows: shows.length,
      series: shows.filter((s) => s.kind === 'series').length,
      films: shows.filter((s) => s.kind === 'film').length,
      episodes: shows.reduce((a, s) => a + s.episodeCount, 0),
      channels: channels.length,
      playlists: Object.values(playlists).filter((p) => !p.isUploads).length,
      videosScanned: scanned,
      totalHours: Math.round(shows.reduce((a, s) => a + s.totalDurationSec, 0) / 3600),
    },
    tags,
    shows,
  };
}

/** Compare two catalogues and describe what is new. */
export function diffCatalog(prev, next) {
  if (!prev) return { newShows: [], newEpisodes: [], initial: true };
  const prevEp = new Set(prev.shows.flatMap((s) => s.episodes.map((e) => e.id)));
  const prevShows = new Set(prev.shows.map((s) => s.id));
  const newShows = next.shows.filter((s) => !prevShows.has(s.id)).map((s) => ({ id: s.id, title: s.title }));
  const newEpisodes = [];
  for (const s of next.shows) for (const e of s.episodes) if (!prevEp.has(e.id)) newEpisodes.push({ id: e.id, title: e.title, showId: s.id, showTitle: s.title, channel: s.channel?.short });
  return { newShows, newEpisodes, initial: false };
}
