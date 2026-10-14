// Builds data/universes.json: every shared universe / franchise with its logo, description, home
// streaming services, and its titles in watch order, pulled from Wikidata (keyless) and matched
// onto the Flixer index. Re-run to refresh ("updates"): members, dates and logos come from Wikidata.
//   node server/src/build-universes.js [dataDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? new Set(argv[onlyIdx + 1].split(',')) : null;
const dataDir = path.resolve(argv.find((a) => !a.startsWith('--') && (onlyIdx < 0 || a !== argv[onlyIdx + 1])) || path.join(__dirname, '../../client/public/data'));
const UA = 'Flixer/1.2 (https://github.com/FediMechergui/flixer; catalogue build)';
const SPARQL = 'https://query.wikidata.org/sparql';

// id, name, short, how to find it on Wikidata, home streaming services (curated), member mode.
//   mode 'franchise': items that are part of the series / media franchise / set in the universe
//   mode 'company':   works produced by the studio (Pixar, Ghibli)
//   qids: fixed Wikidata ids (skips the search); search: text + description hint
const UNIVERSES = [
  { id: 'mcu', name: 'Marvel Cinematic Universe', short: 'MCU', qids: ['Q642878'], home: ['Disney+'] },
  { id: 'dceu', name: 'DC Extended Universe', short: 'DCEU', search: 'DC Extended Universe', home: ['Max'] },
  { id: 'dcu', name: 'DC Universe', short: 'DCU', search: 'DC Universe (franchise)', hint: 'franchise', home: ['Max'] },
  { id: 'dcau', name: 'DC Animated Universe', short: 'DCAU', search: 'DC Animated Universe', home: ['Max'] },
  { id: 'dc', name: 'DC Comics', short: 'DC', search: 'DC Comics', hint: 'comic', home: ['Max'], logoOnly: true },
  { id: 'marvel', name: 'Marvel', short: 'Marvel', search: 'Marvel Entertainment', hint: 'entertainment', home: ['Disney+'], logoOnly: true },
  { id: 'starwars', name: 'Star Wars', short: 'Star Wars', qids: ['Q462'], home: ['Disney+'] },
  { id: 'startrek', name: 'Star Trek', short: 'Star Trek', qids: ['Q1092'], home: ['Paramount+'] },
  { id: 'wizarding', name: 'Wizarding World', short: 'Wizarding', search: 'Wizarding World', hint: 'franchise', home: ['Max', 'Peacock'] },
  { id: 'middleearth', name: 'Middle-earth', short: 'Tolkien', qids: ['Q79734'], seed: [['The Lord of the Rings', 1978, 'movie'], ['The Return of the King', 1980, 'movie'], ['The Lord of the Rings: The Fellowship of the Ring', 2001, 'movie'], ['The Lord of the Rings: The Two Towers', 2002, 'movie'], ['The Lord of the Rings: The Return of the King', 2003, 'movie'], ['The Hobbit: An Unexpected Journey', 2012, 'movie'], ['The Hobbit: The Desolation of Smaug', 2013, 'movie'], ['The Hobbit: The Battle of the Five Armies', 2014, 'movie'], ['The Lord of the Rings: The Rings of Power', 2022, 'tv'], ['The Lord of the Rings: The War of the Rohirrim', 2024, 'movie']], home: ['Max', 'Prime Video'] },
  { id: 'monsterverse', name: 'MonsterVerse', short: 'MonsterVerse', search: 'MonsterVerse', home: ['Max', 'Apple TV+'] },
  { id: 'conjuring', name: 'Conjuring Universe', short: 'Conjuring', search: 'The Conjuring Universe', home: ['Max'] },
  { id: 'fast', name: 'Fast & Furious', short: 'Fast', search: 'Fast & Furious', hint: 'franchise', home: ['Peacock'] },
  { id: 'bond', name: 'James Bond', short: '007', qids: ['Q2484680'], home: ['Prime Video'] },
  { id: 'jurassic', name: 'Jurassic Park', short: 'Jurassic', qids: ['Q2336369'], home: ['Peacock'] },
  { id: 'transformers', name: 'Transformers', short: 'Transformers', search: 'Transformers', hint: 'film series', home: ['Paramount+'] },
  { id: 'alien', name: 'Alien & Predator', short: 'Alien', search: ['Alien', 'Predator'], hint: 'franchise', home: ['Hulu', 'Disney+'] },
  { id: 'terminator', name: 'Terminator', short: 'Terminator', search: 'Terminator', hint: 'franchise', home: ['Paramount+'] },
  { id: 'matrix', name: 'The Matrix', short: 'Matrix', search: 'The Matrix', hint: 'franchise', home: ['Max'] },
  { id: 'johnwick', name: 'John Wick', short: 'John Wick', search: 'John Wick', hint: 'franchise', home: ['Peacock', 'Starz'] },
  { id: 'missionimpossible', name: 'Mission: Impossible', short: 'M:I', search: 'Mission: Impossible', hint: 'film series', home: ['Paramount+'] },
  { id: 'rocky', name: 'Rocky & Creed', short: 'Rocky', qids: ['Q1078084'], home: ['Prime Video'] },
  { id: 'dune', name: 'Dune', short: 'Dune', qids: ['Q18011049'], home: ['Max'] },
  { id: 'avatar', name: 'Avatar', short: 'Avatar', search: 'Avatar', hint: 'franchise', home: ['Disney+'] },
  { id: 'hungergames', name: 'The Hunger Games', short: 'Hunger Games', search: 'The Hunger Games', hint: 'film series', home: ['Peacock', 'Starz'] },
  { id: 'twd', name: 'The Walking Dead', short: 'TWD', search: 'The Walking Dead', hint: 'franchise', home: ['AMC+', 'Netflix'] },
  { id: 'got', name: 'A Song of Ice and Fire', short: 'GoT', qids: ['Q45875'], seed: [['Game of Thrones', 2011, 'tv'], ['House of the Dragon', 2022, 'tv'], ['A Knight of the Seven Kingdoms', 2026, 'tv']], home: ['Max'] },
  { id: 'breakingbad', name: 'Breaking Bad', short: 'Breaking Bad', search: 'Breaking Bad', hint: 'franchise', home: ['Netflix'] },
  { id: 'pixar', name: 'Pixar', short: 'Pixar', search: 'Pixar', hint: 'studio', mode: 'company', home: ['Disney+'] },
  { id: 'ghibli', name: 'Studio Ghibli', short: 'Ghibli', search: 'Studio Ghibli', hint: 'studio', mode: 'company', home: ['Netflix', 'Max'] },
  { id: 'sherlock', name: 'Sherlock Holmes', short: 'Sherlock', qids: ['Q4653'], seed: [['Sherlock Holmes', 2009, 'movie'], ['Sherlock Holmes: A Game of Shadows', 2011, 'movie'], ['Sherlock', 2010, 'tv'], ['Elementary', 2012, 'tv'], ['Mr. Holmes', 2015, 'movie'], ['Holmes & Watson', 2018, 'movie'], ['Enola Holmes', 2020, 'movie'], ['The Irregulars', 2021, 'tv'], ['Enola Holmes 2', 2022, 'movie'], ['Watson', 2025, 'tv']], home: ['BBC iPlayer', 'Netflix'] },
  { id: 'indiana', name: 'Indiana Jones', short: 'Indiana Jones', search: 'Indiana Jones', hint: 'franchise', home: ['Disney+', 'Paramount+'] },
  { id: 'ghostbusters', name: 'Ghostbusters', short: 'Ghostbusters', qids: ['Q2365168'], home: ['Netflix'] },
  { id: 'planetapes', name: 'Planet of the Apes', short: 'Apes', search: 'Planet of the Apes', hint: 'franchise', home: ['Hulu', 'Disney+'] },
  { id: 'madmax', name: 'Mad Max', short: 'Mad Max', search: 'Mad Max', hint: 'franchise', home: ['Max'] },
  { id: 'shrek', name: 'Shrek', short: 'Shrek', search: 'Shrek', hint: 'franchise', home: ['Peacock'] },
  { id: 'despicable', name: 'Despicable Me', short: 'Minions', search: 'Despicable Me', hint: 'franchise', home: ['Peacock'] },
  { id: 'kungfupanda', name: 'Kung Fu Panda', short: 'Kung Fu Panda', search: 'Kung Fu Panda', hint: 'franchise', home: ['Peacock'] },
  { id: 'httyd', name: 'How to Train Your Dragon', short: 'HTTYD', search: 'How to Train Your Dragon', hint: 'franchise', home: ['Peacock', 'Netflix'] },
  { id: 'xmen', name: 'X-Men', short: 'X-Men', search: 'X-Men', hint: 'film series', home: ['Disney+'] },
  { id: 'spiderverse', name: 'Spider-Verse', short: 'Spider-Verse', qids: ['Q99601314'], home: ['Netflix'] },
  { id: 'batmanarkham', name: 'Batman films', short: 'Batman', search: 'Batman in film', hint: 'film', home: ['Max'] },
  { id: 'godfather', name: 'The Godfather', short: 'Godfather', qids: ['Q3225260'], home: ['Paramount+'] },
  { id: 'toystory', name: 'Toy Story', short: 'Toy Story', search: 'Toy Story', hint: 'franchise', home: ['Disney+'] },
  { id: 'scream', name: 'Scream', short: 'Scream', search: 'Scream', hint: 'franchise', home: ['Paramount+'] },
  { id: 'halloween', name: 'Halloween', short: 'Halloween', search: 'Halloween', hint: 'franchise', home: ['Peacock'] },
  { id: 'saw', name: 'Saw', short: 'Saw', search: 'Saw', hint: 'franchise', home: ['Peacock'] },
  { id: 'pirates', name: 'Pirates of the Caribbean', short: 'Pirates', search: 'Pirates of the Caribbean', hint: 'franchise', home: ['Disney+'] },
  { id: 'twilight', name: 'Twilight', short: 'Twilight', search: 'The Twilight Saga', hint: 'film series', home: ['Peacock', 'Netflix'] },
  { id: 'divergent', name: 'Divergent', short: 'Divergent', qids: ['Q17512668'], home: ['Starz'] },
  { id: 'mazerunner', name: 'Maze Runner', short: 'Maze Runner', search: 'Maze Runner', hint: 'film series', home: ['Disney+'] },
  { id: 'godzilla', name: 'Godzilla', short: 'Godzilla', search: 'Godzilla', hint: 'franchise', home: ['Max', 'Crunchyroll'] },
  { id: 'ocean', name: "Ocean's", short: "Ocean's", search: "Ocean's", hint: 'franchise', home: ['Max'] },
  { id: 'bourne', name: 'Jason Bourne', short: 'Bourne', qids: ['Q868683'], home: ['Peacock'] },
  { id: 'diehard', name: 'Die Hard', short: 'Die Hard', qids: ['Q2716420'], home: ['Hulu', 'Disney+'] },
  { id: 'rambo', name: 'Rambo', short: 'Rambo', qids: ['Q1621266'], home: ['Starz'] },
  { id: 'resident', name: 'Resident Evil', short: 'Resident Evil', qids: ['Q17520607'], home: ['Netflix'] },
  { id: 'dragonball', name: 'Dragon Ball', short: 'Dragon Ball', search: 'Dragon Ball', hint: 'franchise', home: ['Crunchyroll'] },
  { id: 'pokemon', name: 'Pokémon', short: 'Pokémon', search: 'Pokémon', hint: 'franchise', home: ['Netflix'] },
  { id: 'onepiece', name: 'One Piece', short: 'One Piece', search: 'One Piece', hint: 'franchise', home: ['Netflix', 'Crunchyroll'] },
  { id: 'naruto', name: 'Naruto', short: 'Naruto', search: 'Naruto', hint: 'franchise', home: ['Crunchyroll', 'Netflix'] }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (res.status === 429 || res.status === 503) { await sleep(3000 * i); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (i === tries) throw e; await sleep(1500 * i); }
  }
  return null;
}

const key = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const FRANCHISE_HINTS = ['franchise', 'film series', 'series of films', 'shared universe', 'media franchise', 'fictional universe', 'universe', 'trilogy', 'studio'];

async function resolve(u) {
  if (u.qids) return u.qids;
  const terms = Array.isArray(u.search) ? u.search : [u.search];
  const out = [];
  for (const term of terms) {
    const d = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=en&format=json&limit=10`);
    const list = (d && d.search) || [];
    const hints = u.hint ? [u.hint, ...FRANCHISE_HINTS] : FRANCHISE_HINTS;
    const pick = list.find((s) => s.description && hints.some((h) => s.description.toLowerCase().includes(h))) || list[0];
    if (pick) out.push(pick.id);
    await sleep(250);
  }
  return out;
}

async function entity(qid) {
  const d = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const e = d && d.entities && d.entities[qid];
  if (!e) return {};
  const claim = (p) => e.claims && e.claims[p] && e.claims[p][0] && e.claims[p][0].mainsnak && e.claims[p][0].mainsnak.datavalue && e.claims[p][0].mainsnak.datavalue.value;
  const file = claim('P154') || claim('P18');
  const logo = file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/ /g, '_'))}?width=480` : null;
  return { label: e.labels && e.labels.en && e.labels.en.value, description: e.descriptions && e.descriptions.en && e.descriptions.en.value, logo, isLogo: !!claim('P154'), sitelink: e.sitelinks && e.sitelinks.enwiki && e.sitelinks.enwiki.title };
}

// Logo fallbacks when the Wikidata item has no logo (P154): the logo of another pinned or searched
// franchise item, the lead image of the Wikipedia article when it is a logo file, then a Commons
// file search for "<name> logo". Only files whose name says "logo" (or SVG wordmarks) are accepted.
const isLogoFile = (f) => /logo|wordmark|title card|titlecard/i.test(f) && !/screenshot|poster|cover/i.test(f);
const filePath = (f) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(f).replace(/^File:/, '').replace(/ /g, '_'))}?width=480`;
async function findLogo(u, ent) {
  try {
    if (ent.sitelink) {
      const d = await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=pageimages|images&piprop=name&imlimit=50&format=json&titles=${encodeURIComponent(ent.sitelink)}`);
      const page = d && d.query && Object.values(d.query.pages)[0];
      if (page && page.pageimage && isLogoFile(page.pageimage)) return filePath(page.pageimage);
      const img = page && (page.images || []).map((x) => x.title).find((t) => isLogoFile(t) && !/commons-logo|wiki|icon|symbol|flag/i.test(t));
      if (img) return filePath(img);
    }
    for (const q of [u.name + ' logo', (u.short || u.name) + ' logo']) {
      const d = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=10&format=json&srsearch=${encodeURIComponent(q)}`);
      const words = u.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/s+/).filter((w) => w.length > 2 && !['the', 'and', 'films', 'film'].includes(w));
      const hit = ((d && d.query && d.query.search) || []).map((x) => x.title).find((t) => isLogoFile(t) && /.(svg|png)$/i.test(t) && words.some((w) => t.toLowerCase().includes(w)));
      if (hit) return filePath(hit);
      await sleep(250);
    }
  } catch { /* optional */ }
  return null;
}

const FILM_TYPES = new Set(['Q11424', 'Q24869', 'Q202866', 'Q506240', 'Q226730', 'Q20667187', 'Q2431196']); // film, feature film, animated film, television film, silent film, ...
const TV_TYPES = new Set(['Q5398426', 'Q581714', 'Q63952888', 'Q1259759', 'Q15416', 'Q117467246', 'Q3464665']); // TV series, animated series, drama series, miniseries, TV program, ...

async function members(qids, mode) {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  const query = mode === 'company'
    ? `SELECT ?item ?itemLabel ?date ?start ?type WHERE { VALUES ?c { ${values} } ?item wdt:P272 ?c . ?item wdt:P31 ?type . FILTER(?type IN (${[...FILM_TYPES, ...TV_TYPES].map((t) => 'wd:' + t).join(',')})) OPTIONAL { ?item wdt:P577 ?date } OPTIONAL { ?item wdt:P580 ?start } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`
    : `SELECT ?item ?itemLabel ?date ?start ?ordinal ?type WHERE { VALUES ?u { ${values} } { ?item p:P179 ?st . ?st ps:P179 ?u . OPTIONAL { ?st pq:P1545 ?ordinal } } UNION { ?item wdt:P8345 ?u } UNION { ?item wdt:P1434 ?u } UNION { ?item wdt:P361 ?u } OPTIONAL { ?item wdt:P577 ?date } OPTIONAL { ?item wdt:P580 ?start } OPTIONAL { ?item wdt:P31 ?type } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const d = await getJson(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`);
  const map = new Map();
  for (const b of (d && d.results && d.results.bindings) || []) {
    const q = b.item.value.split('/').pop();
    const cur = map.get(q) || { q, title: null, dates: [], ordinal: null, types: new Set() };
    const label = b.itemLabel && b.itemLabel.value;
    if (label && label !== q) cur.title = label;
    if (b.date) cur.dates.push(b.date.value.slice(0, 10));
    if (b.start) cur.dates.push(b.start.value.slice(0, 10));
    if (b.ordinal && !Number.isNaN(+b.ordinal.value)) cur.ordinal = +b.ordinal.value;
    if (b.type) cur.types.add(b.type.value.split('/').pop());
    map.set(q, cur);
  }
  return [...map.values()].filter((m) => m.title).map((m) => {
    const type = [...m.types].some((t) => TV_TYPES.has(t)) ? 'tv' : [...m.types].some((t) => FILM_TYPES.has(t)) ? 'movie' : (m.types.size ? null : 'movie');
    const date = m.dates.filter((x) => /^\d{4}/.test(x)).sort()[0] || null;
    return { q: m.q, title: m.title, year: date ? +date.slice(0, 4) : null, date, type, ordinal: m.ordinal };
  }).filter((m) => m.type);
}

async function run() {
  const t0 = Date.now();
  const cat = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
  const byTitle = new Map();
  for (const s of cat.shows) { const k = key(s.title); if (!k) continue; const arr = byTitle.get(k); if (arr) arr.push(s); else byTitle.set(k, [s]); }
  const match = (m) => {
    const cands = (byTitle.get(key(m.title)) || []).filter((s) => (s.kind === 'series') === (m.type === 'tv'));
    if (!cands.length) return null;
    const hit = (m.year && (cands.find((s) => +s.year === m.year) || cands.find((s) => Math.abs(+s.year - m.year) <= 1))) || (cands.length === 1 || !m.year ? cands[0] : null);
    return hit ? hit.id : null;
  };

  const prevFile = path.join(dataDir, 'universes.json');
  const prev = ONLY && fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, 'utf8')).universes : [];
  const out = [];
  for (const u of UNIVERSES) {
    if (ONLY && !ONLY.has(u.id)) { const keep = prev.find((x) => x.id === u.id); if (keep) out.push(keep); continue; }
    try {
      const qids = await resolve(u);
      if (!qids.length) { console.warn(`[universes] ${u.id}: not found on Wikidata`); continue; }
      const ent = await entity(qids[0]);
      if (!ent.isLogo) { const alt = await findLogo(u, ent); if (alt) { ent.logo = alt; ent.isLogo = true; } }
      let list = u.logoOnly ? [] : await members(qids, u.mode || 'franchise');
      if (!u.logoOnly && list.length < 2) {
        const extra = [];
        for (const term of [u.name + ' film series', u.name + ' (film series)', u.name + ' franchise', (Array.isArray(u.search) ? u.search[0] : u.search || u.name) + ' film series']) {
          const d = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=en&format=json&limit=8`);
          const hit = ((d && d.search) || []).find((x) => x.description && /film series|franchise|media franchise|series of films|television series|book series/i.test(x.description) && !qids.includes(x.id));
          if (hit) extra.push(hit.id);
          await sleep(250);
        }
        if (extra.length) { const more = await members([...new Set(extra)], u.mode || 'franchise'); const seen = new Set(list.map((m) => m.q)); more.forEach((m) => { if (!seen.has(m.q)) list.push(m); }); qids.push(...extra.filter((q) => !qids.includes(q))); }
      }
      if (u.seed) { const have = new Set(list.map((m) => key(m.title) + m.type)); u.seed.forEach(([title, year, type], i) => { if (!have.has(key(title) + type)) list.push({ q: 'seed:' + u.id + ':' + i, title, year, date: year + '-01-01', type, ordinal: null }); }); }
      list = list.map((m) => Object.assign(m, { id: match(m) }));
      // Watch order: numbered where Wikidata has series ordinals, else by release date.
      const byDate = (a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || a.title.localeCompare(b.title);
      list.sort(byDate);
      const numbered = list.filter((m) => m.ordinal != null).length >= 3;
      const services = new Map();
      list.forEach((m) => { if (!m.id) return; const s = cat.shows.find((x) => x.id === m.id); if (s && s.tvm && s.tvm.svc) services.set(s.tvm.svc, (services.get(s.tvm.svc) || 0) + 1); });
      out.push({
        id: u.id, name: u.name, short: u.short, qids, description: ent.description || '', logo: ent.logo || null, isLogo: !!ent.isLogo, wiki: ent.sitelink ? `https://en.wikipedia.org/wiki/${encodeURIComponent(ent.sitelink.replace(/ /g, '_'))}` : null,
        home: u.home || [], services: [...services].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        mode: u.mode || 'franchise', numbered, members: list, inFlixer: list.filter((m) => m.id).length
      });
      console.log(`[universes] ${u.id}: ${qids.join('+')} · ${list.length} titles · ${list.filter((m) => m.id).length} in Flixer${ent.logo ? ' · logo' : ''}`);
      await sleep(400);
    } catch (e) { console.warn(`[universes] ${u.id}: ${e.message}`); }
  }
  const payload = { generatedAt: new Date().toISOString(), universes: out };
  fs.writeFileSync(path.join(dataDir, 'universes.json'), JSON.stringify(payload));
  console.log(`[universes] wrote ${out.length} universes (${out.reduce((n, u) => n + u.members.length, 0)} titles, ${out.reduce((n, u) => n + u.inFlixer, 0)} in Flixer) in ${Math.round((Date.now() - t0) / 1000)}s`);
}

run().catch((e) => { console.error('[universes] failed:', e); process.exit(1); });
