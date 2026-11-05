package app.flixer.stream;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/** Keep nested player navigation in its frame and prevent ads taking over playback. */
public class PlayerWebViewClient extends BridgeWebViewClient {
    public PlayerWebViewClient(Bridge bridge) { super(bridge); }

    @Override
    public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        android.webkit.WebResourceResponse blocked = PlayerAdBlock.intercept(request);
        return blocked != null ? blocked : super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (PlayerAds.blocked(request.getUrl().toString())) return true;
        Uri target = request.getUrl();
        String scheme = target.getScheme();
        if (!request.isForMainFrame()) return !("https".equals(scheme) || "http".equals(scheme) || "about".equals(scheme) || "blob".equals(scheme));
        String current = view.getUrl();
        if (current != null && current.contains("/watch/")) {
            Uri origin = Uri.parse(current);
            if (!java.util.Objects.equals(origin.getHost(), target.getHost())) {
                // The app's explicit Source link remains usable; player ad destinations do not.
                String host = target.getHost();
                boolean source = "myflixerz.day".equals(host) || "hdtoday.sx".equals(host) || "www.f-movies.org".equals(host);
                if (!(request.hasGesture() && "https".equals(scheme) && source)) return true;
            }
        }
        return super.shouldOverrideUrlLoading(view, request);
    }
}
