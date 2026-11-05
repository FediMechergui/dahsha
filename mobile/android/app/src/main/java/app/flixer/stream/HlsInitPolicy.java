package app.flixer.stream;

import java.io.IOException;
import java.net.URI;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Preserve required init data; omit only a verified redundant MPEG-TS map. */
final class HlsInitPolicy {
    interface Probe { byte[] read(URI uri) throws IOException; }
    private static final Pattern MAP=Pattern.compile("(?m)^#EXT-X-MAP:([^\\r\\n]*)");
    private static final Pattern URI_VALUE=Pattern.compile("(?:^|,)URI=\"([^\"]+)\"");
    static String normalize(String playlist,URI base,Probe probe) {
        if(!playlist.contains("#EXTINF:")||playlist.contains("#EXT-X-BYTERANGE")||playlist.contains("#EXT-X-KEY")||playlist.contains("#EXT-X-DISCONTINUITY"))return playlist;
        Matcher map=MAP.matcher(playlist);if(!map.find())return playlist;
        int start=map.start(),end=map.end();String attributes=map.group(1);
        if(attributes.contains("BYTERANGE")||map.find())return playlist;
        Matcher value=URI_VALUE.matcher(attributes);if(!value.find())return playlist;
        String media=null;for(String line:playlist.substring(end).split("\\r?\\n")){line=line.trim();if(!line.isEmpty()&&!line.startsWith("#")){media=line;break;}}
        if(media==null)return playlist;
        try {
            URI init=base.resolve(value.group(1)),segment=base.resolve(media);
            if(!https(init)||!https(segment))return playlist;
            if(mediaPackets(probe.read(init))&&selfInitializing(probe.read(segment)))return playlist.substring(0,start)+playlist.substring(end);
        }catch(IOException|IllegalArgumentException ignored){}
        return playlist;
    }
    private static boolean https(URI uri){return "https".equalsIgnoreCase(uri.getScheme())&&uri.getHost()!=null&&uri.getUserInfo()==null&&(uri.getPort()==-1||uri.getPort()==443);}
    static boolean transportStream(byte[] bytes){
        return syncOffset(bytes)>=0;
    }
    private static int syncOffset(byte[] bytes){
        if(bytes==null)return -1;
        // Match the TS extractor's leading-padding tolerance. Some published
        // variants prepend an image header before otherwise ordinary TS data.
        for(int start=0;start<188&&start+188*3<=bytes.length;start++){
            boolean valid=true;for(int offset=start;offset+188<=bytes.length;offset+=188)if(bytes[offset]!=0x47){valid=false;break;}
            if(valid)return start;
        }
        return -1;
    }
    private static boolean mediaPackets(byte[] bytes){
        int start=syncOffset(bytes);if(start<0)return false;
        // A legitimate TS initialization section contains program tables. Only
        // a map containing actual PES media can trigger the observed parser bug.
        for(int offset=start;offset+188<=bytes.length;offset+=188){
            if((bytes[offset+1]&0x40)==0||(bytes[offset+3]&0x10)==0)continue;
            int p=offset+4;if((bytes[offset+3]&0x20)!=0)p+=1+(bytes[p]&255);
            if(p+4<=offset+188&&bytes[p]==0&&bytes[p+1]==0&&bytes[p+2]==1){int id=bytes[p+3]&255;if(id==0xbd||id>=0xc0&&id<=0xef)return true;}
        }
        return false;
    }
    private static int section(byte[] bytes,int offset){
        if((bytes[offset+1]&0x40)==0||(bytes[offset+3]&0x10)==0)return -1;
        int payload=offset+4;if((bytes[offset+3]&0x20)!=0)payload+=1+(bytes[payload]&255);
        if(payload>=offset+188)return -1;
        payload+=1+(bytes[payload]&255);return payload<offset+188?payload:-1;
    }
    static boolean selfInitializing(byte[] bytes){
        int start=syncOffset(bytes);if(start<0)return false;
        Set<Integer> maps=new HashSet<>();
        for(int offset=start;offset+188<=bytes.length;offset+=188){
            int pid=((bytes[offset+1]&31)<<8)|(bytes[offset+2]&255),s=section(bytes,offset);
            if(pid!=0||s<0||s+8>=offset+188||bytes[s]!=0)continue;
            int end=s+3+(((bytes[s+1]&15)<<8)|(bytes[s+2]&255))-4;
            if(end>offset+188)continue;
            for(int at=s+8;at+4<=end;at+=4)if(bytes[at]!=0||bytes[at+1]!=0)maps.add(((bytes[at+2]&31)<<8)|(bytes[at+3]&255));
        }
        for(int offset=start;offset+188<=bytes.length;offset+=188){int s=section(bytes,offset),pid=((bytes[offset+1]&31)<<8)|(bytes[offset+2]&255);if(s>=0&&maps.contains(pid)&&bytes[s]==2)return true;}
        return false;
    }
}
