package app.flixer.stream;

import android.net.Uri;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.exoplayer.hls.playlist.DefaultHlsPlaylistParserFactory;
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParserFactory;
import androidx.media3.exoplayer.upstream.ParsingLoadable;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

@androidx.annotation.OptIn(markerClass=androidx.media3.common.util.UnstableApi.class)
final class CompatibleHlsParserFactory implements HlsPlaylistParserFactory {
    private final DefaultHlsPlaylistParserFactory delegate=new DefaultHlsPlaylistParserFactory();
    private final DataSource.Factory probes;
    private final Map<URI,byte[]> prefixes=new HashMap<>();
    CompatibleHlsParserFactory(DataSource.Factory probes){this.probes=probes;}
    @Override public ParsingLoadable.Parser<HlsPlaylist> createPlaylistParser(){return wrap(delegate.createPlaylistParser());}
    @Override public ParsingLoadable.Parser<HlsPlaylist> createPlaylistParser(HlsMultivariantPlaylist master,HlsMediaPlaylist previous){return wrap(delegate.createPlaylistParser(master,previous));}
    private ParsingLoadable.Parser<HlsPlaylist> wrap(ParsingLoadable.Parser<HlsPlaylist> parser){return (uri,input)->{
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;
        while((count=input.read(buffer))!=-1){if(out.size()+count>4*1024*1024)throw new IOException("HLS playlist exceeds the device parsing limit");out.write(buffer,0,count);}
        byte[] original=out.toByteArray();String text=new String(original,StandardCharsets.UTF_8),normalized=HlsInitPolicy.normalize(text,URI.create(uri.toString()),this::prefix);
        return parser.parse(uri,new ByteArrayInputStream(normalized.equals(text)?original:normalized.getBytes(StandardCharsets.UTF_8)));
    };}
    private synchronized byte[] prefix(URI uri)throws IOException{
        byte[] cached=prefixes.get(uri);if(cached!=null)return cached;
        if(prefixes.size()>=64)throw new IOException("HLS probe budget exceeded");
        DataSource source=probes.createDataSource();byte[] bytes=new byte[188*8];int used=0;
        try{source.open(new DataSpec.Builder().setUri(Uri.parse(uri.toString())).setLength(bytes.length).build());while(used<bytes.length){int read=source.read(bytes,used,bytes.length-used);if(read<0)break;if(read==0)break;used+=read;}}finally{source.close();}
        byte[] result=java.util.Arrays.copyOf(bytes,used);prefixes.put(uri,result);return result;
    }
}
