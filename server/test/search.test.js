import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, matchesSearch } from '../../shared/search.js';
import { libraryPage } from '../src/library-service.js';

test('search handles conjunctions, punctuation, accents and word order',()=>{
  for(const query of ['happy and gay','happy & gay','happy gay','GAY HAPPY'])assert.ok(matchesSearch('Happy & Gay',query));
  assert.equal(normalizeSearch('Happy &amp; Gay'),'happy and gay');
  assert.ok(matchesSearch('Amélie','amelie'));
  assert.ok(matchesSearch('Schindler’s List','schindlers list'));
  assert.equal(matchesSearch('Happy Holidays','happy and gay'),false);
  assert.equal(matchesSearch('Happy & Gay','...'),false);
});

test('catalogue search finds the punctuation variant without admitting unrelated titles',()=>{
  const catalog={shows:[{id:'happy-gay',title:'Happy & Gay',kind:'film'},{id:'holidays',title:'Happy Holidays',kind:'film'}]};
  assert.deepEqual(libraryPage(catalog,{search:'happy and gay'}).items.map(s=>s.id),['happy-gay']);
});
