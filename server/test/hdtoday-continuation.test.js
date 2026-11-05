import test from 'node:test';
import assert from 'node:assert/strict';
import {hdtodayTitleContinuation,fetchHdtodayTitleHtml,parseHdtodayDetails} from '../src/hdtoday.js';

const source='https://hdtoday.sx/watch/tv-documentary-12345678';
const page=target=>`<meta http-equiv="refresh" content="0;url=${target}"><title>hdtoday.sx</title><a href="${target}">continue</a>`;
test('only the exact same-title, visibly advertised ordinary continuation is accepted',()=>{
  const target=source+'?dv1=1';assert.equal(hdtodayTitleContinuation(page(target),source),target);
  for(const target of ['https://other.example/watch/tv-documentary-12345678?dv1=1',source.replace('documentary','unrelated')+'?dv1=1',source+'?dv1=1&s=99',source+'?dv1=1#other',source+'?dv1=2'])assert.equal(hdtodayTitleContinuation(page(target),source),null);
  assert.equal(hdtodayTitleContinuation(page(target).replace('>continue<','>advertisement<'),source),null);
  assert.equal(hdtodayTitleContinuation(page(target)+'<title>Quick check</title>',source),null);
  assert.equal(hdtodayTitleContinuation(page(target),target),null);
  assert.equal(hdtodayTitleContinuation(page(source+'?s=2&e=1&dv1=1'),source+'?s=2&e=1'),source+'?s=2&e=1&dv1=1');
  assert.equal(hdtodayTitleContinuation(page(target),source+'?s=2&e=1'),null);
});

test('title continuation is one bounded extra request and respects cancellation and upstream denials',async()=>{
  const calls=[];
  const html=await fetchHdtodayTitleHtml(source,{fetchPage:async url=>{calls.push(url);return page(source+'?dv1=1');}});
  assert.equal(calls.length,2);assert.equal(calls[1],source+'?dv1=1');assert.equal(html,page(calls[1]));
  const controller=new AbortController();let count=0;
  await assert.rejects(fetchHdtodayTitleHtml(source,{signal:controller.signal,fetchPage:async()=>{count++;controller.abort(Error('Stopped'));return page(source+'?dv1=1');}}),/Stopped/);assert.equal(count,1);
  count=0;await assert.rejects(fetchHdtodayTitleHtml(source,{fetchPage:async()=>{count++;throw Error('HDToday HTTP 403');}}),/403/);assert.equal(count,1);
});

test('season selectors are navigation, never fabricated episode1 slots, and missing TMDB stays missing',()=>{
  const data={'@type':'TVSeries',name:'A documentary',genre:['Documentary'],datePublished:'1971-01-28',numberOfSeasons:54};
  const html=`<script type="application/ld+json">${JSON.stringify(data)}</script>
    <a class="season-pill is-active" href="${source}?s=1&amp;e=1">S1</a>
    <a class="season-pill" href="${source}?s=54&amp;e=1">S54</a>
    <a class="ep-card" href="${source}?s=1&amp;e=3"><span class="ep-card__t">The real episode</span></a>
    <a class="ep-card" href="https://hdtoday.sx/watch/tv-unrelated-12345678?s=1&e=2">Episode 2</a>
    <a href="${source}?s=55&e=1">Some unrelated link</a>`;
  const parsed=parseHdtodayDetails(html,source);
  assert.equal(parsed.tmdbId,null);assert.equal(parsed.documentary,true);assert.equal(parsed.episodes.length,1);
  assert.equal(parsed.episodes[0].number,3);assert.equal(parsed.episodes[0].title,'The real episode');
  assert.deepEqual(parsed.seasons,[1,54]);assert.equal(parsed.seasonSources[54],source+'?s=54&e=1');assert.equal(parsed.episodeGuideComplete,false);
});
