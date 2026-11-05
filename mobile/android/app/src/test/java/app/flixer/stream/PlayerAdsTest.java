package app.flixer.stream;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlayerAdsTest {
    @org.junit.Test public void uqloadPopunderLoaderDoesNotBlockPlaybackOrAccountChecks(){
        assertTrue(PlayerAds.blocked("https://uqload.vc/js2/tsl.js"));
        assertFalse(PlayerAds.blocked("https://uqload.vc/player/jw8/jwplayer.js"));
        assertFalse(PlayerAds.blocked("https://uqload.vc/ad/pop.adsbox.js"));
        assertFalse(PlayerAds.blocked("https://media.uqload.vc/video.mp4"));
        assertFalse(PlayerAds.blocked("https://other.example/js2/tsl.js"));
        assertTrue(PlayerAds.blocked("https://uj.uniolaicecaps.com/advertising-script"));
        assertTrue(PlayerAds.blocked("https://eo.todditehexarch.com/advertising-script"));
    }
    @Test public void blocksAdHostsAndTheirSubdomainsButNotLookalikes(){
        assertTrue(PlayerAds.blocked("https://ads.doubleclick.net/pagead/video.mp4"));
        assertTrue(PlayerAds.blocked("https://POPCASH.NET./pop.js"));
        assertFalse(PlayerAds.blocked("https://notdoubleclick.net/video.mp4"));
        assertFalse(PlayerAds.blocked("https://doubleclick.net.example.org/video.mp4"));
    }
    @Test public void preservesVideoCdnSubtitlesAndPlaybackApis(){
        for(String url:new String[]{"https://video.wixstatic.com/video/actual/1080p/mp4/file.mp4",
                "https://relay.dessinanime.cc/api/stream-relay/123/master.m3u8",
                "https://s2.savefiles.com/actual/master.m3u8?s=123&e=456",
                "https://cdn.example/video.mp4?referer=https://popads.net/",
                "https://cdn.example/subtitles/ar.vtt","https://player.example/api/play",
                "https://rr1.googlevideo.com/videoplayback"})assertFalse(url,PlayerAds.blocked(url));
    }
    @Test public void blocksDedicatedAdScriptsWithoutBlockingPlayerScripts(){
        assertTrue(PlayerAds.blocked("https://player.example/js/popunder.js"));
        assertTrue(PlayerAds.blocked("https://player.example/advertisements/banner"));
        assertFalse(PlayerAds.blocked("https://player.example/js/player.js"));
        assertFalse(PlayerAds.blocked("https://player.example/download/movie.mp4"));
    }
}
