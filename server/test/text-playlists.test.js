import test from 'node:test';
import assert from 'node:assert/strict';
import {
  englishPlaylistShow, playlistShowName, isGenericPlaylist, isAutoPlaylistId, englishPlaylistIsSeries,
  parseTitle, relativeToMs, cleanDescription,
} from '../src/text.js';

// Fixtures are real titles from the production snapshot (playlists.json / details.json, generation 37).
const NATGEO = { lang: 'en', profile: 'natgeo-en', brands: ['National Geographic', 'Nat Geo'] };
const ANIMALS = { lang: 'en', profile: 'natgeo-en', brands: ['Nat Geo Animals', 'Nat Geo Wild', 'Nat Geo', 'National Geographic'] };
const HISTORY = { lang: 'en', profile: 'history', brands: ['HISTORY', 'History'] };
const VICE = { lang: 'en', profile: 'generic-en', brands: ['VICE News', 'VICE'] };
const DISCOVERY = { lang: 'en', profile: 'generic-en', brands: ['Discovery', 'Discovery Channel'] };
const WELT = { lang: 'en', profile: 'generic-en', brands: ['WELT Documentary', 'WELT', 'WELT HD'] };
const FREEDOC = { lang: 'en', profile: 'freedoc', brands: ['Free Documentary History', 'Free Documentary - History', 'FD History', 'Free Documentary'] };
const FRONTLINE = { lang: 'en', profile: 'frontline', brands: ['FRONTLINE', 'FRONTLINE PBS', 'FRONTLINE PBS | Official', 'FRONTLINE/World', 'PBS'] };

// What the catalogue passes: generic playlists give no playlist title.
const parse = (title, src, playlistTitle = null) => {
  const generic = !playlistTitle || isGenericPlaylist(playlistTitle);
  return parseTitle(title, { ...src, playlistTitle: generic ? null : playlistTitle, playlistGeneric: generic, playlistSize: 10 });
};
const pick = (r) => ({ showTitle: r.showTitle, episodeTitle: r.episodeTitle, season: r.season, kind: r.kind });

test('season designators and "Official Playlist" suffixes leave the show name and the season', () => {
  const cases = [
    ['The Curse of Oak Island: Season: 8 | New Episodes Tuesdays at 9/8c | History', HISTORY, 'The Curse of Oak Island', 8],
    ['The Curse of Oak Island (Season 11)', HISTORY, 'The Curse of Oak Island', 11],
    ['The Curse of Oak Island: Season 12 | History', HISTORY, 'The Curse of Oak Island', 12],
    ['Vikings: Season 2 - Official Playlist | History', HISTORY, 'Vikings', 2],
    ['Vikings: Season 4 – Official Playlist | Watch Full Episodes on History.com | History', HISTORY, 'Vikings', 4],
    ["History's Greatest Mysteries | Season 2 | History", HISTORY, "History's Greatest Mysteries", 2],
    ['Epic Food Journeys with Mark Wiens: Season 2 | A National Geographic YouTube Original Series', NATGEO, 'Epic Food Journeys with Mark Wiens', 2],
    ["She's Running | VICE News : Season 1", VICE, "She's Running", 1],
    // The season first, the series after it.
    ['Season 6 | VICE on HBO', VICE, 'VICE on HBO', 6],
    ['VICE on HBO : Season 1', VICE, 'VICE on HBO', 1],
    ['VICE on HBO: Season One', VICE, 'VICE on HBO', 1],
  ];
  for (const [title, src, name, season] of cases) {
    assert.deepEqual(englishPlaylistShow(title, src.brands), { name, season }, title);
    assert.equal(playlistShowName(title, src), name, title);
  }
});

test('"Full Episodes", "(HBO)" and the network leave the series name', () => {
  const cases = [
    ['VICE News Tonight Full Episodes (HBO)', VICE, 'VICE News Tonight'],
    ['VICE News Tonight Segments (HBO)', VICE, 'VICE News Tonight'],
    ['VICE News Tonight on VICE TV', VICE, 'VICE News Tonight'],
    ["America's Book of Secrets: Deadly Cults - Full Episode | History", HISTORY, "America's Book of Secrets: Deadly Cults"],
    ['Ancient Aliens | Full Episode Marathons | History', HISTORY, 'Ancient Aliens'],
    ['Ancient Aliens: Full Episode Marathons | History', HISTORY, 'Ancient Aliens'],
    ['Modern Marvels | Full Episodes | History', HISTORY, 'Modern Marvels'],
    ['Outlaw Chronicles: FULL EPISODES | HISTORY', HISTORY, 'Outlaw Chronicles'],
    ['Full Episodes - Untamed with Filipe DeAndrade | Nat Geo Wild', ANIMALS, 'Untamed with Filipe DeAndrade'],
    // Correspondent and topic collections keep their own wording; "VICE on HBO" keeps the network.
    ['Shawna Thomas: VICE News Tonight (HBO)', VICE, 'Shawna Thomas: VICE News Tonight'],
    ['Retaking Mosul (HBO)', VICE, 'Retaking Mosul'],
    ['National Geographic Live!', NATGEO, 'National Geographic Live!'],
    // Numbers inside a name are not season markers ("Honors 250" is not "Honor" + season 25).
    ['History Honors 250', HISTORY, 'History Honors 250'],
    ['Travel, Food, &amp; Culture | National Geographic', NATGEO, 'Travel, Food, & Culture'],
  ];
  for (const [title, src, name] of cases) {
    assert.equal(englishPlaylistShow(title, src.brands).name, name, title);
    assert.equal(playlistShowName(title, src), name, title);
  }
});

test('brand, promo and collection playlists name no show', () => {
  const cases = [
    ['MEGA Episodes | National Geographic', NATGEO],
    ['National Geographic Full Episodes', NATGEO],
    ['Nat Geo Animals Full Episodes', ANIMALS],
    ['National Geographic Newest Videos', NATGEO],
    ['National Geographic Documentary Films', NATGEO],
    ['Documentary Films | National Geographic', NATGEO],
    ['FULL EPISODES | History', HISTORY],
    ['Full Episode Marathons | History', HISTORY],
    ['WELT Documentary - Livestreams', WELT],
    ['WELT Spotlight', WELT],
    ['Now Trending | National Geographic', NATGEO],
    ['VICE News', VICE],
    ['Favorites', VICE],
    ['المفضلة', VICE],
    ['__uploads__', NATGEO],
    ['s | National Geographic', NATGEO],
  ];
  for (const [title, src] of cases) assert.equal(playlistShowName(title, src), '', title);
  for (const title of ['National Geographic Documentary Films', 'Full Episode Marathons | History', 'WELT Documentary - Livestreams',
    'MEGA Episodes | National Geographic', 'Nat Geo Animals Newest Videos', 'Favorites', 'المفضلة']) {
    assert.equal(isGenericPlaylist(title), true, title);
  }
  // Series playlists stay shows.
  for (const title of ['Ancient Aliens | Full Episode Marathons | History', 'National Geographic Live!', 'Beyond the Spotlight',
    'Big Little Italy | A National Geographic YouTube Original Series', 'The Curse of Oak Island (Season 11)', 'Season 6 | VICE on HBO',
    'Vikings: Season 2 - Official Playlist | History']) {
    assert.equal(isGenericPlaylist(title), false, title);
  }
});

test('Arabic playlist names: branding and DW labels dropped, collections empty', () => {
  const NGAD = { lang: 'ar', profile: 'natgeo' };
  const DW = { lang: 'ar', profile: 'dw' };
  const ASHARQ = { lang: 'ar', profile: 'asharq' };
  const AJ = { lang: 'ar', profile: 'aljazeera' };
  assert.equal(playlistShowName('كوكبنا العجيب', NGAD), 'كوكبنا العجيب');
  assert.equal(playlistShowName('عجائب أوروبا البرية | ناشونال جيوغرافيك أبوظبي', NGAD), 'عجائب أوروبا البرية');
  assert.equal(playlistShowName('سلسلة وثائقيات | أزمة كورونا | وثائقية دي دبليو', DW), 'أزمة كورونا');
  assert.equal(playlistShowName('مراسلون  | وثائقية دي دبليو', DW), '');
  assert.equal(playlistShowName('صيد دموي', ASHARQ), 'صيد دموي');
  assert.equal(playlistShowName('العرب والأتراك.. قصة أخوة', AJ), 'العرب والأتراك.. قصة أخوة');
  assert.equal(playlistShowName('الأكثر مشاهدة في مارس..', AJ), '');
  assert.equal(playlistShowName('حلقات كاملة', NGAD), '');
  assert.equal(playlistShowName('المفضلة', NGAD), '');
});

test('auto-generated playlist ids', () => {
  for (const id of ['FLZaT_X_mc0BI-djXOlfhqWQ', 'LLZaT_X_mc0BI-djXOlfhqWQ', 'UUZaT_X_mc0BI-djXOlfhqWQ', 'UPLOADS:UCpVm7bg6pXKo1Pr6k5kxG9A', 'WL', 'LL', 'RDdQw4w9WgXcQ']) {
    assert.equal(isAutoPlaylistId(id), true, id);
  }
  for (const id of ['PLw613M86o5o5h_7QkuryiioEJDG0eI07V', 'PLivjPDlt6ApS90YoAu-T8VIj6awyflIym', 'FL', 'MYFLIXER:myflixer', '', null, undefined]) {
    assert.equal(isAutoPlaylistId(id), false, String(id));
  }
});

test('"<Show> Full Episodes" playlists are series when their videos name the show', () => {
  const vnt = [
    'Opioid-Addicted Mothers & Iraq Peace: VICE News Tonight Full Episode (HBO)',
    'Kashmir Unrest & Religious Divorces: VICE News Tonight Full Episode',
    'Iowa State Fair & Vegas Pig Farm: VICE News Tonight on HBO Full Episode',
    'Gaza Unrest & Investigating Trump | VICE News Tonight Full Episode (HBO)',
    'Puerto Rico Rage & Ukraine Elections: VICE News Tonight Full Episode (HBO)',
  ];
  assert.equal(englishPlaylistIsSeries('VICE News Tonight Full Episodes (HBO)', vnt, VICE.brands), true);
  assert.equal(englishPlaylistIsSeries('VICE News Tonight Full Episodes (HBO)', [...vnt, 'Why Is Everyone Moving to Texas?', 'Inside the Fight for Abortion Rights'], VICE.brands), false);
  assert.equal(englishPlaylistIsSeries('National Geographic Full Episodes', ['Drain the Oceans: X | National Geographic Full Episodes'], NATGEO.brands), false);
  assert.equal(englishPlaylistIsSeries('Modern Marvels | Full Episodes | History', ['How Water Systems Built Civilization | Modern Marvels', 'Giants of the Sky and Space | Modern Marvels | History'], HISTORY.brands), true);
  assert.equal(englishPlaylistIsSeries('Modern Marvels | Full Episodes | History', [], HISTORY.brands), false);
});

test('promo, livestream and compilation segments never become show names', () => {
  const cases = [
    // MEGA EPISODE in a collection playlist: never 'MEGA EPISODE'.
    ['Drain the Oceans: Submerged Secrets of America | MEGA EPISODE | National Geographic', NATGEO, 'MEGA Episodes | National Geographic',
      { showTitle: 'Drain the Oceans: Submerged Secrets of America', episodeTitle: 'Full film', season: null, kind: 'film' }],
    // ...and in the show's own playlist the playlist wins.
    ['Drain the Oceans: Submerged Secrets of America | MEGA EPISODE | National Geographic', NATGEO, 'Drain The Oceans | National Geographic',
      { showTitle: 'Drain The Oceans', episodeTitle: 'Submerged Secrets of America', season: null, kind: 'series' }],
    ["Erased: WW2's Heroes of Color | S1 MEGA EPISODE | National Geographic", NATGEO, 'MEGA Episodes | National Geographic',
      { showTitle: "Erased: WW2's Heroes of Color", episodeTitle: 'Full episode', season: 1, kind: 'series' }],
    ['Gordon Ramsay: Uncharted | S3 MEGA EPISODE | National Geographic', NATGEO, 'Travel, Food, & Culture | National Geographic',
      { showTitle: 'Gordon Ramsay: Uncharted', episodeTitle: 'Full episode', season: 3, kind: 'series' }],
    ['David Blaine: Do Not Attempt MEGA Episode | Arctic Circle, Brazil, SE Asia | National Geographic', NATGEO, null,
      { showTitle: 'David Blaine: Do Not Attempt', episodeTitle: 'Arctic Circle, Brazil, SE Asia', season: null, kind: 'series' }],
    ['Kingdom of the Mummies S1 MEGA EPISODE Compilation | National Geographic', NATGEO, 'Ancient Civilizations | National Geographic',
      { showTitle: 'Kingdom of the Mummies', episodeTitle: 'Full episode', season: 1, kind: 'series' }],
    ['Win or Die: Savage Kingdom MEGA EPISODE | Season 1 | Nat Geo Wild', ANIMALS, 'Savage Kingdom | Nat Geo Animals',
      { showTitle: 'Savage Kingdom', episodeTitle: 'Win or Die', season: 1, kind: 'series' }],
    ['The Story of Us with Morgan Freeman MEGA EPISODE | Season 1 Full Episodes', NATGEO, 'The Story of Us | National Geographic',
      { showTitle: 'The Story of Us', episodeTitle: 'Full episode', season: 1, kind: 'series' }],
    ['Critter Fixers: Ready, Vet, Go | MEGA EPISODE | Nat Geo Wild', ANIMALS, 'Critter Fixers: Country Vets | Nat Geo Wild',
      { showTitle: 'Critter Fixers: Country Vets', episodeTitle: 'Ready, Vet, Go', season: null, kind: 'series' }],
    // A topic playlist is not the show of a compilation that does not mention it.
    ["Tut's Treasures: Hidden Secrets | MEGA Episode | National Geographic", NATGEO, 'Ancient Civilizations | National Geographic',
      { showTitle: "Tut's Treasures: Hidden Secrets", episodeTitle: 'Full film', season: null, kind: 'film' }],
    ["World's Deadliest MEGA EPISODE | Season 1 Full Episodes | Nat Geo Wild", ANIMALS, "World's Deadliest | Nat Geo Wild",
      { showTitle: "World's Deadliest", episodeTitle: 'Full episode', season: 1, kind: 'series' }],
    ['Of the Land (Full Episode) | BRAND NEW SERIES | Life Below Zero: First Alaskans', NATGEO, 'Life Below Zero | National Geographic',
      { showTitle: 'Life Below Zero: First Alaskans', episodeTitle: 'Of the Land', season: null, kind: 'series' }],
    ["🔴 LIVE: Investigating the World's Biggest Sharks | LIVESTREAM | Nat Geo Animals", ANIMALS, 'SharkFest | Nat Geo Animals',
      { showTitle: "Investigating the World's Biggest Sharks", episodeTitle: 'Full film', season: null, kind: 'film' }],
    ['Lost Gold of WWII: TREASURE TUNNEL UNCOVERED (Season 2) | New Episodes Tuesdays at 9/8c | History', HISTORY, 'Weird & Fun Knowledge',
      { showTitle: 'Lost Gold of WWII', episodeTitle: 'TREASURE TUNNEL UNCOVERED', season: 2, kind: 'series' }],
    ['Vikings: Bjorn Says Goodbye | The Ice Maiden Airs Jan. 15 at 10/9c | History', HISTORY, 'Ancient History & Archaeology',
      { showTitle: 'Vikings', episodeTitle: 'Bjorn Says Goodbye', season: null, kind: 'series' }],
    ['Alone: Fear Your Mind Teaser - Season 2 Premieres April 21 9/8c | History', HISTORY, null, // 'Alone: Top 20 Most Watched' is generic in catalog.js
      { showTitle: 'Alone', episodeTitle: 'Fear Your Mind Teaser', season: 2, kind: 'series' }],
    ['Season 3 of “The Secret of Skinwalker Ranch” - New Episodes Wednesdays at 9/8c | The HISTORY Channel', HISTORY, null,
      { showTitle: 'The Secret of Skinwalker Ranch', episodeTitle: 'Full episode', season: 3, kind: 'series' }],
    ['The Diesel Brothers Are BACK! | Mon Sep 4 9p', DISCOVERY, 'Diesel Brothers',
      { showTitle: 'Diesel Brothers', episodeTitle: 'The Diesel Brothers Are BACK!', season: null, kind: 'series' }],
    // HISTORY marathons: the marker goes, the show is the other segment or the colon prefix.
    ['How the Solar System Formed | *MARATHON* | The Universe', HISTORY, 'Full Episode Marathons | History',
      { showTitle: 'The Universe', episodeTitle: 'How the Solar System Formed', season: null, kind: 'series' }],
    ['Cosmic Clues Through Time *Marathon* | Ancient Aliens', HISTORY, null,
      { showTitle: 'Ancient Aliens', episodeTitle: 'Cosmic Clues Through Time', season: null, kind: 'series' }],
    ['Roadside Relics and Risky Big-Ticket Finds *Marathon* American Pickers', HISTORY, null,
      { showTitle: 'American Pickers', episodeTitle: 'Roadside Relics and Risky Big-Ticket Finds', season: null, kind: 'series' }],
    ['Life After People: What Happens When Humans VANISH FROM EARTH? *Marathon* | History', HISTORY, 'Full Episode Marathons | History',
      { showTitle: 'Life After People', episodeTitle: 'What Happens When Humans VANISH FROM EARTH?', season: null, kind: 'series' }],
    ['Christmas Day Marathon | The Incredible Dr. Pol', ANIMALS, null,
      { showTitle: 'The Incredible Dr. Pol', episodeTitle: 'Christmas Day', season: null, kind: 'series' }],
    ['Is It Possible to Run a Marathon in Under 2 Hours? | Breaking2', NATGEO, null,
      { showTitle: 'Breaking2', episodeTitle: 'Is It Possible to Run a Marathon in Under 2 Hours?', season: null, kind: 'series' }],
  ];
  const PROMO = /^(\*?\s*(super |\d+ hour )?marathon\s*\*?|(s\d+ )?mega episodes?|livestream|live stream|brand new series|new series|full episodes?|new episodes.*|.*\d\/\d+c.*)$/i;
  for (const [title, src, playlist, want] of cases) {
    const got = parse(title, src, playlist);
    assert.deepEqual(pick(got), want, title);
    assert.doesNotMatch(got.showTitle, PROMO, title);
    assert.ok(got.showTitle.length > 2, title);
  }
});

test('playlist season names group with the series', () => {
  const cases = [
    ['The Curse of Oak Island: Burned Pottery Linked to Historic Artifact (Season 8) | History', HISTORY,
      'The Curse of Oak Island: Season: 8 | New Episodes Tuesdays at 9/8c | History', 'The Curse of Oak Island', 'Burned Pottery Linked to Historic Artifact', 8],
    ['The Curse of Oak Island: Top 3 WILDEST Treasure Theories (Season 11) | History', HISTORY,
      'The Curse of Oak Island (Season 11)', 'The Curse of Oak Island', 'Top 3 WILDEST Treasure Theories', 11],
    ['Vikings: Ragnar is Baptized (Season 3, Episode 9) | History', HISTORY,
      'Vikings: Season 3 - Official Playlist | History', 'Vikings', 'Ragnar is Baptized', 3],
    ["America's Public Defense System Is in Crisis", VICE, 'Season 6 | VICE on HBO', 'VICE on HBO', "America's Public Defense System Is in Crisis", 6],
    ['Hanukkah at the White House | History Honors 250', HISTORY, 'History Honors 250', 'History Honors 250', 'Hanukkah at the White House', null],
  ];
  for (const [title, src, playlist, show, episode, season] of cases) {
    const got = parse(title, src, playlist);
    assert.equal(got.showTitle, show, title);
    assert.equal(got.episodeTitle, episode, title);
    assert.equal(got.season, season, title);
    assert.equal(got.kind, 'series', title);
  }
});

test('VICE News Tonight full episodes and segments are one show, with or without the playlist', () => {
  const titles = [
    ['Opioid-Addicted Mothers & Iraq Peace: VICE News Tonight Full Episode (HBO)', 'Opioid-Addicted Mothers & Iraq Peace'],
    ['Dr. Phil of VR & Korean War Missing Bodies: VICE News Tonight Full Episode', 'Dr. Phil of VR & Korean War Missing Bodies'],
    ['Iowa State Fair & Vegas Pig Farm: VICE News Tonight on HBO Full Episode', 'Iowa State Fair & Vegas Pig Farm'],
    ['Venezuela\'s Armed Civilians & Homeless App: VICE News Tonight Full Episode (HBO)', "Venezuela's Armed Civilians & Homeless App"],
    ['Gaza Unrest & Investigating Trump | VICE News Tonight Full Episode (HBO)', 'Gaza Unrest & Investigating Trump'],
  ];
  for (const playlist of [null, 'VICE News Tonight Full Episodes (HBO)']) {
    for (const [title, episode] of titles) {
      assert.deepEqual(pick(parse(title, VICE, playlist)), { showTitle: 'VICE News Tonight', episodeTitle: episode, season: null, kind: 'series' }, `${title} / ${playlist}`);
    }
  }
  // A topic playlist does not win over a title that names the show.
  assert.equal(parse('Paris Is Out, And So Is Coal: VICE News Tonight Full Episode (HBO)', VICE, 'VICE News Climate Coverage').showTitle, 'VICE News Tonight');
  assert.equal(parse('Are Cow Burps Destroying New Zealand?', VICE, 'VICE News Tonight on VICE TV').showTitle, 'VICE News Tonight');
  assert.equal(parse('A Drug Called Krokodil', VICE, 'VICE News Tonight Segments (HBO)').showTitle, 'VICE News Tonight');
  // Correspondent collections stay as they are.
  assert.equal(parse('Inside a Drug Den', VICE, 'Shawna Thomas: VICE News Tonight (HBO)').showTitle, 'Shawna Thomas: VICE News Tonight');
});

test('episode titles keep their own wording instead of a made-up "Episode N"', () => {
  const cases = [
    ['The Stuarts - A Bloody Reign | Episode 1 | James I | Free Documentary History', FREEDOC, null, 'The Stuarts - A Bloody Reign', 'James I', 1],
    ['Raiders of the Lost Art | Episode 3 | The Monuments Men | Free Documentary History', FREEDOC, null, 'Raiders of the Lost Art', 'The Monuments Men', 3],
    ["Hitler's Lost Battles | Part 2 | Free Documentary History", FREEDOC, null, "Hitler's Lost Battles", 'Part 2', 2],
    ['The Vietnam War | Part 3 | Fallout & Recovery | Free Documentary History', FREEDOC, null, 'The Vietnam War', 'Fallout & Recovery', 3],
    ['Murder in the Amazon (Documentary): Part 2/2', VICE, null, 'Murder in the Amazon (Documentary)', 'Part 2 of 2', 2],
  ];
  for (const [title, src, playlist, show, episode, number] of cases) {
    const got = parseTitle(title, { ...src, playlistTitle: playlist, playlistGeneric: !playlist });
    assert.equal(got.showTitle, show, title);
    assert.equal(got.episodeTitle, episode, title);
    assert.equal(got.number, number, title);
    assert.doesNotMatch(got.episodeTitle, /^Episode \d+$/, title);
  }
});

test('numbers inside words and entities are not markers', () => {
  const cases = [
    ['Legendary Ships 100 Years Apart | National Geographic Documentary Films', NATGEO, null, 'Legendary Ships 100 Years Apart'],
    ['Rainforests 101 | National Geographic', NATGEO, null, 'Rainforests 101'],
    ["Tony Wants 1000 Ounces of Gold! | Gold Rush | Discovery", DISCOVERY, null, 'Gold Rush'],
    ['Naples &#038; Campania | Tucci in Italy | National Geographic', NATGEO, null, 'Tucci in Italy'],
  ];
  for (const [title, src, playlist, show] of cases) assert.equal(parse(title, src, playlist).showTitle, show, title);
  assert.equal(parse("Tony Wants 1000 Ounces of Gold! | Gold Rush | Discovery", DISCOVERY).episodeTitle, 'Tony Wants 1000 Ounces of Gold!');
  assert.equal(parse('Naples &#038; Campania | Tucci in Italy | National Geographic', NATGEO).episodeTitle, 'Naples & Campania');
  assert.equal(parse("Alone: Correy's 10 Survival Items (Season 7) | Exclusive | History", HISTORY, 'Alone | History').episodeTitle, "Alone: Correy's 10 Survival Items");
  // FRONTLINE multi-part films keep the part wording (grouping the parts is the catalogue's job).
  const p1 = parse('Money, Power and Wall Street, Part One (full documentary) | FRONTLINE', FRONTLINE);
  assert.equal(p1.showTitle, 'Money, Power and Wall Street, Part One');
  assert.equal(p1.kind, 'film');
});

test('Arabic titles parse exactly as before', () => {
  // Expected values recorded from the parser before this change (HEAD 012c753); every Arabic-source
  // video in the snapshot (11,319) parses identically except five Asharq "موسم X" episode subtitles
  // (see the Asharq season test below).
  const cases = [
    ['اللهاث | كوكبنا العجيب | ناشونال جيوغرافيك أبوظبي', { profile: 'natgeo', playlistTitle: 'كوكبنا العجيب', playlistGeneric: false, playlistSize: 1 },
      { showTitle: 'كوكبنا العجيب', episodeTitle: 'اللهاث', number: null, season: null, kind: 'series', label: null }],
    ['مخالب قاتلة |عندما تهاجم الحيوانات المفترسة | ناشونال جيوغرافيك أبوظبي', { profile: 'natgeo', playlistTitle: null, playlistGeneric: true, playlistSize: 343 },
      { showTitle: 'عندما تهاجم الحيوانات المفترسة', episodeTitle: 'مخالب قاتلة', number: null, season: null, kind: 'series', label: null }],
    ['صيد دموي - أجواء قاسية - الحلقة 12 - الموسم الأول | الشرق ديسكفري', { profile: 'asharq', playlistTitle: 'صيد دموي', playlistGeneric: false, playlistSize: 54 },
      { showTitle: 'صيد دموي', episodeTitle: 'أجواء قاسية', number: 12, season: 1, kind: 'series', label: null }],
    ['مواقع غامضة - أتلانتس السوفيتية - الحلقة 9 - الموسم الثالث | الشرق ديسكفري', { profile: 'asharq', playlistTitle: 'المواقع الغامضة', playlistGeneric: false, playlistSize: 52 },
      { showTitle: 'مواقع غامضة', episodeTitle: 'أتلانتس السوفيتية', number: 9, season: 3, kind: 'series', label: null }],
    ['وثائقي | يوميات كورونا | وثائقية دي دبليو', { profile: 'dw', playlistTitle: 'سلسلة وثائقيات | أزمة كورونا | وثائقية دي دبليو', playlistGeneric: false, playlistSize: 17 },
      { showTitle: 'أزمة كورونا', episodeTitle: 'يوميات كورونا', number: null, season: null, kind: 'series', label: 'وثائقي' }],
    ['تقرير | الجنائز في زمن الجائحة | وثائقية دي دبليو', { profile: 'dw', playlistTitle: 'مراسلون  | وثائقية دي دبليو', playlistGeneric: false, playlistSize: 358 },
      { showTitle: 'الجنائز في زمن الجائحة', episodeTitle: 'الفيلم الكامل', number: null, season: null, kind: 'film', label: 'تقرير' }],
    ['ذاكرة السينما المصرية.. كيف تغيّرت بعد حرب أكتوبر؟ | الجزء الرابع', { profile: 'aljazeera', playlistTitle: 'فنون وثقافات', playlistGeneric: false, playlistSize: 111, playlistSeries: false },
      { showTitle: 'ذاكرة السينما المصرية.. كيف تغيّرت بعد حرب أكتوبر؟ | الجزء الرابع', episodeTitle: 'الفيلم الكامل', number: null, season: null, kind: 'film', label: null }],
    ['دوري رمضان - المغرب', { profile: 'aljazeera', playlistTitle: null, playlistGeneric: true, playlistSize: 747 },
      { showTitle: 'دوري رمضان - المغرب', episodeTitle: 'الفيلم الكامل', number: null, season: null, kind: 'film', label: null }],
  ];
  for (const [title, ctx, want] of cases) assert.deepEqual(parseTitle(title, ctx), want, title);
});

test('a title that starts with its playlist\'s whole two-part name keeps none of it in the episode title', () => {
  const pickN = (r) => ({ ...pick(r), number: r.number });
  const cases = [
    // The name has its own colon: the colon after the first word is not where the show name ends.
    ['Swamp People: Serpent Invasion: DANGER IN THE EVERGLADES (Season 2) | History', HISTORY,
      'Swamp People: Serpent Invasion: Season 2 | New Episodes Thursdays at 9/8c | History',
      { showTitle: 'Swamp People: Serpent Invasion', episodeTitle: 'DANGER IN THE EVERGLADES', season: 2, kind: 'series', number: null }],
    ['D-Day: The Unheard Tapes: Storming the Atlantic Wall (S1) | History', HISTORY, 'D-Day: The Unheard Tapes | Official Series Playlist | History',
      { showTitle: 'D-Day: The Unheard Tapes', episodeTitle: 'Storming the Atlantic Wall', season: 1, kind: 'series', number: null }],
    ['America’s Book of Secrets: The White House – Center of Power (Part 4) | History', HISTORY, "America's Book of Secrets: The White House - Full Episode | History",
      { showTitle: "America's Book of Secrets: The White House", episodeTitle: 'Center of Power', season: null, kind: 'series', number: 4 }],
    ["Vikings: 'The Real Vikings' - Ragnar's Sons | History", HISTORY, "Vikings: 'The Real Vikings' Season 4 | History",
      { showTitle: "Vikings: 'The Real Vikings'", episodeTitle: "Ragnar's Sons", season: 4, kind: 'series', number: null }],
    ['Genius: Aretha Chain of Fools Trailer | National Geographic', NATGEO, 'Genius: Aretha | National Geographic',
      { showTitle: 'Genius: Aretha', episodeTitle: 'Chain of Fools Trailer', season: null, kind: 'series', number: null }],
    // Only the name (and number or season markers) left: the part label or a full episode.
    ['America’s Book of Secrets: Deadly Cults (Part 1) | History', HISTORY, "America's Book of Secrets: Deadly Cults - Full Episode | History",
      { showTitle: "America's Book of Secrets: Deadly Cults", episodeTitle: 'Part 1', season: null, kind: 'series', number: 1 }],
    ['Permanently Temporary: The Truth About Temp Labor (Part 2/5)', VICE, 'Permanently Temporary: The Truth About Temp Labor',
      { showTitle: 'Permanently Temporary: The Truth About Temp Labor', episodeTitle: 'Part 2 of 5', season: null, kind: 'series', number: 2 }],
    ['Gordon Ramsay: Uncharted | S3 MEGA EPISODE | National Geographic', NATGEO, 'Gordon Ramsay: Uncharted | National Geographic',
      { showTitle: 'Gordon Ramsay: Uncharted', episodeTitle: 'Full episode', season: 3, kind: 'series', number: null }],
    ['Dian Fossey: Secrets in the Mist | National Geographic', NATGEO, 'Dian Fossey: Secrets in the Mist | National Geographic',
      { showTitle: 'Dian Fossey: Secrets in the Mist', episodeTitle: 'Full episode', season: null, kind: 'series', number: null }],
    ['Critter Fixers: Country Vets | MEGA EPISODE | Nat Geo Animals', ANIMALS, 'Critter Fixers: Country Vets | Nat Geo Wild',
      { showTitle: 'Critter Fixers: Country Vets', episodeTitle: 'Full episode', season: null, kind: 'series', number: null }],
    // The quote closing a quoted name is part of the name.
    ['Season 3 of “The Secret of Skinwalker Ranch” - New Episodes Wednesdays at 9/8c | The HISTORY Channel', HISTORY, 'The Secret of Skinwalker Ranch: Season 3 | History',
      { showTitle: 'The Secret of Skinwalker Ranch', episodeTitle: 'Full episode', season: 3, kind: 'series', number: null }],
    // A title that only shares the name before the colon names its own episode after it.
    ['Critter Fixers: Ready, Vet, Go | MEGA EPISODE | Nat Geo Wild', ANIMALS, 'Critter Fixers: Country Vets | Nat Geo Wild',
      { showTitle: 'Critter Fixers: Country Vets', episodeTitle: 'Ready, Vet, Go', season: null, kind: 'series', number: null }],
    // A one-part name that only begins the title's phrase stays in it.
    ['Venezuela Is Losing Its War on Infectious Diseases', VICE, 'Venezuela',
      { showTitle: 'Venezuela', episodeTitle: 'Venezuela Is Losing Its War on Infectious Diseases', season: null, kind: 'series', number: null }],
    ["Titanic's Lookout | History", HISTORY, 'Titanic | History',
      { showTitle: 'Titanic', episodeTitle: "Titanic's Lookout", season: null, kind: 'series', number: null }],
    ['Inside the Luxury Ship | National Geographic', NATGEO, 'Inside | National Geographic',
      { showTitle: 'Inside', episodeTitle: 'Inside the Luxury Ship', season: null, kind: 'series', number: null }],
  ];
  for (const [title, src, playlist, want] of cases) assert.deepEqual(pickN(parse(title, src, playlist)), want, title);
});

test('a broadcast promo before the title announces the whole title, not an episode of the name before its colon', () => {
  const cases = [
    // Uploads list only (poll.yml): the promo is the title's own segment, or a segment before it.
    ['Premiere Episode of Naked And Afraid: Apocalypse | Discovery', DISCOVERY, null,
      { showTitle: 'Naked And Afraid: Apocalypse', episodeTitle: 'Premiere Episode', season: null, kind: 'series' }],
    ['New Series, New Survival Battles 🔥🏹 Naked and Afraid: Global Showdown | Discovery', DISCOVERY, null,
      { showTitle: 'Naked and Afraid: Global Showdown', episodeTitle: 'New Series, New Survival Battles', season: null, kind: 'series' }],
    // In the spin-off's own playlist the title is only its name: the promo is the episode's only name.
    ['New Series, New Survival Battles 🔥🏹 Naked and Afraid: Global Showdown | Discovery', DISCOVERY, 'Naked and Afraid: Global Showdown',
      { showTitle: 'Naked and Afraid: Global Showdown', episodeTitle: 'New Series, New Survival Battles', season: null, kind: 'series' }],
    // A promo after the title is the broadcast slot of an episode of the show before the colon
    // (HISTORY writes "Show: Clip | New Series Premieres ..." for a new show's clips).
    ['SIX: A Mission Close to Home | New Series Premieres Jan 18 10/9c | History', HISTORY, null,
      { showTitle: 'SIX', episodeTitle: 'A Mission Close to Home', season: null, kind: 'series' }],
    ['Join Or Die with Craig Ferguson: Is Money Evil? - New Series Thursdays 11/10c | History', HISTORY, null,
      { showTitle: 'Join Or Die with Craig Ferguson', episodeTitle: 'Is Money Evil?', season: null, kind: 'series' }],
    ['Vikings: Bjorn Says Goodbye | The Ice Maiden Airs Jan. 15 at 10/9c | History', HISTORY, null,
      { showTitle: 'Vikings', episodeTitle: 'Bjorn Says Goodbye', season: null, kind: 'series' }],
  ];
  for (const [title, src, playlist, want] of cases) {
    const got = parse(title, src, playlist);
    assert.deepEqual(pick(got), want, `${title} / ${playlist}`);
    assert.doesNotMatch(got.showTitle, /^(premiere|new series)/i, title);
  }
});

test('a spin-off announced by a promo before its title is not folded into the parent show\'s playlist', () => {
  // Rq9HvHgOV5E sits in both "Naked and Afraid" and "Naked and Afraid: Global Showdown" (gen 37). The
  // first non-generic playlist read wins in catalog.js, so every playlist must give the same show.
  const cases = [
    ['New Series, New Survival Battles 🔥🏹 Naked and Afraid: Global Showdown | Discovery', DISCOVERY,
      [null, 'Naked and Afraid', 'Naked and Afraid: Global Showdown'],
      { showTitle: 'Naked and Afraid: Global Showdown', episodeTitle: 'New Series, New Survival Battles', season: null, kind: 'series' }],
    ['Premiere Episode of Naked And Afraid: Apocalypse | Discovery', DISCOVERY,
      [null, 'Naked and Afraid', 'Naked And Afraid: Apocalypse'],
      { showTitle: 'Naked And Afraid: Apocalypse', episodeTitle: 'Premiere Episode', season: null, kind: 'series' }],
    // The playlist is still the show when the title is only its name...
    ['New Season Sneak Peek | Alaska: The Last Frontier', DISCOVERY, [null, 'Alaska: The Last Frontier', 'Alaska'],
      { showTitle: 'Alaska: The Last Frontier', episodeTitle: 'New Season Sneak Peek', season: null, kind: 'series' }],
    ['New Season May 8 | Deadliest Catch | Discovery', DISCOVERY, [null, 'Deadliest Catch'],
      { showTitle: 'Deadliest Catch', episodeTitle: 'New Season May 8', season: null, kind: 'series' }],
  ];
  for (const [title, src, playlists, want] of cases) {
    for (const playlist of playlists) assert.deepEqual(pick(parse(title, src, playlist)), want, `${title} / ${playlist}`);
  }
  // ...or ends with it, and without a promo before it the title is an episode of the playlist's show.
  assert.deepEqual(pick(parse('New Series | Gnats from Hell: Naked and Afraid', DISCOVERY, 'Naked and Afraid')),
    { showTitle: 'Naked and Afraid', episodeTitle: 'Gnats from Hell', season: null, kind: 'series' });
  assert.deepEqual(pick(parse('Naked and Afraid: Gnats from Hell | Discovery', DISCOVERY, 'Naked and Afraid')),
    { showTitle: 'Naked and Afraid', episodeTitle: 'Gnats from Hell', season: null, kind: 'series' });
  assert.deepEqual(pick(parse('Critter Fixers: Ready, Vet, Go | MEGA EPISODE | Nat Geo Wild', ANIMALS, 'Critter Fixers: Country Vets | Nat Geo Wild')),
    { showTitle: 'Critter Fixers: Country Vets', episodeTitle: 'Ready, Vet, Go', season: null, kind: 'series' });
  // A new series sharing the name before the colon is announced as its own show, not filed under the playlist.
  assert.equal(parse('NEW SERIES | Critter Fixers: Ready, Vet, Go | Nat Geo Wild', ANIMALS, 'Critter Fixers: Country Vets | Nat Geo Wild').showTitle,
    'Critter Fixers: Ready, Vet, Go');
});

test('a segment that is only a season marker lends its season; the next segment is the show', () => {
  const cases = [
    // Uploads list only: the show is the segment after the season marker.
    ['Who Made The Most Innovative Mash?! | Season 12 | Moonshiners | Discovery', DISCOVERY, null,
      { showTitle: 'Moonshiners', episodeTitle: 'Who Made The Most Innovative Mash?!', season: 12, kind: 'series' }],
    ['The Most Disturbing Discovery Yet 😨 (S7) | The Secret of Skinwalker Ranch', HISTORY, null,
      { showTitle: 'The Secret of Skinwalker Ranch', episodeTitle: 'The Most Disturbing Discovery Yet', season: 7, kind: 'series' }],
    // In the show's playlist, the channel name glued to the show's ("Deadliest Catch Discovery") goes.
    ['The Best Tide-Defying Moments | Season 19 | Deadliest Catch Discovery', DISCOVERY, 'Deadliest Catch',
      { showTitle: 'Deadliest Catch', episodeTitle: 'The Best Tide-Defying Moments', season: 19, kind: 'series' }],
    ['Who Made The Most Innovative Mash?! | Season 12 | Moonshiners | Discovery', DISCOVERY, 'Moonshiners',
      { showTitle: 'Moonshiners', episodeTitle: 'Who Made The Most Innovative Mash?!', season: 12, kind: 'series' }],
    // No segment after the marker: the title is read as one part and keeps the marker's season.
    ['Vikings: Stunts & Fights - Behind the Scenes | Season 4 | History', HISTORY, null,
      { showTitle: 'Vikings', episodeTitle: 'Stunts & Fights - Behind the Scenes', season: 4, kind: 'series' }],
    ['Who Made The Most Innovative Mash?! | Season 12 | Discovery', DISCOVERY, 'Moonshiners',
      { showTitle: 'Moonshiners', episodeTitle: 'Who Made The Most Innovative Mash?!', season: 12, kind: 'series' }],
  ];
  for (const [title, src, playlist, want] of cases) assert.deepEqual(pick(parse(title, src, playlist)), want, `${title} / ${playlist}`);
});

test('Asharq: unnumbered season words stay season markers; only "موسم X" names the episode', () => {
  const ASHARQ = (playlistTitle) => ({ profile: 'asharq', playlistTitle, playlistGeneric: !playlistTitle, playlistSize: 54 });
  for (const playlist of [null, 'صيد دموي']) {
    for (const word of ['الموسم الأخير', 'الموسم الأخيرة', 'الموسم الجديد', 'الموسم الحالي', 'موسم جديد', 'الموسم']) {
      const got = parseTitle(`صيد دموي - الحلقة 10 - ${word} | الشرق ديسكفري`, ASHARQ(playlist));
      assert.deepEqual([got.showTitle, got.episodeTitle, got.number, got.season], ['صيد دموي', 'الحلقة 10', 10, null], `${word} / ${playlist}`);
    }
    const finale = parseTitle('Gold Rush - الحلقة 3 - Season Finale | الشرق ديسكفري', ASHARQ(playlist));
    assert.deepEqual([finale.showTitle, finale.episodeTitle, finale.number, finale.season], ['Gold Rush', 'الحلقة 3', 3, null], `Season Finale / ${playlist}`);
    const numbered = parseTitle('صيد دموي - أجواء قاسية - الحلقة 12 - الموسم الأول | الشرق ديسكفري', ASHARQ(playlist));
    assert.deepEqual([numbered.episodeTitle, numbered.number, numbered.season], ['أجواء قاسية', 12, 1], `numbered / ${playlist}`);
  }
  // "موسم الرياح" ("the windy season") is the episode's name, as in the snapshot.
  const windy = parseTitle('حمى الذهب.. إنقاذ أصحاب المناجم - موسم الرياح - الحلقة 9 - الموسم الثالث | الشرق ديسكفري', ASHARQ(null));
  assert.deepEqual([windy.showTitle, windy.episodeTitle, windy.number, windy.season], ['حمى الذهب.. إنقاذ أصحاب المناجم', 'موسم الرياح', 9, 3]);
  const crab = parseTitle('صيد دموي - موسم صيد السلطعون - الحلقة 1 - الموسم الأول | الشرق ديسكفري', ASHARQ('صيد دموي'));
  assert.deepEqual([crab.episodeTitle, crab.number, crab.season], ['موسم صيد السلطعون', 1, 1]);
});

test('relativeToMs reads English and French listings and keeps Arabic as before', () => {
  const D = 864e5;
  const cases = [
    ['3y ago', 3 * 365 * D], ['5mo ago', 150 * D], ['2w ago', 14 * D], ['4d ago', 4 * D], ['7h ago', 7 * 3600e3], ['12 min ago', 12 * 60e3],
    ['Streamed 3y ago', 3 * 365 * D], ['Streamed 2w ago', 14 * D], ['3 weeks ago', 21 * D], ['Streamed 2 days ago', 2 * D],
    ['Premiered 1 month ago', 30 * D], ['an hour ago', 3600e3],
    ['il y a 3 a', 3 * 365 * D], ['il y a 3 m.', 90 * D], ['il y a 2 sem.', 14 * D], ['il y a 4 j', 4 * D], ['il y a 5 h', 5 * 3600e3],
    ['il y a 3 semaines', 21 * D], ['Diffusé il y a un an', 365 * D],
    // Arabic, unchanged
    ['قبل 3 أيام', 3 * D], ['قبل يومين', 2 * D], ['قبل أسبوعين', 14 * D], ['قبل شهر واحد', 30 * D], ['خلال 3 أشهر', 90 * D],
    ['قبل سنة واحدة', 365 * D], ['قبل سنتين', 730 * D], ['تم البث قبل 2 سنوات', 730 * D], ['قبل 5 ساعات', 5 * 3600e3],
  ];
  for (const [text, ms] of cases) assert.equal(relativeToMs(text), ms, text);
  for (const text of ['Premieres in 2 days', "C'est pas sorcier", 'National Geographic', 'FRONTLINE PBS | Official', '', null]) {
    assert.equal(relativeToMs(text ?? undefined), null, String(text));
  }
});

test('cleanDescription: entity text and ranks are not hashtags; hashtag lines still go', () => {
  const swan = "A look at the controversial 2004 reality series The Swan, which took self-proclaimed &#8216;ugly ducklings' and set out to make them beautiful.";
  assert.equal(cleanDescription(swan), swan);
  assert.equal(cleanDescription('Putting the &#8216;real&#8217; back into reality TV, the award-winning series with no narrator.'), 'Putting the &#8216;real&#8217; back into reality TV, the award-winning series with no narrator.');
  assert.equal(cleanDescription("don&#39;t even have names yet."), "don&#39;t even have names yet.");
  assert.equal(cleanDescription('Bill Nye discusses the #1 problem humans face.\nHe was ranked #3 in the world and #10 overall.'),
    'Bill Nye discusses the #1 problem humans face.\nHe was ranked #3 in the world and #10 overall.');
  assert.equal(cleanDescription('Research conducted under NOAA permit #14245'), 'Research conducted under NOAA permit #14245');
  const out = cleanDescription('Sharks hunt at night.\n#NatGeo #SharkFest\nWatch the full story. #Sharks\nّ#مرسيليا\nOn du, Channel #378\nC# is a language.');
  assert.equal(out, 'Sharks hunt at night.\nC# is a language.');
});
