package app.flixer.stream;

import android.content.Context;
import android.os.Build;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.util.Collections;

public final class PlayerAdBlock {
    private PlayerAdBlock() {}
    public static WebResourceResponse intercept(String url){
        return PlayerAds.blocked(url)?new WebResourceResponse("text/plain","UTF-8",204,"No Content",Collections.emptyMap(),new ByteArrayInputStream(new byte[0])):null;
    }
    public static WebResourceResponse intercept(WebResourceRequest request){return intercept(request.getUrl().toString());}
    public static void installServiceWorkerFilter(){
        if(Build.VERSION.SDK_INT>=24)ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request){return intercept(request);}
        });
    }
    public static String script(Context context){
        return script(context,"player-cleanup.js");
    }
    public static String script(Context context,String asset){
        try(java.io.InputStream input=context.getAssets().open(asset)){
            java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;
            while((count=input.read(buffer))!=-1)out.write(buffer,0,count);return out.toString("UTF-8");
        }catch(java.io.IOException e){return "";}
    }
}
