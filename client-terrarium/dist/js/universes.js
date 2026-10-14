/* Shared universes and franchises, recognised from titles inside the Flixer index. No external
   service: each universe lists title patterns matched against a normalised title.
     "=title"   exact title (a trailing sequel number is allowed: "=cars" also matches "cars 2")
     "^prefix"  title starts with the words
     "words"    title contains the words (whole words)
   Used for the Universe filter, the home rails and the "Related" section of every title. */
(function () {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const compile = p => {
    if (p instanceof RegExp) return p;
    if (p[0] === "=") return new RegExp("^" + esc(p.slice(1)) + "( \\d{1,2})?$", "i");
    if (p[0] === "^") return new RegExp("^" + esc(p.slice(1)) + "(\\b|$)", "i");
    return new RegExp("(^|\\b)" + esc(p) + "(\\b|$)", "i");
  };
  const U = (id, name, short, patterns) => ({ id, name, short, patterns: patterns.map(compile) });
  const UNIVERSES = [
    U("mcu", "Marvel Cinematic Universe", "MCU", ["^iron man", "^captain america", "=thor", "^thor ", "^the avengers", "^avengers", "guardians of the galaxy", "^ant man", "black panther", "doctor strange", "spider man homecoming", "spider man far from home", "spider man no way home", "=black widow", "shang chi", "=eternals", "=the marvels", "^captain marvel", "=wandavision", "=loki", "=hawkeye", "=moon knight", "=ms marvel", "=she hulk", "she hulk attorney at law", "=secret invasion", "=echo", "agatha all along", "=ironheart", "daredevil born again", "^what if", "deadpool and wolverine", "=thunderbolts", "fantastic four first steps", "the incredible hulk", "marvel s"]),
    U("dceu", "DC Extended Universe", "DCEU", ["man of steel", "batman v superman", "^suicide squad", "^the suicide squad", "^wonder woman", "=justice league", "zack snyder s justice league", "^aquaman", "^shazam", "birds of prey", "=black adam", "=the flash", "=blue beetle", "=peacemaker"]),
    U("dcu", "DC Universe", "DCU", ["creature commandos", "=superman", "supergirl woman of tomorrow", "=lanterns", "=peacemaker"]),
    U("dcau", "DC Animated Universe", "DCAU", ["batman the animated series", "the new batman adventures", "superman the animated series", "^batman beyond", "justice league unlimited", "=justice league", "=static shock", "the zeta project", "batman mask of the phantasm", "batman and mr freeze", "batman mystery of the batwoman", "batman beyond return of the joker", "=gotham girls"]),
    U("dc", "DC Comics", "DC", ["^batman", "^the batman", "^superman", "=joker", "joker folie a deux", "the dark knight", "=gotham", "=arrow", "^the flash", "=supergirl", "legends of tomorrow", "black lightning", "=batwoman", "=smallville", "=titans", "doom patrol", "harley quinn", "=pennyworth", "=stargirl", "=watchmen", "=constantine", "=lucifer", "swamp thing", "=the penguin", "green lantern", "=catwoman", "^wonder woman", "^aquaman", "^shazam", "suicide squad", "teen titans", "young justice", "=krypton", "sweet tooth", "the sandman", "dead boy detectives", "justice league", "superman and lois", "=peacemaker", "=blue beetle", "=black adam", "birds of prey", "man of steel", "creature commandos", "my adventures with superman", "the lego batman movie"]),
    U("marvel", "Marvel", "Marvel", ["^x men", "^deadpool", "^the wolverine", "^wolverine", "=logan", "^spider man", "^the amazing spider man", "^venom", "=morbius", "^fantastic four", "^daredevil", "jessica jones", "luke cage", "iron fist", "=the defenders", "^the punisher", "agents of s h i e l d", "agent carter", "=legion", "=the gifted", "=runaways", "cloak and dagger", "=blade", "ghost rider", "=hulk", "=elektra", "kraven the hunter", "madame web", "the new mutants", "dark phoenix", "x men apocalypse", "^iron man", "^captain america", "^thor ", "=thor", "^avengers", "^the avengers", "guardians of the galaxy", "^ant man", "black panther", "doctor strange", "=black widow", "shang chi", "=eternals", "^captain marvel", "=wandavision", "=loki", "=hawkeye", "=moon knight", "=ms marvel", "she hulk", "=secret invasion", "agatha all along", "=ironheart", "=thunderbolts", "silver surfer", "^marvel"]),
    U("starwars", "Star Wars", "Star Wars", ["^star wars", "^the mandalorian", "=andor", "=ahsoka", "obi wan kenobi", "the book of boba fett", "=the acolyte", "the bad batch", "the clone wars", "star wars rebels", "skeleton crew", "rogue one", "solo a star wars story", "=tales of the jedi", "=tales of the empire"]),
    U("startrek", "Star Trek", "Star Trek", ["^star trek"]),
    U("wizarding", "Wizarding World", "Wizarding", ["^harry potter", "^fantastic beasts"]),
    U("middleearth", "Middle-earth", "Tolkien", ["the lord of the rings", "^lord of the rings", "^the hobbit", "the rings of power"]),
    U("monsterverse", "MonsterVerse", "MonsterVerse", ["^godzilla", "godzilla vs kong", "godzilla x kong", "kong skull island", "monarch legacy of monsters"]),
    U("conjuring", "Conjuring Universe", "Conjuring", ["^the conjuring", "^annabelle", "=the nun", "the nun ii", "the curse of la llorona"]),
    U("fast", "Fast & Furious", "Fast", ["fast and furious", "the fast and the furious", "=fast five", "=furious 7", "=fast x", "hobbs and shaw", "2 fast 2 furious"]),
    U("bond", "James Bond", "007", ["james bond", "=dr no", "=from russia with love", "=goldfinger", "=thunderball", "=you only live twice", "=on her majesty s secret service", "=diamonds are forever", "=live and let die", "=the man with the golden gun", "=the spy who loved me", "=moonraker", "=for your eyes only", "=octopussy", "=a view to a kill", "=the living daylights", "=licence to kill", "=goldeneye", "=tomorrow never dies", "=the world is not enough", "=die another day", "=casino royale", "=quantum of solace", "=skyfall", "=spectre", "=no time to die"]),
    U("jurassic", "Jurassic Park", "Jurassic", ["^jurassic"]),
    U("transformers", "Transformers", "Transformers", ["^transformers", "=bumblebee"]),
    U("alien", "Alien & Predator", "Alien", ["=alien", "=aliens", "=alien 3", "=alien resurrection", "=prometheus", "=alien covenant", "=alien romulus", "=alien earth", "=predator", "=predators", "=the predator", "=prey", "=predator badlands", "alien vs predator", "aliens vs predator"]),
    U("terminator", "Terminator", "Terminator", ["^terminator", "^the terminator", "the sarah connor chronicles"]),
    U("matrix", "The Matrix", "Matrix", ["^the matrix", "=matrix"]),
    U("johnwick", "John Wick", "John Wick", ["^john wick", "=the continental", "ballerina from the world of john wick"]),
    U("missionimpossible", "Mission: Impossible", "M:I", ["^mission impossible"]),
    U("rocky", "Rocky & Creed", "Rocky", ["=rocky", "^rocky ii", "^rocky iii", "^rocky iv", "^rocky v", "rocky balboa", "=creed", "^creed ii", "^creed iii"]),
    U("dune", "Dune", "Dune", ["=dune", "dune part two", "dune prophecy"]),
    U("avatar", "Avatar", "Avatar", ["avatar the way of water", "avatar fire and ash", "=avatar"]),
    U("hungergames", "The Hunger Games", "Hunger Games", ["hunger games"]),
    U("twd", "The Walking Dead", "TWD", ["^the walking dead", "fear the walking dead", "daryl dixon", "dead city", "the ones who live", "world beyond", "tales of the walking dead"]),
    U("got", "A Song of Ice and Fire", "GoT", ["game of thrones", "house of the dragon", "a knight of the seven kingdoms"]),
    U("breakingbad", "Breaking Bad", "Breaking Bad", ["breaking bad", "better call saul", "=el camino", "el camino a breaking bad movie"]),
    U("pixar", "Pixar", "Pixar", ["^toy story", "=monsters inc", "=monsters university", "=finding nemo", "=finding dory", "=the incredibles", "=incredibles", "=cars", "=ratatouille", "=wall e", "=up", "=brave", "^inside out", "=the good dinosaur", "=coco", "=onward", "=soul", "=luca", "=turning red", "=lightyear", "=elemental", "=elio", "=a bug s life", "=hoppers"]),
    U("ghibli", "Studio Ghibli", "Ghibli", ["=spirited away", "=my neighbor totoro", "=princess mononoke", "=howl s moving castle", "=kiki s delivery service", "=castle in the sky", "=ponyo", "=the wind rises", "=grave of the fireflies", "=porco rosso", "nausicaa of the valley of the wind", "=the boy and the heron", "=whisper of the heart", "=the cat returns", "=arrietty", "=the secret world of arrietty", "=when marnie was there", "=the tale of the princess kaguya", "=from up on poppy hill", "=tales from earthsea", "=pom poko", "=only yesterday", "=my neighbors the yamadas", "=earwig and the witch"]),
    U("sherlock", "Sherlock Holmes", "Sherlock", ["^sherlock", "=elementary", "^enola holmes"]),
    U("indiana", "Indiana Jones", "Indiana Jones", ["^indiana jones", "raiders of the lost ark"]),
    U("ghostbusters", "Ghostbusters", "Ghostbusters", ["^ghostbusters"]),
    U("planetapes", "Planet of the Apes", "Apes", ["planet of the apes"]),
    U("madmax", "Mad Max", "Mad Max", ["^mad max", "=furiosa", "furiosa a mad max saga"]),
    U("shrek", "Shrek", "Shrek", ["^shrek", "^puss in boots"]),
    U("despicable", "Despicable Me", "Minions", ["^despicable me", "^minions"]),
    U("kungfupanda", "Kung Fu Panda", "Kung Fu Panda", ["^kung fu panda"]),
    U("httyd", "How to Train Your Dragon", "HTTYD", ["how to train your dragon", "dragons riders of berk", "dragons race to the edge", "dragons the nine realms"])
  ];

  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  // Franchise stem: the title before a colon / dash / sequel number, so "Spider-Man 2" and
  // "Spider-Man: No Way Home" share "spider man".
  const stem = s => norm(String(s || "").split(/[:–—\-(]/)[0]).replace(/\b(part|chapter|episode|vol|volume)\b.*$/, "").replace(/\b\d+\b$/, "").replace(/\b(ii|iii|iv|v|vi|vii|viii)\b$/, "").trim();

  function detect(title, extra) {
    const n = norm(title);
    if (!n) return [];
    const out = UNIVERSES.filter(u => u.patterns.some(p => p.test(n))).map(u => u.id);
    if (extra) extra.forEach(u => { if (!out.includes(u.id) && u.patterns.some(p => p.test(n))) out.push(u.id); });
    return out;
  }
  // Patterns derived from a universe's name (for universes that only exist in the Wikidata data):
  // single-word names match as a prefix ("Halloween Kills" yes, "Hubie Halloween" no), longer names
  // match anywhere as whole words ("Pokémon the Movie: …").
  function autoPatterns(name, short) {
    const pats = [];
    const add = s => { const n = norm(s); if (n.length < 4 || /^[a-z]{1,3}$/.test(n)) return; pats.push(n.includes(" ") ? new RegExp("(^|\\b)" + esc(n) + "(\\b|$)", "i") : new RegExp("^" + esc(n) + "(\\b|$)", "i")); };
    add(name); if (short && norm(short) !== norm(name)) add(short);
    return pats;
  }
  // Fuzzy title similarity for matching external records (Wikidata labels) onto index titles.
  const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "at", "for", "vs", "with", "from", "part", "movie", "film", "series", "season", "le", "la", "les", "de", "du"]);
  const tokens = s => norm(s).split(" ").filter(t => t && !STOP.has(t));
  function similarity(a, b) {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach(t => { if (B.has(t)) inter += 1; });
    const jaccard = inter / (A.size + B.size - inter);
    const small = Math.min(A.size, B.size);
    const contained = inter === small && small >= 2 ? 0.85 : 0; // "Detective Pikachu" ⊂ "Pokémon: Detective Pikachu"
    return Math.max(jaccard, contained);
  }

  window.FlixerUniverses = { UNIVERSES, detect, autoPatterns, tokens, similarity, norm, stem, byId: id => UNIVERSES.find(u => u.id === id) || null };
})();
