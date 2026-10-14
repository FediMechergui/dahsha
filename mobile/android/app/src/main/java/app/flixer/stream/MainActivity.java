package app.flixer.stream;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private FullscreenChromeClient chromeClient;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        chromeClient = new FullscreenChromeClient(getBridge());
        android.webkit.WebView webView = getBridge().getWebView();
        webView.setWebChromeClient(chromeClient);
        getBridge().setWebViewClient(new PlayerWebViewClient(getBridge()));

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
