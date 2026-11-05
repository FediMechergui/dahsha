package app.flixer.stream;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlayerFailureDiagnosticsTest {
    @Test public void preservesAccessDenialOrVerificationWhenTheFrameIsClosed() {
        PlayerFailureDiagnostics error = new PlayerFailureDiagnostics();
        error.http(451, false);
        error.timeout();
        assertEquals("HTTP_ERROR", error.sourceError());
        assertEquals(451, error.httpStatus());
        assertEquals(0, error.networkErrorCode());
        error.http(403, true);
        error.timeout();
        assertEquals("BROWSER_VERIFICATION", error.sourceError());
        assertEquals(403, error.httpStatus());
        error.network(-1);
        assertEquals("BROWSER_VERIFICATION", error.sourceError());
        assertEquals(403, error.httpStatus());
    }

    @Test public void aNewDocumentOrPlayingVideoClearsPreviousFailureContext() {
        PlayerFailureDiagnostics error = new PlayerFailureDiagnostics();
        error.http(403, true);
        error.clear();
        assertEquals("", error.sourceError());
        assertEquals(0, error.httpStatus());
        error.timeout();
        assertEquals("STARTUP_TIMEOUT", error.sourceError());
        error.clear();
        assertEquals("", error.sourceError());
    }

    @Test public void preservesNetworkCodesWithoutConfusingThemWithMissingMedia() {
        PlayerFailureDiagnostics error = new PlayerFailureDiagnostics();
        error.http(404, false);
        error.network(-2); // WebViewClient.ERROR_HOST_LOOKUP
        assertEquals("NETWORK_ERROR", error.sourceError());
        assertEquals(-2, error.networkErrorCode());
        assertEquals(404, error.httpStatus());
        error.unavailable();
        assertEquals("SOURCE_UNAVAILABLE", error.sourceError());
        assertEquals(0, error.networkErrorCode());
        error.network(Integer.MIN_VALUE);
        assertEquals(-1, error.networkErrorCode());
    }
}
