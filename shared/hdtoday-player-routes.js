// Public HDToday migration /api/go responses captured 2026-11-03 from
// https://flixorbit.cyou: Phony (TMDB 275139, S1E1) and The Sins Beneath
// (TMDB 1234064). A route is not proof of playable media for every title.
export const HDTODAY_PLAYER_ROUTES = [
  {"name":"vidsrc.mov","movie":"https://vidsrc.mov/embed/movie/{id}","tv":"https://vidsrc.mov/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidsrc.fyi","movie":"https://vidsrc.fyi/embed/movie/{id}","tv":"https://vidsrc.fyi/embed/tv/{id}/{season}/{episode}"},
  {"name":"VIP (No ADS)","movie":"https://embed.vidsrc.si/embed/movie/{id}?autoplay=1&ds_lang=en","tv":"https://embed.vidsrc.si/embed/tv/{id}/{season}/{episode}?autoplay=1&ds_lang=en"},
  {"name":"vidfast","movie":"https://vidfast.pro/movie/{id}?autoPlay=true","tv":"https://vidfast.pro/tv/{id}/{season}/{episode}?autoPlay=true"},
  {"name":"vidup","movie":"https://vidup.to/movie/{id}?autoPlay=true","tv":"https://vidup.to/tv/{id}/{season}/{episode}?autoPlay=true"},
  {"name":"vidrock","movie":"https://vidrock.net/movie/{id}","tv":"https://vidrock.net/tv/{id}/{season}/{episode}"},
  {"name":"vidnest","movie":"https://vidnest.fun/movie/{id}","tv":"https://vidnest.fun/tv/{id}/{season}/{episode}"},
  {"name":"vidlink","movie":"https://vidlink.pro/movie/{id}?autoplay=true&title=true","tv":"https://vidlink.pro/tv/{id}/{season}/{episode}?autoplay=true&title=true"},
  {"name":"111movies","movie":"https://111movies.net/movie/{id}","tv":"https://111movies.net/tv/{id}/{season}/{episode}"},
  {"name":"multiembed","movie":"https://multiembed.mov/?video_id={id}&tmdb=1","tv":"https://multiembed.mov/?video_id={id}&tmdb=1&s={season}&e={episode}"},
  {"name":"mappletv","movie":"https://mappletv.uk/embed/movie/{id}","tv":"https://mappletv.uk/embed/tv/{id}/{season}/{episode}"},
  {"name":"moviesapi","movie":"https://moviesapi.to/movie/{id}","tv":"https://moviesapi.to/tv/{id}/{season}/{episode}"},
  {"name":"vidzee","movie":"https://player.vidzee.wtf/embed/movie/{id}","tv":"https://player.vidzee.wtf/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidrift","movie":"https://embed.vidrift.net/embed/movie/{id}","tv":"https://embed.vidrift.net/embed/tv/{id}/{season}/{episode}"},
  {"name":"videm","movie":"https://videm.xyz/embed/movie/{id}","tv":"https://videm.xyz/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidsrc-V1","movie":"https://vidsrc.sh/embed/movie/{id}","tv":"https://vidsrc.sh/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidsrc-V2","movie":"https://vidsrc.su/movie/{id}","tv":"https://vidsrc.su/tv/{id}/{season}/{episode}"},
  {"name":"VidBuzz","movie":"https://vidsrc.buzz/embed/movie/{id}","tv":"https://vidsrc.buzz/embed/tv/{id}/{season}/{episode}"},
  {"name":"apiplayer","movie":"https://apiplayer.ru/embed/movie/{id}","tv":"https://apiplayer.ru/embed/tv/{id}/{season}/{episode}"},
  {"name":"nontongo","movie":"https://nontongo.win/embed/movie/{id}","tv":"https://nontongo.win/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidapi","movie":"https://vidapi.xyz/embed/movie/{id}","tv":"https://vidapi.xyz/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidapi-V2","movie":"https://vidapi.ru/embed/movie/{id}","tv":"https://vidapi.ru/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidcore-V1","movie":"https://vidcore.org/embed/movie/{id}","tv":"https://vidcore.org/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidcore-V2","movie":"https://vidcore.io/movie/{id}","tv":"https://vidcore.io/tv/{id}/{season}/{episode}"},
  {"name":"vixsrc","movie":"https://vixsrc.to/movie/{id}","tv":"https://vixsrc.to/tv/{id}/{season}/{episode}"},
  {"name":"cinesrc","movie":"https://cinesrc.st/embed/movie/{id}","tv":"https://cinesrc.st/embed/tv/{id}?s={season}&e={episode}"},
  {"name":"embedbandit","movie":"https://embedbandit.com/embed/movie?tmdb={id}","tv":"https://embedbandit.com/embed/tv?tmdb={id}&season={season}&episode={episode}"},
  {"name":"vidlux","movie":"https://vidlux.xyz/embed/movie/{id}","tv":"https://vidlux.xyz/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidspark","movie":"https://vidspark.to/movie/{id}","tv":"https://vidspark.to/tv/{id}/{season}/{episode}"},
  {"name":"embed-api","movie":"https://watch.embed-api.stream/embed/movie/{id}","tv":"https://watch.embed-api.stream/embed/tv/{id}/{season}/{episode}"},
  {"name":"nsrplay","movie":"https://nsrplay.space/embed/movie/{id}","tv":"https://nsrplay.space/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidzen","movie":"https://vidzen.fun/movie/{id}","tv":"https://vidzen.fun/tv/{id}/{season}/{episode}"},
  {"name":"cinextream","movie":"https://cinextream.cc/api/embed/movie/{id}","tv":"https://cinextream.cc/api/embed/tv/{id}/{season}/{episode}"},
  {"name":"yapgrid","movie":"https://yapgrid.com/embed/movie/{id}","tv":"https://yapgrid.com/embed/tv/{id}/{season}/{episode}"},
  {"name":"vidbolt","movie":"https://vidbolt.xyz/movie/{id}","tv":"https://vidbolt.xyz/tv/{id}/{season}/{episode}"},
  {"name":"net79","movie":"https://net79.cc/watch-tmdb/{id}?type=movie","tv":"https://net79.cc/watch-tmdb/{id}?type=tv&season={season}&episode={episode}"},
  {"name":"embedmaster","movie":"https://embedmaster.link/movie/{id}","tv":"https://embedmaster.link/tv/{id}/{season}/{episode}"},
  {"name":"screenscape","movie":"https://nxsha.screenscape.me/embed?tmdb={id}&type=movie&lan=eng","tv":"https://nxsha.screenscape.me/embed?tmdb={id}&type=tv&s={season}&e={episode}&lan=eng"},
  {"name":"rivestream","movie":"https://rivestream.ru/watch?type=movie&id={id}","tv":"https://rivestream.ru/watch?type=tv&id={id}&season={season}&episode={episode}"},
  {"name":"videasy.xyz","movie":"https://videasy.xyz/embed/movie/{id}","tv":"https://videasy.xyz/embed/tv/{id}/{season}/{episode}"},
  {"name":"2embed","movie":"https://www.2embed.cc/embed/{id}","tv":"https://www.2embed.cc/embedtv/{id}&s={season}&e={episode}"},
  {"name":"autoembed","movie":"https://autoembed.co/movie/tmdb/{id}","tv":"https://autoembed.co/tv/tmdb/{id}-{season}-{episode}"},
  {"name":"megaembed (Spanish)","movie":"https://megaembed.com/embed/movie/{id}","tv":"https://megaembed.com/embed/tv/{id}/{season}/{episode}"},
  {"name":"frembed (French)","movie":"https://frembed.surf/embed/movie/{id}","tv":"https://frembed.surf/embed/serie/{id}?sa={season}&epi={episode}"}
];

const patterns=HDTODAY_PLAYER_ROUTES.flatMap(route=>[route.movie,route.tv]).map(route=>new RegExp('^'+route
  .replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  .replaceAll('\\{id\\}','[1-9]\\d*')
  .replaceAll('\\{season\\}','\\d+')
  .replaceAll('\\{episode\\}','[1-9]\\d*')+'$'));

export function isHdtodayPlayerRoute(value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&patterns.some(pattern=>pattern.test(url.href));
  }catch{return false;}
}
