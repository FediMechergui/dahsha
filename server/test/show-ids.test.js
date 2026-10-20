import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assignShowIds, buildIdAliases, previousEpisodeIds, showIdState } from '../src/show-ids.js';
import { buildCatalog } from '../src/catalog.js';
import { normalizeArabic, shortHash } from '../src/text.js';

// ---- assignShowIds / buildIdAliases on plain groups ------------------------------------------------

const group = (key, videos) => ({ key, videos });
const prevShow = (id, ...episodes) => ({ id, episodes: episodes.map((e) => (Array.isArray(e) ? { id: e[0], offerings: e.slice(1).map((x) => ({ provider: 'youtube', id: x })) } : { id: e })) });
const settle = (groups, previous, opts) => {
  const { reused, claim } = assignShowIds(groups, previous, opts);
  return groups.map((g) => reused.get(g) || claim(g, `s_${shortHash(g.key)}`));
};

test('without a previous catalogue every group keeps its title id', () => {
  const groups = [group('a', ['v1']), group('b', ['v2'])];
  for (const previous of [null, undefined, {}, { shows: [] }, { shows: [{ id: 'fm:m:1', episodes: [{ id: 'v1' }] }] }]) {
    const { reused, claim } = assignShowIds(groups, previous);
    assert.equal(reused.size, 0);
    assert.equal(claim(groups[0], 's_x', () => true), 's_x', 'claim never second-guesses a cold build');
  }
});

test('a previous id goes to the group holding a strict majority of its surviving episodes', () => {
  const [g1, g2] = [group('new title', ['a', 'b']), group('other', ['c'])];
  assert.deepEqual(settle([g1, g2], { shows: [prevShow('s_old', 'a', 'b', 'c')] }), ['s_old', `s_${shortHash('other')}`]);
  // Half is not a majority: neither half keeps the id (and neither may take it by title).
  const split = settle([group('x', ['a']), group('y', ['b'])], { shows: [prevShow('s_old', 'a', 'b')] });
  assert.ok(!split.includes('s_old'));
  // Episodes that are gone from this build do not count: one surviving episode of four is all of it.
  assert.deepEqual(settle([group('x', ['a', 'z'])], { shows: [prevShow('s_old', 'a', 'gone1', 'gone2', 'gone3')] }), ['s_old']);
  // An episode counts by its copies when its own video is gone (re-uploads listed as offerings).
  assert.deepEqual(settle([group('x', ['copy'])], { shows: [prevShow('s_old', ['gone', 'copy'])] }), ['s_old']);
  // Only s_ shows are kept: provider cards (fm:/hd:) are not built here.
  assert.deepEqual(settle([group('x', ['a'])], { shows: [{ id: 'fm:m:9', episodes: [{ id: 'a' }] }] }), [`s_${shortHash('x')}`]);
});

test('previous ids competing for one group: most episodes, then the title id, then id', () => {
  const g = group('merged', ['a1', 'a2', 'a3', 'b1']);
  const both = { shows: [prevShow('s_b', 'b1'), prevShow('s_a', 'a1', 'a2', 'a3')] };
  assert.deepEqual(settle([g], both), ['s_a']);
  const tie = { shows: [prevShow('s_b', 'x'), prevShow('s_a', 'y'), prevShow(`s_${shortHash('merged')}`, 'z')] };
  assert.deepEqual(settle([group('merged', ['x', 'y', 'z'])], tie), [`s_${shortHash('merged')}`], 'equal counts prefer the group\'s title id');
  assert.deepEqual(settle([group('m', ['x', 'y'])], { shows: [prevShow('s_b', 'x'), prevShow('s_a', 'y')] }), ['s_a'], 'then the smaller id');
  // mayReuse refuses a pairing.
  assert.deepEqual(settle([group('x', ['a'])], { shows: [prevShow('s_old', 'a')] }, { mayReuse: () => false }), [`s_${shortHash('x')}`]);
});

test('a title id is not reused for another show when its episodes moved elsewhere', () => {
  const moved = group('beta', ['b3']), home = group('alpha', ['a1', 'b1', 'b2']);
  const previous = { shows: [prevShow(`s_${shortHash('beta')}`, 'b1', 'b2'), prevShow(`s_${shortHash('alpha')}`, 'a1')] };
  const [mine, theirs] = settle([moved, home], previous, { keyOf: (g) => `src|${g.key}` });
  assert.equal(theirs, `s_${shortHash('beta')}`, 'beta\'s two episodes outnumber alpha\'s one');
  assert.equal(mine, `s_${shortHash('src|beta|b3')}`, 'the new same-titled show gets hash(key | smallest video)');
  // A previous id whose episodes are all gone may be taken again by title.
  assert.deepEqual(settle([group('beta', ['new'])], { shows: [prevShow(`s_${shortHash('beta')}`, 'gone')] }), [`s_${shortHash('beta')}`]);
  // A group holding some of the episodes keeps its title id when no group holds a majority.
  assert.deepEqual(settle([group('beta', ['b1']), group('gamma', ['b2'])], { shows: [prevShow(`s_${shortHash('beta')}`, 'b1', 'b2')] }), [`s_${shortHash('beta')}`, `s_${shortHash('gamma')}`]);
  // Taken ids fall back too, and the fallback itself steps aside when taken.
  const { claim } = assignShowIds([moved], { shows: [prevShow('s_q', 'q')] }, { keyOf: (g) => `src|${g.key}` });
  const first = `s_${shortHash('src|beta|b3')}`;
  assert.equal(claim(moved, 's_t', (id) => id === 's_t'), first);
  assert.equal(claim(moved, 's_t', (id) => id === 's_t' || id === first), `s_${shortHash('src|beta|b3|1')}`);
});

test('idAliases: gone ids point to the live show holding most of their episodes; maps are flattened and pruned', () => {
  const shows = [
    { id: 's_live', episodes: [{ id: 'a' }, { id: 'b', offerings: [{ provider: 'youtube', id: 'b' }, { provider: 'youtube', id: 'sister' }] }] },
    { id: 's_other', episodes: [{ id: 'c' }] },
  ];
  const previous = {
    shows: [prevShow('s_live', 'a'), prevShow('s_gone', 'a', 'b', 'c'), prevShow('s_sister', 'sister'), prevShow('s_empty', 'nothing'), { id: 'fm:m:1', episodes: [{ id: 'c' }] }],
    idAliases: { s_older: 's_gone', s_back: 's_x', s_other: 's_live', s_dead: 's_nowhere', s_loop1: 's_loop2', s_loop2: 's_loop1' },
  };
  assert.deepEqual(buildIdAliases(previous, shows, { s_seed: 's_other', s_older: 's_ignored' }), {
    s_gone: 's_live', // 2 of 3 episodes
    s_older: 's_live', // chain s_older → s_gone → s_live, previous aliases win over the seed
    s_seed: 's_other',
    s_sister: 's_live', // its video is now a copy (offering) of a live episode
  });
  // Keys are sorted, and a rebuild on the result is a fixed point.
  const again = buildIdAliases({ shows, idAliases: buildIdAliases(previous, shows) }, shows);
  assert.deepEqual(Object.keys(again), Object.keys(again).sort());
  assert.deepEqual(again, buildIdAliases(previous, shows));
  assert.deepEqual(buildIdAliases(null, shows), {});
  assert.deepEqual(buildIdAliases(null, shows, { s_x: 's_live', s_live: 's_other' }), { s_x: 's_live' }, 'a live key is never an alias');
  // Ties go to the smaller id.
  assert.deepEqual(buildIdAliases({ shows: [prevShow('s_p', 'a', 'c')] }, shows), { s_p: 's_live' });
});

// ---- buildCatalog with previous / idSeed (contract 2) ----------------------------------------------

const yt = (id) => id.padEnd(11, '_').slice(0, 11);
const natgeo = { type: 'channel', id: 'UCnatgeo', title: 'National Geographic', short: 'Nat Geo', lang: 'en', profile: 'natgeo-en', brands: ['National Geographic', 'Nat Geo'] };
const long = (ids, extra = {}) => Object.fromEntries(ids.map((id) => [id, { durationSec: 2700, ...(extra[id] || {}) }]));
const build = (playlists, details, more = {}) => buildCatalog({ sources: [natgeo], playlists, details, seen: {}, overrides: {}, ...more });
const ids = (catalog) => catalog.shows.map((s) => s.id).sort();
const showOf = (catalog, videoId) => catalog.shows.find((s) => s.episodes.some((e) => e.id === videoId));
const uploads = (videos) => ({ [`UPLOADS:${natgeo.id}`]: { id: `UPLOADS:${natgeo.id}`, sourceId: natgeo.id, isUploads: true, title: '__uploads__', videos } });
const playlist = (id, title, videos) => ({ [id]: { id, sourceId: natgeo.id, title, videos } });

test('an English re-title keeps the show id; a cold build gives the title-hash id as before', () => {
  const [e1, e2] = [yt('storm1'), yt('storm2')];
  // The hl=ar listing alone (no details title yet) names the English show in Arabic …
  const arabic = uploads([
    { id: e1, title: 'الإعصار الأخير (الحلقة الكاملة) | العاصفة المتجمعة | ناشيونال جيوغرافيك' },
    { id: e2, title: 'النجاة من رعب الإعصار العملاق (الحلقة الكاملة) | العاصفة المتجمعة | ناشيونال جيوغرافيك' },
  ]);
  const before = build(arabic, long([e1, e2]));
  assert.equal(before.shows.length, 1);
  const oldId = before.shows[0].id;
  assert.deepEqual(before.idAliases, {});
  // … and once details give the English titles, the show is "Gathering Storm".
  const english = long([e1, e2], {
    [e1]: { title: 'The Last Cyclone (Full Episode) | Gathering Storm | National Geographic' },
    [e2]: { title: 'Surviving Super Typhoon Terror (Full Episode) | Gathering Storm | National Geographic' },
  });
  const cold = build(arabic, english);
  assert.equal(cold.shows[0].title, 'Gathering Storm');
  assert.equal(cold.shows[0].id, `s_${shortHash(normalizeArabic('Gathering Storm'))}`, 'cold: the title hash, as before');
  assert.notEqual(cold.shows[0].id, oldId);
  const warm = build(arabic, english, { previous: before });
  assert.equal(warm.shows[0].title, 'Gathering Storm');
  assert.equal(warm.shows[0].id, oldId, 'warm: the id survives the re-title');
  assert.ok(warm.shows[0].episodes.every((e) => e.showId === oldId));
  assert.deepEqual(warm.idAliases, {});
  // The seed repairs a re-title that happened before ids were kept: old → current.
  const seeded = build(arabic, english, { previous: cold, idSeed: { [oldId]: cold.shows[0].id, s_notlive: 's_nowhere' } });
  assert.equal(seeded.shows[0].id, cold.shows[0].id);
  assert.deepEqual(seeded.idAliases, { [oldId]: cold.shows[0].id });
});

test('a show merged into another is aliased to it; it can come back under its id; rebuilds are idempotent', () => {
  const [a1, a2, a3, r1] = ['branch1', 'branch2', 'branch3', 'roots1'].map(yt);
  const details = long([a1, a2, a3, r1]);
  const branching = (extra = []) => playlist('PLbo', 'Branching Out | National Geographic', [
    { id: a1, title: 'The Wood Wide Web | Branching Out' }, { id: a2, title: 'Seeds | Branching Out' }, { id: a3, title: 'Canopy | Branching Out' }, ...extra]);
  const roots = playlist('PLroots', 'Roots of the Forest | National Geographic', [{ id: r1, title: 'Underground | Roots of the Forest' }]);
  const one = build({ ...branching(), ...roots }, details);
  assert.equal(one.shows.length, 2);
  const [branchId, rootsId] = [showOf(one, a1).id, showOf(one, r1).id];

  // The Roots episode is re-filed into Branching Out: its old id points there.
  const moved = { ...branching([{ id: r1, title: 'Underground | Branching Out' }]) };
  const two = build(moved, details, { previous: one });
  assert.deepEqual(ids(two), [branchId]);
  assert.deepEqual(two.idAliases, { [rootsId]: branchId });
  // Idempotent: a rebuild on its own output keeps ids and aliases (carried forward, not re-derived).
  const three = build(moved, details, { previous: two });
  assert.deepEqual(ids(three), ids(two));
  assert.deepEqual(three.idAliases, two.idAliases);
  // Overrides and artwork keyed by the kept id stay attached.
  const art = { [branchId]: { poster: 'https://example.com/poster.jpg', matched: true } };
  const withArt = buildCatalog({ sources: [natgeo], playlists: moved, details, seen: {}, overrides: { shows: { [branchId]: { title: 'Branching Out (renamed)' } } }, artwork: art, previous: two });
  assert.equal(withArt.shows[0].title, 'Branching Out (renamed)');
  assert.equal(withArt.shows[0].portrait, 'https://example.com/poster.jpg');

  // The Roots show comes back: it takes its id again and the alias is dropped.
  const four = build({ ...branching(), ...roots }, details, { previous: three });
  assert.deepEqual(ids(four), ids(one));
  assert.equal(showOf(four, r1).id, rootsId);
  assert.deepEqual(four.idAliases, {});
});

test('the id state of a catalogue stands in for it: a build without the catalogue keeps its ids, aliases and episodes', () => {
  const [a1, a2, a3, r1, copy] = ['branch1', 'branch2', 'branch3', 'roots1', 'branch1copy'].map(yt);
  const details = long([a1, a2, a3, r1, copy], { [a1]: { publishedAt: '2024-05-01T00:00:00Z' }, [copy]: { publishedAt: '2023-01-01T00:00:00Z', isPrivate: true } });
  const branching = (name, extra = []) => playlist('PLbo', `${name} | National Geographic`, [
    { id: a1, title: `The Wood Wide Web | ${name}` }, { id: a2, title: `Seeds | ${name}` }, { id: a3, title: `Canopy | ${name}` }, ...extra]);
  const roots = playlist('PLroots', 'Roots of the Forest | National Geographic', [{ id: r1, title: 'Underground | Roots of the Forest' }]);
  const one = build({ ...branching('Branching Out'), ...roots }, details);
  const [branchId, rootsId] = [showOf(one, a1).id, showOf(one, r1).id];
  const two = build(branching('Branching Out', [{ id: r1, title: 'Underground | Branching Out' }]), details, { previous: one });
  assert.deepEqual(two.idAliases, { [rootsId]: branchId });

  // The state, as it would be read back from its own file.
  const state = JSON.parse(JSON.stringify(showIdState(two)));
  assert.deepEqual(Object.keys(state.units), [branchId]);
  assert.deepEqual(state.idAliases, two.idAliases);
  assert.deepEqual([...previousEpisodeIds(state)].sort(), [...previousEpisodeIds(two)].sort());

  // Next run: the show is re-titled and an older upload of its first episode becomes public.
  const renamed = branching('Branching Out Forever', [{ id: r1, title: 'Underground | Branching Out Forever' }, { id: copy, title: 'The Wood Wide Web | Branching Out Forever' }]);
  const publicNow = { ...details, [copy]: { ...details[copy], isPrivate: false } };
  const fromCatalog = build(renamed, publicNow, { previous: two });
  const fromState = build(renamed, publicNow, { previous: state });
  assert.deepEqual(ids(fromCatalog), [branchId], 'the re-titled show keeps its id');
  assert.deepEqual(ids(fromState), ids(fromCatalog));
  assert.deepEqual(fromState.idAliases, fromCatalog.idAliases);
  assert.deepEqual(fromState.idAliases, { [rootsId]: branchId });
  const episodes = (c) => c.shows.flatMap((s) => s.episodes.map((e) => [e.id, (e.offerings || []).map((o) => o.id)]));
  assert.deepEqual(episodes(fromState), episodes(fromCatalog));
  assert.deepEqual(showOf(fromState, a1).episodes.find((e) => e.id === a1).offerings.map((o) => o.id), [a1, copy], 'the episode listed before stays the episode');
  // Without either, the show is re-keyed and the alias is lost.
  const cold = build(renamed, publicNow);
  assert.notDeepEqual(ids(cold), [branchId]);
  assert.deepEqual(cold.idAliases, {});
  // Anything else stands for no previous catalogue.
  for (const bad of [{ version: 'show-ids/0', units: state.units }, { version: state.version, units: [] }, { version: state.version }]) assert.deepEqual(ids(build(renamed, publicNow, { previous: bad })), ids(cold));
});

test('the title id of a work told apart from a same-titled one stays with the work owning the title', () => {
  const myflixer = { type: 'myflixer', id: 'myflixer', title: 'Myflixer Documentaries', short: 'Myflixer', lang: 'en', profile: 'myflixer', brands: ['Myflixer'] };
  const film = (slug, year, synopsis) => ({ id: `mf:m:${slug}`, title: 'Penguins', showTitle: 'Penguins', episodeTitle: 'Full film', year, synopsis,
    parsed: { showTitle: 'Penguins', episodeTitle: 'Full film', kind: 'film', number: null, season: null }, durationSec: 0, thumb: `https://example.com/${slug}.jpg` });
  const rows = [film('penguins', 2012, 'A King Penguin returns to South Georgia.'), film('penguins-2', 2019, 'A coming-of-age story about an Adélie penguin named Steve.'), film('penguins-3', 2019, 'A coming-of-age story about an Adélie penguin named Steve.')];
  const details = Object.fromEntries(rows.map((r) => [r.id, { title: r.title, durationSec: 0, publishedAt: `${r.year}-03-01T00:00:00Z`, description: r.synopsis }]));
  const playlists = { 'MYFLIXER:myflixer': { id: 'MYFLIXER:myflixer', sourceId: 'myflixer', title: 'Myflixer Documentaries', videos: rows } };
  const make = (previous) => buildCatalog({ sources: [myflixer], playlists, details, seen: {}, overrides: {}, previous });
  const cold = make(null);
  const titleId = `s_${shortHash('penguins')}`;
  const owner = showOf(cold, 'mf:m:penguins');
  assert.equal(owner.id, titleId);
  const other = showOf(cold, 'mf:m:penguins-2');
  assert.notEqual(other.id, titleId);
  // An older catalogue had all three under the title id; the 2019 work holds two of them, but the
  // title id stays with the 2012 film, which owns the title.
  const merged = { shows: [{ id: titleId, episodes: rows.map((r) => ({ id: r.id })) }] };
  const warm = make(merged);
  assert.equal(showOf(warm, 'mf:m:penguins').id, titleId);
  assert.equal(showOf(warm, 'mf:m:penguins-2').id, other.id);
  assert.deepEqual(warm.idAliases, {});
});

test('the committed seed maps only old ids to s_ ids', () => {
  const seed = JSON.parse(fs.readFileSync(new URL('../data/show-id-aliases.json', import.meta.url), 'utf8'));
  const entries = Object.entries(seed);
  assert.ok(entries.length > 0);
  assert.deepEqual(Object.keys(seed), Object.keys(seed).sort());
  for (const [k, v] of entries) { assert.match(k, /^s_[0-9a-z]+$/); assert.match(v, /^s_[0-9a-z]+$/); assert.ok(!Object.hasOwn(seed, v), `${v} is a final target`); }
});
