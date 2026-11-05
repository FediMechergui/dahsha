package app.flixer.stream;

import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.MergingMediaSource;
import androidx.media3.exoplayer.source.SingleSampleMediaSource;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Plays public source media directly; no WebView CORS or Vercel segment proxy. */
@CapacitorPlugin(name = "DirectVideo")
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class DirectVideoPlugin extends Plugin {
    private NativePlayerSurface dialog;
    private ExoPlayer player;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean resume;
    private static boolean valid(String value) {
        try {
            Uri u=Uri.parse(value); String h=u.getHost();
            return value.length()<12000 && "https".equals(u.getScheme()) && u.getUserInfo()==null && u.getPort()==-1
                && h!=null && h.matches("(?i)[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}") && !h.endsWith(".local") && !h.endsWith(".localhost");
        } catch(Exception e) { return false; }
    }
    private int dp(int n) { return Math.round(n*getContext().getResources().getDisplayMetrics().density); }
    @PluginMethod public void open(PluginCall call) {
        String url=call.getString("url"), type=call.getString("type","file"), session=call.getString("session","");
        if(url==null || !valid(url) || !("file".equals(type)||"mp4".equals(type)||"hls".equals(type)||"dash".equals(type))) {call.reject("Unsupported direct video");return;}
        getActivity().runOnUiThread(()->{
            if(dialog!=null){call.reject("A direct player is already open");return;}
            NativePlayerSurface surface=new NativePlayerSurface((com.getcapacitor.BridgeActivity)getActivity(),getBridge().getWebView(),call.getObject("bounds"));dialog=surface;
            String[] reason={"closed"},error={""};boolean[] played={false};
            LinearLayout layout=new LinearLayout(getActivity());layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.BLACK);
            LinearLayout bar=new LinearLayout(getActivity());bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
            Button close=new Button(getActivity());close.setText("Close");close.setContentDescription("Close video");close.setOnClickListener(v->surface.dismiss());bar.addView(close);
            TextView label=new TextView(getActivity());label.setText(call.getString("title","Video"));label.setTextColor(Color.WHITE);label.setSingleLine(true);label.setEllipsize(android.text.TextUtils.TruncateAt.END);bar.addView(label,new LinearLayout.LayoutParams(0,dp(48),1));
            Button restore=new Button(getActivity());restore.setText("Inline");restore.setContentDescription("Exit fullscreen");restore.setOnClickListener(v->surface.setFullscreen(false));bar.addView(restore);
            Button next=new Button(getActivity());next.setText("Next");next.setContentDescription("Next source");next.setOnClickListener(v->{reason[0]="next";surface.dismiss();});bar.addView(next);layout.addView(bar);surface.setToolbar(bar);
            DefaultHttpDataSource.Factory http=new DefaultHttpDataSource.Factory().setConnectTimeoutMs(10000).setReadTimeoutMs(15000).setAllowCrossProtocolRedirects(false);
            java.util.Map<String,String> headers=new java.util.HashMap<>();JSObject supplied=call.getObject("headers",new JSObject());
            for(String name:new String[]{"Referer","User-Agent","Origin","Accept-Language"}){String value=supplied.optString(name,"");if(!value.isEmpty()&&value.length()<2000&&!value.contains("\r")&&!value.contains("\n"))headers.put(name,value);}
            http.setDefaultRequestProperties(headers);
            ExoPlayer media=new ExoPlayer.Builder(getContext()).setMediaSourceFactory(new DefaultMediaSourceFactory(http)).setLoadControl(new DefaultLoadControl.Builder().setBufferDurationsMs(1000,15000,500,1000).build()).build();player=media;
            media.setAudioAttributes(new androidx.media3.common.AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);
            media.setHandleAudioBecomingNoisy(true);
            PlayerView view=new PlayerView(getActivity());view.setPlayer(media);view.setKeepScreenOn(true);view.setFullscreenButtonClickListener(expanded->surface.setFullscreen(expanded));surface.setFullscreenListener(expanded->{view.setFullscreenButtonState(expanded);JSObject state=new JSObject();state.put("session",session);state.put("fullscreen",expanded);notifyListeners("fullscreen",state);});layout.addView(view,new LinearLayout.LayoutParams(-1,0,1));
            view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener)visibility->surface.setControlsVisible(visibility==View.VISIBLE));
            Runnable timeout=()->{if(!played[0]&&dialog==surface){reason[0]="failed";error[0]="STARTUP_TIMEOUT";surface.dismiss();}};
            Runnable progress=new Runnable(){public void run(){if(dialog!=surface)return;JSObject state=new JSObject();state.put("session",session);state.put("position",media.getCurrentPosition()/1000.0);state.put("duration",Math.max(0,media.getDuration())/1000.0);state.put("playing",media.isPlaying());notifyListeners("progress",state);handler.postDelayed(this,2000);}};
            media.addListener(new Player.Listener(){
                @Override public void onIsPlayingChanged(boolean on){if(on){played[0]=true;handler.removeCallbacks(timeout);}}
                @Override public void onPlayerError(PlaybackException e){reason[0]="failed";error[0]=e.getErrorCodeName();android.util.Log.w("FlixerDirect",error[0]);surface.dismiss();}
                @Override public void onPlaybackStateChanged(int state){if(state==Player.STATE_ENDED){reason[0]="ended";surface.dismiss();}}
            });
            surface.setContentView(layout);
            surface.setOnDismissListener(d->{
                handler.removeCallbacks(timeout);handler.removeCallbacks(progress);
                JSObject result=new JSObject();result.put("reason",reason[0]);result.put("played",played[0]);result.put("error",error[0]);result.put("position",media.getCurrentPosition()/1000.0);result.put("duration",Math.max(0,media.getDuration())/1000.0);
                view.setPlayer(null);media.release();if(dialog==surface){dialog=null;player=null;}call.resolve(result);
            });
            surface.show();
            MediaItem.Builder item=new MediaItem.Builder().setUri(url);
            java.util.List<MediaItem.SubtitleConfiguration> subtitles=new java.util.ArrayList<>();
            org.json.JSONArray tracks=call.getArray("subtitles");
            if(tracks!=null)for(int i=0;i<Math.min(tracks.length(),4);i++)try{
                org.json.JSONObject track=tracks.getJSONObject(i);String target=track.optString("url"),mime=track.optString("mimeType");
                if(valid(target)&&java.util.Arrays.asList(MimeTypes.TEXT_VTT,MimeTypes.APPLICATION_SUBRIP,MimeTypes.APPLICATION_TTML).contains(mime))subtitles.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(target)).setMimeType(mime).setLanguage(track.optString("language","en")).setLabel(track.optString("label","Subtitles")).setSelectionFlags(C.SELECTION_FLAG_DEFAULT).build());
            }catch(org.json.JSONException ignored){}
            item.setSubtitleConfigurations(subtitles);
            if("hls".equals(type))item.setMimeType(MimeTypes.APPLICATION_M3U8);else if("dash".equals(type))item.setMimeType(MimeTypes.APPLICATION_MPD);
            if("hls".equals(type)){
                DefaultHttpDataSource.Factory probes=new DefaultHttpDataSource.Factory().setConnectTimeoutMs(3000).setReadTimeoutMs(3000).setAllowCrossProtocolRedirects(false).setDefaultRequestProperties(headers);
                MediaSource source=new HlsMediaSource.Factory(http).setPlaylistParserFactory(new CompatibleHlsParserFactory(probes)).createMediaSource(item.build());
                if(!subtitles.isEmpty()){
                    java.util.List<MediaSource> tracksToMerge=new java.util.ArrayList<>();tracksToMerge.add(source);
                    for(MediaItem.SubtitleConfiguration track:subtitles)tracksToMerge.add(new SingleSampleMediaSource.Factory(http).createMediaSource(track,C.TIME_UNSET));
                    source=new MergingMediaSource(tracksToMerge.toArray(new MediaSource[0]));
                }
                media.setMediaSource(source);
            }else media.setMediaItem(item.build());
            double position=call.getDouble("startAt",0.0);if(Double.isFinite(position)&&position>0)media.seekTo((long)(position*1000));media.prepare();media.play();
            handler.postDelayed(timeout,45000);handler.post(progress);
        });
    }
    @PluginMethod public void close(PluginCall call){getActivity().runOnUiThread(()->{if(dialog!=null)dialog.dismiss();call.resolve();});}
    @PluginMethod public void updateBounds(PluginCall call){getActivity().runOnUiThread(()->{if(dialog!=null)dialog.updateBounds(call.getObject("bounds"));call.resolve();});}
    @PluginMethod public void setFullscreen(PluginCall call){getActivity().runOnUiThread(()->{if(dialog!=null)dialog.setFullscreen(call.getBoolean("fullscreen",true));call.resolve();});}
    @Override protected void handleOnPause(){if(player!=null){resume=player.getPlayWhenReady();player.pause();}}
    @Override protected void handleOnResume(){if(player!=null&&resume)player.play();}
    @Override protected void handleOnDestroy(){if(dialog!=null)dialog.dismiss();}
}
