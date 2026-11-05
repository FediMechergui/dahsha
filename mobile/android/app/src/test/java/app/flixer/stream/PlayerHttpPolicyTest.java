package app.flixer.stream;

import org.junit.Test;
import java.util.Collections;
import static org.junit.Assert.*;

public class PlayerHttpPolicyTest {
    @Test public void permitsOnlyAnExplicitManagedBrowserCheck() {
        assertTrue(PlayerHttpPolicy.needsBrowserVerification(403,Collections.singletonMap("Cf-Mitigated","challenge")));
        assertFalse(PlayerHttpPolicy.needsBrowserVerification(403,Collections.singletonMap("Server","cloudflare")));
        assertFalse(PlayerHttpPolicy.needsBrowserVerification(404,Collections.singletonMap("cf-mitigated","challenge")));
        assertFalse(PlayerHttpPolicy.needsBrowserVerification(403,null));
    }
}
