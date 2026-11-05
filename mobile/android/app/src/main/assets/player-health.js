(() => {
  let playing = false;
  const send = message => { try { DahshaPlayback.postMessage(message); } catch {} };
  document.addEventListener('timeupdate', event => {
    const video = event.target;
    if (!playing && video instanceof HTMLVideoElement && video.currentTime > 1 && !video.paused && video.getBoundingClientRect().width > 0) {
      playing = true;
      send('playing');
    }
  }, true);
  // Only short, explicit source error pages trigger failover. Loading screens,
  // ordinary synopsis text and browser verification do not become missing files.
  const unavailable = /(?:^|\n)Unable to play media\.?\s*$|Movie not found on available servers\.|The author of this video has not been found or is blocked|(?:^|\n)Embeds disabled\d*\s*$|no video was found for this title|404\)?\s*AN UNEXPECTED ERROR OCCURRED|we can't find the video|we couldn't find this title on any server|video (?:has been|was) (?:removed|deleted)|file (?:not found|was deleted)|(?:^|\n)404(?:\s|[—–-])*Page Not Found\b|We Couldn.t Find This Content\b|403 Forbidden|Sorry, you have been blocked|you are unable to access|we couldn.t find a video for this|this video (?:is not|is no longer) available|ad.?blocker detected|please disable ad.?block|404\)?\s*OOPS! SOMETHING WENT WRONG|this video not found|Enjoy Ad-Free Access[\s\S]*REDEEM YOUR CODE HERE|Error loading player: No playable sources found|404\s+The page you were looking for is not here|Video source is unavailable|Video has been blocked due to author's rights|File is no longer available as it expired or has been deleted|Remove sandboxing to enable playback|Видеофайл не найден/i;
  const check = () => {
    const text = (document.body?.innerText || '').trim();
    if (!playing && text.length < 1800 && unavailable.test(text)) send('missing');
  };
  document.addEventListener('DOMContentLoaded', () => {
    check();
    const observer = new MutationObserver(check);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => observer.disconnect(), 60000);
  }, { once: true });
})();
