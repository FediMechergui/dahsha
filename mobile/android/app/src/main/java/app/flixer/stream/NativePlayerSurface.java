package app.flixer.stream;

import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.MotionEvent;
import android.view.Gravity;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

/** Native playback occupies the HTML stage; only an explicit control expands it. */
final class NativePlayerSurface {
    interface DismissListener { void dismissed(NativePlayerSurface surface); }
    interface FullscreenListener { void changed(boolean expanded); }
    private final BridgeActivity activity;
    private final WebView appWeb;
    private final FrameLayout host, viewport;
    private View content, toolbar;
    private JSObject bounds;
    private DismissListener listener;
    private FullscreenListener fullscreenListener;
    private boolean showing, fullscreen, keptScreenOn;
    private boolean statusWasVisible=true, navigationWasVisible=true;
    private int previousCutoutMode,previousBarsBehavior,previousOrientation;
    private final android.os.Handler controls=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable hideControls=()->{if(toolbar!=null)toolbar.setVisibility(View.GONE);};
    private final OnBackPressedCallback back = new OnBackPressedCallback(true) {
        @Override public void handleOnBackPressed() {
            if (fullscreen) setFullscreen(false); else dismiss();
        }
    };
    NativePlayerSurface(BridgeActivity activity, WebView appWeb, JSObject bounds) {
        this.activity=activity; this.appWeb=appWeb; this.bounds=bounds;
        host=new FrameLayout(activity){@Override public boolean dispatchTouchEvent(MotionEvent event){boolean handled=super.dispatchTouchEvent(event);if(fullscreen&&event.getActionMasked()==MotionEvent.ACTION_UP)post(NativePlayerSurface.this::revealControls);return handled;}}; viewport=new FrameLayout(activity);
        viewport.setBackgroundColor(Color.BLACK);viewport.setContentDescription("Dahsha playback surface");
        host.addView(viewport);
    }
    void setContentView(View content) { this.content=content; viewport.addView(content,0,new FrameLayout.LayoutParams(-1,-1)); }
    void setToolbar(View toolbar) { this.toolbar=toolbar;if(toolbar.getParent() instanceof ViewGroup)((ViewGroup)toolbar.getParent()).removeView(toolbar);toolbar.setBackgroundColor(0xB0000000);if(toolbar instanceof ViewGroup)for(int i=0;i<((ViewGroup)toolbar).getChildCount();i++){View child=((ViewGroup)toolbar).getChildAt(i);if(child instanceof android.widget.Button){android.widget.Button button=(android.widget.Button)child;button.setBackgroundColor(Color.TRANSPARENT);button.setTextColor(Color.WHITE);button.setAllCaps(false);}}viewport.addView(toolbar,new FrameLayout.LayoutParams(-1,-2,Gravity.TOP));toolbar.setVisibility(View.GONE); }
    private void revealControls(){if(!fullscreen||toolbar==null)return;toolbar.setVisibility(View.VISIBLE);toolbar.bringToFront();controls.removeCallbacks(hideControls);controls.postDelayed(hideControls,3000);}
    void setControlsVisible(boolean visible){if(!fullscreen)return;if(visible)revealControls();else{controls.removeCallbacks(hideControls);hideControls.run();}}
    void setOnDismissListener(DismissListener listener) { this.listener=listener; }
    void setFullscreenListener(FullscreenListener listener) { fullscreenListener=listener; }
    boolean isShowing() { return showing; }
    boolean isFullscreen() { return fullscreen; }
    void show() {
        showing=true;
        ((ViewGroup)activity.findViewById(android.R.id.content)).addView(host,new ViewGroup.LayoutParams(-1,-1));
        activity.getOnBackPressedDispatcher().addCallback(activity,back);
        keptScreenOn=(activity.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0;
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        host.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->layout());
        layout(); host.post(this::layout);
    }
    void updateBounds(JSObject bounds) { this.bounds=bounds; layout(); }
    void setFullscreen(boolean expanded) {
        if(fullscreen==expanded)return;
        androidx.core.view.WindowInsetsControllerCompat bars=androidx.core.view.WindowCompat.getInsetsController(activity.getWindow(),host);
        if(expanded){
            previousOrientation=activity.getRequestedOrientation();
            androidx.core.view.WindowInsetsCompat insets=androidx.core.view.ViewCompat.getRootWindowInsets(host);
            if(insets!=null){statusWasVisible=insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.statusBars());navigationWasVisible=insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.navigationBars());}
            previousBarsBehavior=bars.getSystemBarsBehavior();
            bars.setSystemBarsBehavior(androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            bars.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());
            if(android.os.Build.VERSION.SDK_INT>=28){previousCutoutMode=activity.getWindow().getAttributes().layoutInDisplayCutoutMode;WindowManager.LayoutParams attributes=activity.getWindow().getAttributes();attributes.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;activity.getWindow().setAttributes(attributes);}
        }else{
            controls.removeCallbacks(hideControls);hideControls.run();bars.setSystemBarsBehavior(previousBarsBehavior);
            if(statusWasVisible)bars.show(androidx.core.view.WindowInsetsCompat.Type.statusBars());if(navigationWasVisible)bars.show(androidx.core.view.WindowInsetsCompat.Type.navigationBars());
            if(android.os.Build.VERSION.SDK_INT>=28){WindowManager.LayoutParams attributes=activity.getWindow().getAttributes();attributes.layoutInDisplayCutoutMode=previousCutoutMode;activity.getWindow().setAttributes(attributes);}
        }
        fullscreen=expanded;
        activity.setRequestedOrientation(expanded?android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE:previousOrientation);
        if(fullscreenListener!=null)fullscreenListener.changed(expanded);
        if(expanded)revealControls();
        layout();
    }
    private void layout() {
        if(!showing)return;
        androidx.core.view.WindowInsetsCompat insets=androidx.core.view.ViewCompat.getRootWindowInsets(host);
        viewport.setPadding(0,0,0,0);
        FrameLayout.LayoutParams params;
        if(fullscreen)params=new FrameLayout.LayoutParams(-1,-1);
        else {
            double viewportWidth=bounds==null?0:bounds.optDouble("viewportWidth",0);
            double scale=viewportWidth>0?appWeb.getWidth()/viewportWidth:activity.getResources().getDisplayMetrics().density;
            double x=bounds==null?0:bounds.optDouble("x",0), y=bounds==null?0:bounds.optDouble("y",0);
            double w=bounds==null?appWeb.getWidth()/scale:bounds.optDouble("width",0);
            double h=bounds==null?w*9/16:bounds.optDouble("height",0);
            if(!Double.isFinite(scale)||scale<=0||!Double.isFinite(x)||!Double.isFinite(y)||!Double.isFinite(w)||!Double.isFinite(h)){viewport.setVisibility(View.GONE);return;}
            int[] webPos=new int[2],hostPos=new int[2];appWeb.getLocationInWindow(webPos);host.getLocationInWindow(hostPos);
            int width=(int)Math.round(Math.min(w*scale,appWeb.getWidth())),height=(int)Math.round(Math.min(h*scale,appWeb.getHeight()));
            params=new FrameLayout.LayoutParams(Math.max(1,width),Math.max(1,height));
            params.leftMargin=webPos[0]-hostPos[0]+(int)Math.round(x*scale);
            params.topMargin=webPos[1]-hostPos[1]+(int)Math.round(y*scale);
            viewport.setVisibility(width>0&&height>0&&params.topMargin+height>0&&params.topMargin<host.getHeight()?View.VISIBLE:View.GONE);
        }
        if(fullscreen)viewport.setVisibility(View.VISIBLE);
        viewport.setLayoutParams(params);
    }
    void dismiss() {
        if(!showing)return;
        if(fullscreen)setFullscreen(false);controls.removeCallbacksAndMessages(null);
        showing=false; back.remove();
        ((ViewGroup)host.getParent()).removeView(host);
        if(!keptScreenOn)activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(listener!=null)listener.dismissed(this);
        viewport.removeAllViews();content=null;
    }
}
