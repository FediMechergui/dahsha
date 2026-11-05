package app.flixer.stream;

import java.net.URI;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Public player routes emitted by HDToday's migrated source, reviewed 2026-11-03. */
final class HDTodayPlayerPolicy {
    private static final String ID = "[1-9][0-9]{0,9}";
    private static final String SEASON = "[0-9]{1,3}";
    private static final String EPISODE = "[1-9][0-9]{0,4}";
    private static final String TITLE_PATH = "(?:movie/" + ID + "|tv/" + ID + "/" + SEASON + "/" + EPISODE + ")";
    private static final Map<String, Pattern> ROUTES = new HashMap<>();

    private static void routes(String hosts, String path) {
        for (String host : hosts.split(",")) ROUTES.put(host, Pattern.compile(path));
    }

    static {
        routes("vidsrc.mov,vidsrc.fyi,player.vidzee.wtf,embed.vidrift.net,videm.xyz,vidsrc.sh,vidsrc.buzz,apiplayer.ru,nontongo.win,vidapi.xyz,vidapi.ru,vidcore.org,vidlux.xyz,watch.embed-api.stream,nsrplay.space,yapgrid.com,videasy.xyz,megaembed.com", "/embed/" + TITLE_PATH);
        routes("vidrock.net,vidnest.fun,111movies.net,moviesapi.to,vidsrc.su,vidcore.io,vixsrc.to,vidspark.to,vidzen.fun,vidbolt.xyz,embedmaster.link", "/" + TITLE_PATH);
        routes("mappletv.uk", "/embed/" + TITLE_PATH);
        routes("embed.vidsrc.si", "/embed/" + TITLE_PATH + "(?:\\?autoplay=1&ds_lang=en)?");
        routes("vidfast.pro,vidup.to", "/" + TITLE_PATH + "(?:\\?autoPlay=true)?");
        routes("vidlink.pro", "/" + TITLE_PATH + "(?:\\?autoplay=true(?:&title=true)?)?");
        routes("multiembed.mov", "/\\?video_id=" + ID + "&tmdb=1(?:&s=" + SEASON + "&e=" + EPISODE + ")?");
        routes("cinesrc.st", "/embed/(?:movie/" + ID + "|tv/" + ID + "\\?s=" + SEASON + "&e=" + EPISODE + ")");
        routes("embedbandit.com", "/embed/(?:movie\\?tmdb=" + ID + "|tv\\?tmdb=" + ID + "&season=" + SEASON + "&episode=" + EPISODE + ")");
        routes("cinextream.cc", "/api/embed/" + TITLE_PATH);
        routes("net79.cc", "/watch-tmdb/" + ID + "\\?type=(?:movie|tv&season=" + SEASON + "&episode=" + EPISODE + ")");
        routes("nxsha.screenscape.me", "/embed\\?tmdb=" + ID + "&type=(?:movie|tv&s=" + SEASON + "&e=" + EPISODE + ")&lan=eng");
        routes("rivestream.ru", "/watch\\?type=(?:movie&id=" + ID + "|tv&id=" + ID + "&season=" + SEASON + "&episode=" + EPISODE + ")");
        routes("www.2embed.cc", "/(?:embed/" + ID + "|embedtv/" + ID + "&s=" + SEASON + "&e=" + EPISODE + ")");
        routes("autoembed.co", "/(?:movie/tmdb/" + ID + "|tv/tmdb/" + ID + "-" + SEASON + "-" + EPISODE + ")");
        routes("frembed.surf", "/embed/(?:movie/" + ID + "|serie/" + ID + "\\?sa=" + SEASON + "&epi=" + EPISODE + ")");
    }

    private HDTodayPlayerPolicy() {}

    static boolean approved(String value) {
        if (value == null || value.length() > 3000) return false;
        try {
            URI url = new URI(value);
            if (!"https".equals(url.getScheme()) || url.getUserInfo() != null || url.getPort() != -1
                    || url.getHost() == null || url.getFragment() != null) return false;
            Pattern route = ROUTES.get(url.getHost());
            if (route == null) return false;
            String target = url.getRawPath() + (url.getRawQuery() == null ? "" : "?" + url.getRawQuery());
            return route.matcher(target).matches();
        } catch (Exception ignored) { return false; }
    }

    static Set<String> origins() {
        Set<String> origins = new HashSet<>();
        for (String host : ROUTES.keySet()) origins.add("https://" + host);
        return origins;
    }
}
