package app.flixer.stream;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Local request rules: never block a media CDN merely for being third party. */
public final class PlayerAds {
    private PlayerAds() {}
    private static final Set<String> AD_HOSTS=new HashSet<>(Arrays.asList(
        "doubleclick.net","googlesyndication.com","googleadservices.com","adservice.google.com",
        "adsterra.com","adsterra.org","propellerads.com","popads.net","popcash.net",
        "onclicka.com","onclickalgo.com","onclickperformance.com","onclkds.com","onclckmn.com",
        "highperformanceformat.com","highrevenuegate.com","highrevenuecpmnetwork.com",
        "effectivegatecpm.com","effectivecpmrate.com","profitablecpmrate.com","profitableratecpm.com",
        "realsrv.com","exoclick.com","exosrv.com","trafficjunky.net","trafficstars.com",
        "juicyads.com","tsyndicate.com","ad-maven.com","ad-maven.net","adnxs.com",
        "adsrvr.org","pubmatic.com","rubiconproject.com","openx.net","criteo.com",
        "criteo.net","bidvertiser.com","hilltopads.com","hilltopads.net","clickadu.com",
        "clickaine.com","a-ads.com","cointraffic.io","monetag.com","monetag.net",
        // Observed advertising pixels, popunders and audience tracking in player audits.
        "canseealltheugline.org","auknceiwoulddirect.org","histats.com","dtscout.com",
        "dtscdn.com","mrktmtrcs.net","crwdcntrl.net","onaudience.com",
        // Observed Uqload injected advertising/popunder scripts, not media CDNs.
        "uniolaicecaps.com","todditehexarch.com"
    ));
    public static boolean blocked(String value) {
        try {
            URI u=new URI(value);String host=u.getHost();if(host==null)return false;
            host=host.toLowerCase(Locale.ROOT).replaceAll("\\.$", "");
            while(host.contains(".")){if(AD_HOSTS.contains(host))return true;host=host.substring(host.indexOf('.')+1);}
            // Dedicated advertising endpoints, never generic /api, /play or /go paths.
            String path=u.getPath()==null?"":u.getPath().toLowerCase(Locale.ROOT);
            // Observed Uqload TrafficStars popunder loader; keep its media/player scripts.
            if("uqload.vc".equals(u.getHost())&&"/js2/tsl.js".equals(path))return true;
            return path.matches(".*(?:^|/)(?:popunder|popads|adsterra|vast-ads|advertisements)(?:/.*|\\.js)?")
                || path.endsWith("/popunder.js") || path.endsWith("/popads.js");
        } catch(Exception e){return false;}
    }
}
