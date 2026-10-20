import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compilePatterns, playlistWanted, uploadWanted, rowWanted, playlistSeason, hasPlaylistFilter, hasUploadFilter, isShortsPlaylist, takesUploads } from '../src/source-filters.js';
import { buildCatalog } from '../src/catalog.js';

const sources = JSON.parse(fs.readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8')).sources;
const byId = new Map(sources.map((s) => [s.id, s]));
const PATTERN_KEYS = ['playlistsInclude', 'playlistsExclude', 'uploadsInclude', 'uploadsExclude'];

// ---- the real sources.json ----------------------------------------------------------------------

test('every title filter in sources.json compiles as a case-insensitive Unicode regex', () => {
  for (const src of sources) {
    for (const key of PATTERN_KEYS) {
      if (src[key] == null) continue;
      assert.ok(Array.isArray(src[key]) && src[key].every((p) => typeof p === 'string' && p.trim()), `${src.title} ${key}`);
      for (const p of src[key]) assert.doesNotThrow(() => new RegExp(p, 'iu'), `${src.title} ${key} ${p}`);
    }
    for (const [id, season] of Object.entries(src.playlistSeasons || {})) {
      assert.ok(/^PL[\w-]+$/.test(id) && Number.isInteger(season) && season > 0, `${src.title} playlistSeasons ${id}`);
    }
  }
});

// Patterns are JSON strings, so a regex backslash is doubled in the file. A script that writes them
// from JS string literals ('\s', '\W', '\+', '\|' are not JS escapes) silently drops the backslash
// and still compiles: '^AJ+ كبريت$' then misses the literal title, 's*' needs letters. These titles
// are real (listed 2026-10-19/20) and pin what each filter is for.
test('AJ+ كبريت: the catch-all, shorts, series and السليط playlists and السليط uploads are left out', (t) => {
  const aj = byId.get('UC-4KnPMmZzwAzW7SbVATUZQ');
  if (!aj) return t.skip('AJ+ كبريت is not configured');
  for (const title of ['AJ+ كبريت', 'aj+ كبريت', '#shorts السليط', 'المدوان #shorts', 'السليط الإخباري 2024', '"السليط الإخباري "الموسم الخامس', 'مسلسل هُم']) {
    assert.equal(playlistWanted(aj, { id: 'PLx', title }), false, title);
  }
  for (const title of ['الدحيح', 'الجهبذ', 'المدوان', '+ المُخبر الاقتصادي', 'هتلر والحرب العالمية الثانية', 'برنامج معنا معنى']) {
    assert.equal(playlistWanted(aj, { id: 'PLx', title }), true, title);
  }
  for (const title of ['السليط الإخباري 2026 | هل ضاع', '«السليط الإخباري» | حلقة', '🔴 السليط الإخباري 2026 | هل ضاع', '  "السليط" الموسم الثامن']) {
    assert.equal(uploadWanted(aj, { id: 'x', title }), false, title);
  }
  for (const title of ['كيف بنيت الأهرامات؟ | الدحيح', 'AJ+ كبريت | قصة السليط']) assert.equal(uploadWanted(aj, { id: 'x', title }), true, title);
  // The drama "مسلسل هُم" (its playlist is left out by "مسلسل") is left out as uploads too; programmes
  // about series are not.
  for (const title of ['مسلسل هُم | الحلقة الأولى - محبس', 'مسلسل هم - الحلقة السادسة - البداية']) assert.equal(uploadWanted(aj, { id: 'x', title }), false, title);
  for (const title of ['مسلسل ذا سمبسون أطول مسلسل هزلي أمريكي', 'الجهبذ | ما حقيقة أحداث مسلسل تاج وهل تسبب بإحراج للنظام؟', 'هل تغيرت المسلسلات السورية الرمضانية بعد سقوط الأسد؟']) {
    assert.equal(uploadWanted(aj, { id: 'x', title }), true, title);
  }
  // Uploads in no programme playlist whose titles name no programme: an السليط الإخباري episode
  // (SV9yWokx6Y4, 832 s; its description says "السليط الإخباري 2026 | العرب في المونديال") and a
  // recorded stand-up set (PINmzQbmt4o, 1443 s). Programmes about the World Cup stay.
  for (const title of ['عرب المونديال', 'عرب المونديال!', 'الجلسة الكوميدية الأولى ضمن مهرجان الدوحة للكوميديا', 'الجلسة الكوميدية الثانية']) {
    assert.equal(uploadWanted(aj, { id: 'x', title }), false, title);
  }
  assert.equal(uploadWanted(aj, { id: 'SV9yWokx6Y4', title: 'Arabs of the World Cup' }, { SV9yWokx6Y4: { title: 'عرب المونديال' } }), false, 'by its details title');
  for (const title of ['المُخبر الاقتصادي+ | هل تُفجر حرب إيران كأس العالم 2026 في أمريكا؟', 'غاليريتا | شاكيرا و"واكا واكا".. الوجه الخفي لأغاني المونديال', 'الجهبذ | عرب المونديال: من شارك أولاً؟']) {
    assert.equal(uploadWanted(aj, { id: 'x', title }), true, title);
  }
});

test('the six documentary-film channels mark their uploads as documentaries (classify-upload.js)', (t) => {
  const ids = ['UCZrs1_RojgqE0zKN9evvfJw', 'UCUETY-zVLykpUQlVweNaLsg', 'UCKo9YhpBHN7FzOSFleKZvLg', 'UCSNjn6j2NvWYSSB7xrAJaXg', 'UCcxFARHBsl_Ufy0WwnekavA', 'UC4tNC0SDwlGrx1SpTz-gJGA'];
  const configured = ids.filter((id) => byId.has(id));
  if (!configured.length) return t.skip('the documentary-film channels are not configured');
  for (const id of configured) assert.equal(byId.get(id).documentaryUploads, true, byId.get(id).title);
  for (const id of ['UC-4KnPMmZzwAzW7SbVATUZQ', 'UCtJmfVv0a52Bu7BnJJtZXKw', 'UC4CqD-RfKw-eE8xSFByMIHw']) assert.notEqual(byId.get(id)?.documentaryUploads, true, id);
});

test('Shorts lists are never wanted, for any channel; documentaries with "Short" in their name are', () => {
  // Real playlist titles (production snapshot and the channels added 2026-10-19).
  const shorts = ['Shorts | DW Documentary', '#Shorts  | وثائقية دي دبليو', 'Shorts: The Choice 2024', 'VICE News Shorts', 'Economics Explained | Shorts | Curiosity Stream',
    'المدوان #shorts', '#shorts الجهبذ', 'المُخبر الاقتصادي+ #shorts', 'الدحيح | Shorts', 'Short | روح', 'مغامرات أسيل | shorts', 'شورتس الدحيح', 'Documentary Shorts #shorts'];
  // FRONTLINE's "Documentary Shorts" lists short films of 4 to 34 minutes (gen 37), most of them episodes.
  const kept = ['Short Film Showcase | National Geographic', 'Short Docs & Reports | DW Documentary', 'FRONTLINE Short Docs', 'The Short List', 'يوتيوب شورت', 'الدحيح', 'Shortcut to Mars',
    'Documentary Shorts', 'Film Shorts | Curiosity Stream'];
  for (const title of shorts) assert.equal(isShortsPlaylist(title), true, title);
  for (const title of kept) assert.equal(isShortsPlaylist(title), false, title);
  // Whatever the source's filters say (none, or an include list the title matches).
  const plain = { type: 'channel', id: 'UCplain', title: 'Plain' };
  const including = { type: 'channel', id: 'UCinc', title: 'Inc', playlistsInclude: ['الدحيح'] };
  assert.equal(playlistWanted(plain, { id: 'PLs', title: 'Shorts | DW Documentary' }), false);
  assert.equal(playlistWanted(including, { id: 'PLs', title: 'الدحيح | Shorts' }), false);
  assert.equal(playlistWanted(plain, { id: 'PLf', title: 'Short Film Showcase | National Geographic' }), true);
  // The uploads tab, a playlist source and the rows of a Shorts list (rowWanted).
  assert.equal(playlistWanted(plain, { id: 'UPLOADS:UCplain', title: 'Shorts', isUploads: true }), true);
  assert.equal(playlistWanted({ ...plain, type: 'playlist' }, 'Shorts'), true);
  assert.equal(rowWanted(plain, { id: 'PLs', title: 'المدوان #shorts' }, { id: 'v', title: 'مقطع' }), false);
});

test('New Media Academy Life: only the Daheeh seasons, روح and كوانتوبيديا are taken', (t) => {
  const nm = byId.get('UCtJmfVv0a52Bu7BnJJtZXKw');
  if (!nm) return t.skip('New Media Academy Life is not configured');
  const seasons = ['الأول', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن'].map((n) => `الدحيح - الموسم ${n} - الحلقات الكاملة`);
  for (const title of [...seasons, 'الدحيح-الموسم الثاني', 'برنامج روح', 'كوانتوبيديا']) assert.equal(playlistWanted(nm, { id: 'PLx', title }), true, title);
  for (const title of ['الدحيح | Shorts', 'كوانتوبيديا | Shorts', 'Short | روح', 'برنامج كفو', 'مش دكتور', 'لكل إنسان قصة', 'الدحيحs-sالموسم']) {
    assert.equal(playlistWanted(nm, { id: 'PLx', title }), false, title);
  }
  for (const title of ['المدينة التي صنعت المستحيل | روح', 'الثقوب السوداء | الدحيح', 'كوانتوبيديا | الحلقة 3', 'الدحيح']) assert.equal(uploadWanted(nm, { id: 'x', title }), true, title);
  for (const title of ['هل تؤمن بالروح؟ | مش دكتور', 'جروح الحرب | لكل إنسان قصة', 'مشروع الروح | كفو', 'روحاني | كفو']) assert.equal(uploadWanted(nm, { id: 'x', title }), false, title);
});

test('Museum of The Future: only its الدحيح playlist, whose episodes are season 2', (t) => {
  const motf = byId.get('UC4CqD-RfKw-eE8xSFByMIHw');
  if (!motf) return t.skip('Museum of The Future is not configured');
  assert.equal(playlistWanted(motf, { id: 'PL0ePmFx_GS-I6LJcY13e1UNdD1TJgaJvU', title: 'الدحيح' }), true);
  for (const title of ['Future Talks', 'الدحيح | Shorts', 'Docuseries: What Does The Future Hold? - Season 2 سلسلة وثائقية: ماذا يحمل لنا المستقبل؟ - الموسم الثاني']) {
    assert.equal(playlistWanted(motf, { id: 'PLx', title }), false, title);
  }
  assert.equal(playlistSeason(motf, 'PL0ePmFx_GS-I6LJcY13e1UNdD1TJgaJvU'), 2);
  assert.equal(hasUploadFilter(motf), false);
  // Playlists only (scanUploads: false): none of its uploads is wanted, Daheeh or not (the RSS poll
  // leaves the channel alone), and an uploads record stored for it is left out.
  assert.equal(takesUploads(motf), false);
  for (const title of ['متحف المستقبل | حوارات المستقبل: كيف ستبدو المدن في 2071؟', 'الدحيح | المدينة التي صنعت المستحيل']) {
    assert.equal(uploadWanted(motf, { id: 'x', title }), false, title);
    assert.equal(rowWanted(motf, { id: `UPLOADS:${motf.id}`, isUploads: true }, { id: 'x', title }), false, title);
  }
  assert.equal(playlistWanted(motf, { id: `UPLOADS:${motf.id}`, title: '__uploads__', isUploads: true }), false);
  assert.equal(rowWanted(motf, { id: 'PL0ePmFx_GS-I6LJcY13e1UNdD1TJgaJvU', title: 'الدحيح' }, { id: 'x', title: 'المدينة' }), true);
});

test('every other channel of sources.json takes its uploads', () => {
  const playlistOnly = sources.filter((s) => s.type === 'channel' && !takesUploads(s)).map((s) => s.title);
  assert.ok(playlistOnly.every((title) => /Museum of The Future/.test(title)), playlistOnly.join(', '));
});

// ---- semantics ----------------------------------------------------------------------------------

test('include and exclude lists: exclude wins, include is required only when given', () => {
  const src = { type: 'channel', id: 'UCa', title: 'A', playlistsInclude: ['^Keep'], playlistsExclude: ['shorts'], uploadsExclude: ['^\\W*promo'] };
  assert.equal(playlistWanted(src, 'Keep this'), true);
  assert.equal(playlistWanted(src, { title: 'keep THIS' }), true, 'case-insensitive');
  assert.equal(playlistWanted(src, 'Keep | Shorts'), false);
  assert.equal(playlistWanted(src, 'Other'), false);
  assert.equal(playlistWanted({ ...src, playlistsInclude: [] }, 'Other'), true);
  // The uploads tab and the Myflixer pseudo-playlist are never filtered by playlist patterns, nor are playlist sources.
  for (const pl of [{ id: 'UPLOADS:UCa', title: '__uploads__', isUploads: true }, { id: 'UPLOADS:UCa', title: 'Other' }, { id: 'MYFLIXER:x', title: 'Other' }]) assert.equal(playlistWanted(src, pl), true, pl.id);
  assert.equal(playlistWanted({ ...src, type: 'playlist' }, 'Other'), true);
  assert.equal(playlistWanted(null, 'Other'), true);
  // Uploads: the listing title and the details title both count, against the uploads patterns only.
  assert.equal(uploadWanted(src, { id: 'v1', title: 'Other' }), true);
  assert.equal(uploadWanted(src, { id: 'v1', title: '** Promo: new season' }), false);
  assert.equal(uploadWanted(src, { id: 'v1', title: 'Localised title' }, { v1: { title: 'PROMO for the film' } }), false);
  assert.equal(uploadWanted({ type: 'channel', id: 'UCb', uploadsInclude: ['film'] }, { id: 'v2', title: 'Clip' }, { v2: { title: 'The film' } }), true);
  // rowWanted: an uploads row by its own title, any other playlist's row by the playlist's.
  assert.equal(rowWanted(src, { id: 'UPLOADS:UCa', isUploads: true }, { id: 'v1', title: 'promo' }), false);
  assert.equal(rowWanted(src, { id: 'PLk', title: 'Keep' }, { id: 'v1', title: 'promo' }), true);
  assert.equal(rowWanted(src, { id: 'PLo', title: 'Other' }, { id: 'v1', title: 'Film' }), false);
  assert.equal(hasPlaylistFilter(src), true);
  assert.equal(hasPlaylistFilter({ type: 'channel' }), false);
});

test('scanUploads: false takes a channel through its playlists only (takesUploads)', () => {
  const po = { type: 'channel', id: 'UCpo', title: 'PO', scanUploads: false, playlistsInclude: ['^Keep$'] };
  assert.equal(takesUploads(po), false);
  assert.equal(takesUploads({ ...po, scanUploads: true }), true);
  assert.equal(takesUploads({ type: 'channel', id: 'UCx' }), true, 'a channel takes its uploads unless told otherwise');
  // Not a channel's uploads: Myflixer (normalised with scanUploads: false), playlist sources, no source.
  for (const src of [{ type: 'myflixer', id: 'myflixer', scanUploads: false }, { type: 'playlist', id: 'PLx', scanUploads: false }, null]) assert.equal(takesUploads(src), true, src?.type);
  assert.equal(uploadWanted({ type: 'myflixer', id: 'myflixer', scanUploads: false }, { id: 'v', title: 'Film' }), true);
  assert.equal(playlistWanted({ type: 'myflixer', id: 'myflixer', scanUploads: false }, { id: 'MYFLIXER:myflixer', title: 'Myflixer' }), true);
  for (const pl of [{ id: 'UPLOADS:UCpo', title: '__uploads__', isUploads: true }, { id: 'UPLOADS:UCpo', title: 'Keep' }]) assert.equal(playlistWanted(po, pl), false, pl.title);
  assert.equal(playlistWanted(po, { id: 'PLk', title: 'Keep' }), true);
  assert.equal(uploadWanted(po, { id: 'v', title: 'Keep' }), false);
  assert.equal(rowWanted(po, { id: 'UPLOADS:UCpo', isUploads: true }, { id: 'v', title: 'Keep' }), false);
  assert.equal(rowWanted(po, { id: 'PLk', title: 'Keep' }, { id: 'v', title: 'Anything' }), true);
  // The catalogue: the playlist's episodes, nothing from an uploads record stored for the channel.
  const src = { ...po, lang: 'ar', profile: 'ar-show', brands: ['PO'] };
  const id = (s) => s.padEnd(11, '_').slice(0, 11);
  const playlists = {
    PLk: { id: 'PLk', sourceId: src.id, title: 'Keep', videos: [{ id: id('episode1'), title: 'الحلقة الأولى | الدحيح' }] },
    up: { id: `UPLOADS:${src.id}`, sourceId: src.id, isUploads: true, title: '__uploads__', videos: [{ id: id('talk1'), title: 'حوارات المستقبل: كيف ستبدو المدن في 2071؟' }, { id: id('episode1'), title: 'الحلقة الأولى | الدحيح' }] },
  };
  const details = Object.fromEntries(['episode1', 'talk1'].map((k) => [id(k), { durationSec: 2400 }]));
  const episodes = (s) => buildCatalog({ sources: [s], playlists, details, seen: {}, overrides: {} }).shows.flatMap((sh) => sh.episodes.map((e) => e.id)).sort();
  assert.deepEqual(episodes(src), [id('episode1')]);
  assert.deepEqual(episodes({ ...src, scanUploads: true }), [id('episode1'), id('talk1')].sort(), 'the same record of a channel that takes its uploads');
});

test('a pattern that does not compile is reported once and ignored', (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...a) => warnings.push(a.join(' ')));
  const list = ['(', 'ok'];
  assert.equal(compilePatterns(list, 'X playlistsInclude').length, 1);
  assert.equal(compilePatterns(list, 'X playlistsInclude').length, 1);
  assert.equal(compilePatterns(['(', 'other'], 'X playlistsInclude').length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /X playlistsInclude: pattern "\(" ignored/);
  assert.equal(playlistWanted({ type: 'channel', id: 'UCc', playlistsInclude: ['('] }, 'Anything'), true, 'an include list with no usable pattern takes everything');
  assert.equal(playlistSeason({ playlistSeasons: { PLa: 0, PLb: '3', PLc: 2.5 } }, 'PLa'), null);
  assert.equal(playlistSeason({ playlistSeasons: { PLb: '3' } }, 'PLb'), 3);
  assert.equal(playlistSeason({}, 'PLb'), null);
});

test('the catalogue leaves out cached playlists and upload rows the filters reject', () => {
  const src = { type: 'channel', id: 'UCf', title: 'Filtered', lang: 'ar', profile: 'ar-show', brands: ['Filtered'], playlistsExclude: ['^Filtered\\+$'], uploadsExclude: ['^\\W*السليط'] };
  const id = (s) => s.padEnd(11, '_').slice(0, 11);
  const playlists = {
    PLall: { id: 'PLall', sourceId: src.id, title: 'Filtered+', videos: [{ id: id('satire1'), title: 'السليط الإخباري | الحلقة 1' }, { id: id('doc1'), title: 'رحلة إلى المريخ' }] },
    PLshow: { id: 'PLshow', sourceId: src.id, title: 'الدحيح', videos: [{ id: id('doc1'), title: 'رحلة إلى المريخ' }] },
    up: { id: `UPLOADS:${src.id}`, sourceId: src.id, isUploads: true, title: '__uploads__', videos: [{ id: id('satire2'), title: '«السليط الإخباري» | الحلقة 2' }, { id: id('doc2'), title: 'أسرار المحيط' }] },
  };
  const details = Object.fromEntries(['satire1', 'doc1', 'satire2', 'doc2'].map((k) => [id(k), { durationSec: 1500 }]));
  const catalog = buildCatalog({ sources: [src], playlists, details, seen: {}, overrides: {} });
  const ids = catalog.shows.flatMap((s) => s.episodes.map((e) => e.id)).sort();
  assert.deepEqual(ids, [id('doc1'), id('doc2')].sort());
  assert.ok(!catalog.shows.some((s) => s.episodes.some((e) => e.playlistIds?.includes('PLall'))), 'the rejected playlist files nothing');
});
