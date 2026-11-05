package app.flixer.stream;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.Test;
import static org.junit.Assert.*;

public class HDTodayPlayerPolicyTest {
    private List<String> publishedRoutes() throws Exception {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                getClass().getResourceAsStream("/hdtoday-public-player-routes.txt"), StandardCharsets.UTF_8))) {
            return reader.lines().filter(line -> !line.isEmpty() && !line.startsWith("#")).collect(Collectors.toList());
        }
    }

    @Test public void acceptsAllMovieAndEpisodeRoutesPublishedByTheMigratedSource() throws Exception {
        List<String> routes = publishedRoutes();
        assertEquals(88, routes.size());
        for (String url : routes) {
            assertTrue(url, HDTodayPlayerPolicy.approved(url));
            assertTrue(HDTodayPlayerPolicy.origins().contains("https://" + new URI(url).getHost()));
        }
        assertEquals(44, HDTodayPlayerPolicy.origins().size());
    }

    @Test public void newSourcePlayersDoNotAuthorizeOtherPagesOrRedirectParameters() throws Exception {
        for (String url : publishedRoutes()) {
            String host = new URI(url).getHost();
            assertFalse(HDTodayPlayerPolicy.approved("https://" + host + "/account"));
            assertFalse(HDTodayPlayerPolicy.approved(url + (url.contains("?") ? "&" : "?") + "redirect=https://evil.org"));
            assertFalse(HDTodayPlayerPolicy.approved(url.replace("https://", "http://")));
            assertFalse(HDTodayPlayerPolicy.approved(url.replace("https://", "https://user@")));
            assertFalse(HDTodayPlayerPolicy.approved(url.replace(host, host + ".evil.org")));
            assertFalse(HDTodayPlayerPolicy.approved(url.replace(host, host + ":8443")));
            assertFalse(HDTodayPlayerPolicy.approved(url + "#redirect"));
        }
        for (String url : new String[]{
                "https://vixsrc.to/tv/275139/1/../admin", "https://vixsrc.to/tv/275139/1/%2e%2e",
                "https://player.vidzee.wtf/embed/movie/0", "https://vidcore.org/embed/tv/275139/1/-1",
                "https://frembed.surf/embed/serie/275139?sa=1&epi=1&epi=2", "https://evil.org/embed/tv/275139/1/1"}) {
            assertFalse(url, HDTodayPlayerPolicy.approved(url));
        }
        assertFalse(HDTodayPlayerPolicy.origins().contains("https://*.vidzee.wtf"));
    }
}
