package app.flixer.stream;

import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** A separate web surface: remote pages never receive the app's Capacitor bridge. */
@CapacitorPlugin(name = "PlayerView")
public class PlayerViewPlugin extends Plugin {
    private NativePlayerSurface playerDialog;
    private WebView playerWebView;
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList(
        "vidsrc.sh", "vsembed.ru", "sv2.nontongo.stream", "www.animegg.org", "abysscdn.com", "rozgarlelo.modiplay.xyz", "streams.iqsmartgames.com", "embed.vidrift.net", "vidout.pages.dev", "embed.filmu.in", "vidbolt.xyz", "youtube.com", "www.youtube.com", "www.youtube-nocookie.com", "embos.top", "mxdrop.click", "mixdrop.top", "hgcloud.to", "vkvideo.ru", "www.ok.ru", "ok.ru", "s1.hdup400.com", "vidzy.cc", "vidzy.org", "rufiiguta.com", "engifuosi.com", "kitraskimisi.com", "tukipasti.com", "player.mediadelivery.net", "playmogo.com", "watch.easyvidplayer.com", "vidcore.io", "vidcore.net", "vidsrc.mov", "vidsrc.fyi", "embed.vidsrc.si", "vidfast.pro", "vidup.to", "vidrock.net", "vidnest.fun", "vidlink.pro", "111movies.net", "multiembed.mov", "mappletv.uk", "moviesapi.to", "vidapi.xyz", "player.vidlove.cc", "mixdrop.ps", "cybervynx.com", "1vid.xyz", "vidmoly.org", "vidspeed.org", "www.mp4upload.com", "bysesukior.com", "bysetayico.com", "doodstream.com", "cima.easyvidplayer.com", "zumivids.com", "cimatnwatchingg.blogspot.com", "embedmaster.link", "fsvid.lol", "kokoflix.lol", "trakx.lol", "uqload.vc", "voe.sx", "doodstream.com", "player.vimeo.com", "www.dailymotion.com", "geo.dailymotion.com", "audinifer.com", "morencius.com", "watch.strp2p.site", "app.videas.fr", "www.vidspeed.org", "uqload.net", "movearnpre.com", "dingtezuni.com", "q7v3k8m2p1.top"
    ));
    // Observed HTTPS destinations of existing provider player redirects.
    static { HOSTS.add("vidfast.vc"); HOSTS.add("streamingnow.mov"); HOSTS.add("sv4.nontongo.day"); HOSTS.add("hglamioz.com"); HOSTS.add("hgplaycdn.com"); HOSTS.add("derricknationtop.com"); HOSTS.add("emboser.com"); }
    static Set<String> playerOrigins(){Set<String> origins=new HashSet<>();for(String host:HOSTS)origins.add("https://"+host);origins.add("https://*.medmedia03.wiki");
        // Observed VidSrc content frame. Telemetry only: this does not authorize
        // new top-level navigation or expose the app's Capacitor bridge.
        origins.add("https://stellarconductornexus.com");origins.addAll(HDTodayPlayerPolicy.origins());return origins;}
    private boolean approved(String value) {
        if (value == null || value.length() > 3000) return false;
        try { Uri u = Uri.parse(value); String host = u.getHost();
            return "https".equals(u.getScheme()) && u.getUserInfo() == null && u.getPort() == -1 && host != null && (HOSTS.contains(host) || host.matches("(?:balance|[1-9])\\.medmedia03\\.wiki") || HDTodayPlayerPolicy.approved(value));
        } catch (Exception e) { return false; }
    }
    private int dp(int value) { return Math.round(value * getContext().getResources().getDisplayMetrics().density); }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (!approved(url)) { call.reject("This player origin is not supported"); return; }
        Uri source=Uri.parse(url);
        boolean observableFile="uqload.vc".equals(source.getHost())&&source.getPath().matches("/embed-[a-zA-Z0-9]+\\.html")
            ||"watch.strp2p.site".equals(source.getHost());
        String session=call.getString("session","");double requestedStart=call.getDouble("startAt",0.0);
        double startAt=Double.isFinite(requestedStart)&&requestedStart>0?requestedStart:0;
        double requestedDuration=call.getDouble("expectedDurationSec",0.0);
        double expectedDuration=Double.isFinite(requestedDuration)&&requestedDuration>0?requestedDuration:0;
        getActivity().runOnUiThread(() -> {
            if (playerDialog != null) { call.reject("A player is already open"); return; }
            NativePlayerSurface dialog = new NativePlayerSurface((com.getcapacitor.BridgeActivity)getActivity(),getBridge().getWebView(),call.getObject("bounds"));
            playerDialog = dialog;
            dialog.setFullscreenListener(expanded->{JSObject state=new JSObject();state.put("session",session);state.put("fullscreen",expanded);notifyListeners("fullscreen",state);});
            String[] reason={"closed"};boolean[] played={false};boolean[] verifying={false};boolean[] challengeDocument={false};double[] latest={0,0};
            PlayerFailureDiagnostics diagnostics=new PlayerFailureDiagnostics();
            android.os.Handler watchdog=new android.os.Handler(android.os.Looper.getMainLooper());
            Runnable startupTimeout=()->{if(dialog.isShowing()&&!played[0]){diagnostics.timeout();reason[0]="failed";dialog.dismiss();}};
            LinearLayout layout = new LinearLayout(getActivity()); layout.setOrientation(LinearLayout.VERTICAL); layout.setBackgroundColor(Color.rgb(12,18,16));
            LinearLayout toolbar = new LinearLayout(getActivity()); toolbar.setPadding(dp(8),dp(6),dp(8),dp(6)); toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
            Button close = new Button(getActivity()); close.setText("Close player"); close.setAllCaps(false); close.setTextSize(14); close.setBackgroundColor(Color.TRANSPARENT); close.setContentDescription("Close in-app player"); close.setTextColor(Color.rgb(243,178,87)); close.setOnClickListener(v -> dialog.dismiss());
            close.setText("Close");toolbar.addView(close,new LinearLayout.LayoutParams(dp(80),dp(48)));
            TextView title = new TextView(getActivity()); title.setText(Uri.parse(url).getHost()); title.setTextColor(Color.rgb(234,240,235)); title.setTextSize(13); title.setMaxLines(1); title.setEllipsize(android.text.TextUtils.TruncateAt.END); toolbar.addView(title,new LinearLayout.LayoutParams(0,dp(44),1));
            Button next=new Button(getActivity());next.setText("Next");next.setContentDescription("Next source");next.setAllCaps(false);next.setOnClickListener(v->{reason[0]="next";dialog.dismiss();});toolbar.addView(next);
            Button restore=new Button(getActivity());restore.setText("Inline");restore.setContentDescription("Exit fullscreen");restore.setOnClickListener(v->dialog.setFullscreen(false));toolbar.addView(restore);
            layout.addView(toolbar);dialog.setToolbar(toolbar);
            FrameLayout stage = new FrameLayout(getActivity()); layout.addView(stage,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1));
            WebView web = new WebView(getActivity()); playerWebView = web; web.setBackgroundColor(Color.BLACK);
            web.setDownloadListener((target,userAgent,contentDisposition,mimeType,length)->{});
            WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setMediaPlaybackRequiresUserGesture(false); settings.setSupportMultipleWindows(true); settings.setJavaScriptCanOpenWindowsAutomatically(false);
            // Apply source context to the WebView itself, so media subrequests also
            // use the published User-Agent rather than only the initial document.
            java.util.Map<String,String> headers=new java.util.HashMap<>();
            JSObject requestedHeaders=call.getObject("headers");
            if(requestedHeaders!=null)for(String key:Arrays.asList("Referer","Origin","User-Agent","Accept-Language")){
                String value=requestedHeaders.optString(key,"");
                if(!value.isEmpty()&&value.length()<2048&&!value.contains("\r")&&!value.contains("\n")){
                    if("User-Agent".equals(key))settings.setUserAgentString(value);else headers.put(key,value);
                }
            }
            android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web,true);
            Set<String> sessionOrigins=playerOrigins();
            if(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))WebViewCompat.addDocumentStartJavaScript(web,PlayerAdBlock.script(getContext()),sessionOrigins);
            // Health messages only; remote pages never receive Capacitor's app bridge.
            if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)&&WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)){
                Set<String> origins=new HashSet<>(sessionOrigins);
                WebViewCompat.addDocumentStartJavaScript(web,
                    PlayerAdBlock.script(getContext(),"player-content.js").replace("/*DAHSHA_EXPECTED_DURATION*/0",Double.toString(expectedDuration)),origins);
                WebViewCompat.addWebMessageListener(web,"DahshaPlayback",origins,(view,message,origin,main,reply)->{
                    if(playerDialog!=dialog)return;
                    if("playing".equals(message.getData())){diagnostics.clear();played[0]=true;watchdog.removeCallbacks(startupTimeout);}
                    if("missing".equals(message.getData())&&!played[0]){diagnostics.unavailable();reason[0]="failed";dialog.dismiss();}
                    if(message.getData()!=null&&message.getData().length()<14000)try{
                        JSONObject data=new JSONObject(message.getData());String target=data.optString("url"),format=data.optString("format");Uri uri=Uri.parse(target);
                        if("progress".equals(data.optString("type"))){
                            double position=data.optDouble("position",-1),duration=data.optDouble("duration",0);
                            if(Double.isFinite(position)&&Double.isFinite(duration)&&position>0&&duration>0&&position<=duration+1){
                                diagnostics.clear();latest[0]=Math.min(position,duration);latest[1]=duration;played[0]=true;watchdog.removeCallbacks(startupTimeout);
                                JSObject progress=new JSObject();progress.put("session",session);progress.put("position",latest[0]);progress.put("duration",duration);progress.put("playing",data.optBoolean("playing"));progress.put("final",data.optBoolean("final"));notifyListeners("progress",progress);
                                if(data.optBoolean("ended")&&duration-position<=2){reason[0]="ended";dialog.dismiss();}
                            }
                        }
                    }catch(Exception ignored){}
                });
                WebViewCompat.addDocumentStartJavaScript(web,PlayerAdBlock.script(getContext(),"player-health.js"),origins);
                WebViewCompat.addDocumentStartJavaScript(web,PlayerAdBlock.script(getContext(),"player-progress.js").replace("/*DAHSHA_START_AT*/0",Double.toString(startAt)),origins);
            }
            web.setWebViewClient(new WebViewClient() {
                @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return PlayerAdBlock.intercept(request);}
                @Override public boolean shouldOverrideUrlLoading(WebView view, String target) { return !approved(target); }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return request.isForMainFrame() && !approved(request.getUrl().toString()); }
                @Override public void onPageStarted(WebView view,String target,android.graphics.Bitmap favicon){if(playerDialog!=dialog)return;diagnostics.clear();challengeDocument[0]=false;title.setText(Uri.parse(target).getHost());}
                @Override public void onPageFinished(WebView view,String target){
                    // Document load is not video playback. Keep the bounded startup
                    // deadline until a content clock or playing signal arrives.
                    if(!challengeDocument[0])verifying[0]=false;
                }
                @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,android.webkit.WebResourceResponse response){
                    if(playerDialog!=dialog||!request.isForMainFrame()||response.getStatusCode()<400)return;
                    boolean verification=PlayerHttpPolicy.needsBrowserVerification(response.getStatusCode(),response.getResponseHeaders());
                    diagnostics.http(response.getStatusCode(),verification);
                    if(verification){
                        challengeDocument[0]=true;
                        title.setText("Browser verification");
                        // Give normal JavaScript/cookie verification a bounded opportunity.
                        // Redirect loops cannot keep extending the deadline.
                        if(!verifying[0]&&!played[0]){verifying[0]=true;watchdog.removeCallbacks(startupTimeout);watchdog.postDelayed(startupTimeout,30000);}
                        return;
                    }
                    reason[0]="failed";dialog.dismiss();
                }
                @Override public void onReceivedError(WebView view,WebResourceRequest request,android.webkit.WebResourceError error){if(playerDialog==dialog&&request.isForMainFrame()){diagnostics.network(error.getErrorCode());reason[0]="failed";dialog.dismiss();}}
            });
            web.setWebChromeClient(new WebChromeClient() {
                private View video;
                private CustomViewCallback callback;
                @Override public void onShowCustomView(View view, CustomViewCallback cb) {
                    if (video != null) { cb.onCustomViewHidden(); return; }
                    // A host may request a custom video view on autoplay. Fit it to
                    // the existing inline surface; only Dahsha's button expands it.
                    video=view;callback=cb;web.setVisibility(View.GONE);stage.addView(view,new FrameLayout.LayoutParams(-1,-1));
                }
                @Override public void onHideCustomView() { if(video!=null){stage.removeView(video);video=null;web.setVisibility(View.VISIBLE);CustomViewCallback cb=callback;callback=null;if(cb!=null)cb.onCustomViewHidden();} }
                @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) { return false; }
                @Override public boolean onJsAlert(WebView view,String target,String message,android.webkit.JsResult result){result.cancel();return true;}
                @Override public boolean onJsConfirm(WebView view,String target,String message,android.webkit.JsResult result){result.cancel();return true;}
                @Override public boolean onJsPrompt(WebView view,String target,String message,String initial,android.webkit.JsPromptResult result){result.cancel();return true;}
            });
            stage.addView(web,new FrameLayout.LayoutParams(-1,-1)); dialog.setContentView(layout);
            dialog.setOnDismissListener(d -> { watchdog.removeCallbacksAndMessages(null);playerDialog=null;playerWebView=null;web.stopLoading();web.loadUrl("about:blank");stage.removeAllViews();web.destroy();JSObject result=new JSObject();result.put("reason",reason[0]);result.put("played",played[0]);result.put("position",latest[0]);result.put("duration",latest[1]);if(!diagnostics.sourceError().isEmpty())result.put("sourceError",diagnostics.sourceError());if(diagnostics.httpStatus()>0)result.put("httpStatus",diagnostics.httpStatus());if(diagnostics.networkErrorCode()<0)result.put("networkErrorCode",diagnostics.networkErrorCode());call.resolve(result); });
            dialog.show();watchdog.postDelayed(startupTimeout,observableFile?30000:60000);
            web.loadUrl(url,headers);
        });
    }
    @PluginMethod public void close(PluginCall call) { getActivity().runOnUiThread(() -> { if(playerDialog!=null)playerDialog.dismiss();call.resolve(); }); }
    @PluginMethod public void updateBounds(PluginCall call){getActivity().runOnUiThread(()->{if(playerDialog!=null)playerDialog.updateBounds(call.getObject("bounds"));call.resolve();});}
    @PluginMethod public void setFullscreen(PluginCall call){getActivity().runOnUiThread(()->{if(playerDialog!=null)playerDialog.setFullscreen(call.getBoolean("fullscreen",true));call.resolve();});}
    @Override protected void handleOnPause() { if(playerWebView!=null)playerWebView.onPause(); }
    @Override protected void handleOnResume() { if(playerWebView!=null)playerWebView.onResume(); }
    @Override protected void handleOnDestroy() { if(playerDialog!=null)playerDialog.dismiss(); }
}
