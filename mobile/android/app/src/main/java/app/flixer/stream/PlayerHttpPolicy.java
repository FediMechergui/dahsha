package app.flixer.stream;

import java.util.Map;

/** A managed browser check is allowed to run normally, never solved by the app. */
public final class PlayerHttpPolicy {
    private PlayerHttpPolicy() {}
    public static boolean needsBrowserVerification(int status, Map<String,String> headers) {
        if (status != 403 || headers == null) return false;
        for (Map.Entry<String,String> header : headers.entrySet()) {
            if ("cf-mitigated".equalsIgnoreCase(header.getKey()) && "challenge".equalsIgnoreCase(header.getValue())) return true;
        }
        return false;
    }
}
