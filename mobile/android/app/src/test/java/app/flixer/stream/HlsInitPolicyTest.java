package app.flixer.stream;

import org.junit.Test;
import static org.junit.Assert.*;
import java.net.URI;
import java.io.IOException;

public class HlsInitPolicyTest {
    private final URI base=URI.create("https://media.example/playlist.m3u8");
    private final String playlist="#EXTM3U\n#EXT-X-MAP:URI=\"init\"\n#EXTINF:5,\nsegment.ts\n#EXT-X-ENDLIST\n";
    private byte[] ts(boolean tables){byte[] b=new byte[188*3];for(int i=0;i<3;i++){int o=i*188;b[o]=0x47;b[o+1]=0x40;b[o+2]=(byte)(i==0?0:i==1?100:101);b[o+3]=0x10;b[o+4]=0;}if(tables){int s=5;b[s]=0;b[s+1]=(byte)0xb0;b[s+2]=13;b[s+8]=0;b[s+9]=1;b[s+10]=(byte)0xe0;b[s+11]=100;b[188+5]=2;}else b[1]=0x41;b[376+6]=1;b[376+7]=(byte)0xe0;return b;}
    @Test public void redundantTsMapIsRemovedOnlyWhenTheFirstMediaSegmentInitializesItself(){String fixed=HlsInitPolicy.normalize(playlist,base,u->ts(true));assertFalse(fixed.contains("#EXT-X-MAP"));assertTrue(fixed.contains("#EXTINF:5,"));assertTrue(fixed.contains("segment.ts"));}
    @Test public void requiredFmp4MapAndMediaWithoutProgramTablesArePreserved(){assertEquals(playlist,HlsInitPolicy.normalize(playlist,base,u->new byte[1000]));assertEquals(playlist,HlsInitPolicy.normalize(playlist,base,u->u.getPath().endsWith("init")?ts(true):ts(false)));}
    @Test public void legitimateTsProgramTableOnlyInitializationIsPreserved(){byte[] init=ts(true);init[376+6]=0;assertEquals(playlist,HlsInitPolicy.normalize(playlist,base,u->u.getPath().endsWith("init")?init:ts(true)));}
    @Test public void observedImagePrefixDoesNotHideSelfInitializingTransportStream(){byte[] source=ts(true),padded=new byte[source.length+120];padded[0]=(byte)137;padded[1]=80;padded[2]=78;padded[3]=71;System.arraycopy(source,0,padded,120,source.length);assertFalse(HlsInitPolicy.normalize(playlist,base,u->padded).contains("#EXT-X-MAP"));assertEquals(playlist,HlsInitPolicy.normalize(playlist,base,u->new byte[1000]));}
    @Test public void rangeEncryptedDiscontinuousAndChangingInitStreamsArePreserved(){for(String tag:new String[]{"#EXT-X-BYTERANGE:100@0\n","#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n","#EXT-X-DISCONTINUITY\n","#EXT-X-MAP:URI=\"second\"\n"}){String source=playlist+tag;assertEquals(source,HlsInitPolicy.normalize(source,base,u->{fail("No probe expected");return null;}));}}
    @Test public void failedProbesAndNonHttpsReferencesDoNotChangeThePlaylist(){assertEquals(playlist,HlsInitPolicy.normalize(playlist,base,u->{throw new IOException("Unavailable");}));String file=playlist.replace("URI=\"init\"","URI=\"file:///private\"");assertEquals(file,HlsInitPolicy.normalize(file,base,u->{fail("Local URI must not be read");return null;}));}
}
