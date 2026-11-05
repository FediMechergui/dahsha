package app.flixer.stream;

/** Bounded, non-sensitive failure context; never stores URLs, headers or page content. */
final class PlayerFailureDiagnostics {
    private String sourceError = "";
    private int httpStatus;
    private int networkErrorCode;

    void clear() { sourceError = ""; httpStatus = 0; networkErrorCode = 0; }

    void http(int status, boolean verification) {
        clear();
        if (status < 400 || status > 599) return;
        httpStatus = status;
        sourceError = verification ? "BROWSER_VERIFICATION" : "HTTP_ERROR";
    }

    void network(int code) {
        // WebViewClient error constants are negative. Preserve their numeric
        // identity without including an error description or request URL.
        // A secondary network callback must not erase the HTTP response from
        // this document. The next document and successful playback clear it.
        networkErrorCode = code < 0 && code >= -1000 ? code : -1;
        if (!"BROWSER_VERIFICATION".equals(sourceError)) sourceError = "NETWORK_ERROR";
    }

    void unavailable() { clear(); sourceError = "SOURCE_UNAVAILABLE"; }
    void timeout() { if (sourceError.isEmpty()) sourceError = "STARTUP_TIMEOUT"; }
    String sourceError() { return sourceError; }
    int httpStatus() { return httpStatus; }
    int networkErrorCode() { return networkErrorCode; }
}
