package app.flixer.stream;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Set;

public class PlayerAdOriginsTest {
    @Test public void remoteCleanupNeverIncludesAppOrBackendDocuments() {
        Set<String> origins = PlayerViewPlugin.playerOrigins();
        assertTrue(origins.contains("https://vidapi.xyz"));
        assertTrue(origins.contains("https://embos.top"));
        assertTrue(origins.contains("https://emboser.com"));
        assertTrue(origins.contains("https://sv2.nontongo.stream"));
        for (String origin : new String[]{"*", "https://*", "https://localhost", "http://localhost", "https://127.0.0.1", "https://dahsha.netlify.app", "https://*.netlify.app"})
            assertFalse(origin, origins.contains(origin));
    }
}
