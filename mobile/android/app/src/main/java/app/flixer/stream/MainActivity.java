package app.flixer.stream;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private FullscreenChromeClient chromeClient;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlayerViewPlugin.class);
        registerPlugin(DirectVideoPlugin.class);
        super.onCreate(savedInstanceState);
        // A player's service worker does not pass through its WebViewClient.
        // Apply the same narrowly targeted ad rules to that request path.
        PlayerAdBlock.installServiceWorkerFilter();
        chromeClient = new FullscreenChromeClient(getBridge());
        android.webkit.WebView webView = getBridge().getWebView();
        webView.setWebChromeClient(chromeClient);
        getBridge().setWebViewClient(new PlayerWebViewClient(getBridge()));
        if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // Includes inline iframe fallbacks, but never the app's localhost document.
            androidx.webkit.WebViewCompat.addDocumentStartJavaScript(webView,
                PlayerAdBlock.script(this), PlayerViewPlugin.playerOrigins());
        }

        android.webkit.WebSettings settings = webView.getSettings();
        settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // Back button while a video is fullscreen: leave fullscreen instead of navigating back.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (chromeClient != null && chromeClient.isFullscreen()) {
                    chromeClient.onHideCustomView();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
