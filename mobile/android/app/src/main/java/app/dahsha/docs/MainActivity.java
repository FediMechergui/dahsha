package app.dahsha.docs;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private FullscreenChromeClient chromeClient;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        chromeClient = new FullscreenChromeClient(getBridge());
        getBridge().getWebView().setWebChromeClient(chromeClient);
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
