// Two-language UI (Arabic default, English). The active language also selects which catalogue
// section (ar / en shows) is displayed.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const APP_NAME = { ar: 'دهشة', en: 'Dahsha' };
export const TAGLINE = { ar: 'وثائقيات تُدهش', en: 'Documentaries that amaze' };

const STRINGS = {
  ar: {
    nav_home: 'الرئيسية', nav_browse: 'الفهرس', nav_films: 'الأفلام', nav_latest: 'الأحدث', nav_my: 'قائمتي', nav_sources: 'المصادر',
    search_placeholder: 'ابحث عن عرض أو حلقة…', search: 'بحث', menu: 'القائمة', lang_switch: 'English',
    status_offline: 'غير متصل', status_live: 'مباشر', status_details: 'يجلب التفاصيل', status_playlists: 'يفحص القوائم', status_building: 'يبني الفهرس', status_listing: 'يفحص المصادر', status_static: 'محدّث',
    status_last: 'آخر تحديث', status_never: 'لم يُحدَّث بعد', status_click: 'اضغط للتحديث الآن',
    hero_watch: 'شاهد الآن', hero_details: 'التفاصيل والحلقات', hero_last_episode: 'آخر حلقة',
    stat_series: 'مسلسلاً', stat_films: 'فيلماً', stat_episodes: 'حلقة كاملة', stat_hours: 'ساعة مشاهدة', stat_channels: 'قنوات',
    row_continue: 'متابعة المشاهدة', row_latest_eps: 'أحدث الحلقات', row_latest_eps_sub: 'آخر ما نُشر على كل القنوات', row_new_series: 'مسلسلات محدّثة مؤخراً', row_films: 'أفلام وثائقية', row_films_sub: 'وثائقيات مستقلة بحلقة واحدة', row_popular: 'الأكثر مشاهدة', see_all: 'عرض الكل', titles_count: 'عنواناً', episodes_count: 'حلقة', browse_all: 'تصفّح الفهرس الكامل',
    browse_title: 'الفهرس الكامل', browse_films: 'الأفلام الوثائقية', browse_series: 'المسلسلات الوثائقية', browse_sub: 'حلقات كاملة فقط (أطول من {min} دقائق)', browse_within: 'ضمن', all_channels: 'كل القنوات', all: 'الكل', kind_series: 'مسلسلات', kind_films: 'أفلام',
    filter_name: 'تصفية بالاسم…', sort: 'ترتيب:', sort_latest: 'الأحدث تحديثاً', sort_title: 'الاسم (أ-ي)', sort_episodes: 'عدد الحلقات', sort_views: 'الأكثر مشاهدة', sort_duration: 'الأطول',
    empty_results: 'لا توجد نتائج', empty_results_body: 'جرّب تصنيفاً أو قناة أخرى أو امسح التصفية.',
    badge_new: 'جديد', badge_film: 'فيلم', kind_film_label: 'فيلم وثائقي', kind_series_label: 'مسلسل وثائقي', seasons: 'مواسم', season: 'الموسم', other_episodes: 'حلقات أخرى', views: 'مشاهدة', now_playing: 'يُعرض الآن', watched: 'تمت مشاهدتها',
    show_missing: 'العرض غير موجود', show_missing_body: 'ربما أُزيل من المصدر أو تغيّر عنوانه.', back_to_browse: 'العودة إلى الفهرس', episodes: 'الحلقات', the_film: 'الفيلم', published: 'نُشر', last_added: 'آخر إضافة', continue_watching: 'متابعة المشاهدة', watch_film: 'شاهد الفيلم', watch_now: 'شاهد الآن', in_my_list: 'في قائمتي', add_to_list: 'أضف إلى قائمتي', also_known: 'يُعرف أيضاً بـ:', related: 'قد يعجبك أيضاً', related_sub: 'عناوين من التصنيفات نفسها',
    episode_missing: 'الحلقة غير موجودة', next_in: 'الحلقة التالية خلال', seconds: 'ثوانٍ', play_now: 'شغّل الآن', cancel: 'إلغاء', episode: 'الحلقة', of: 'من', prev_episode: 'الحلقة السابقة', next_episode: 'الحلقة التالية', autoplay_next: 'تشغيل تلقائي للحلقة التالية', open_youtube: 'فتح على يوتيوب', watch_on_youtube: 'شاهد على يوتيوب', open_myflixer: 'فتح في Myflixer', watch_on_myflixer: 'شاهد على Myflixer', show_page: 'صفحة العرض', episodes_of: 'حلقات',
    search_results: 'نتائج البحث عن', shows_label: 'العروض', episodes_label: 'الحلقات', no_results: 'لا نتائج', no_results_body: 'جرّب كلمات أقل أو تهجئة مختلفة.',
    my_title: 'قائمتي', my_sub: 'عروضك المفضّلة وما تتابعه — يُحفظ على هذا الجهاز', my_empty: 'قائمتك فارغة', my_empty_body: 'أضف عروضاً من صفحة أي عرض، وستظهر هنا الحلقات التي بدأت مشاهدتها.', favorites: 'المفضّلة', watched_list: 'شاهدتها', clear_history: 'مسح السجل',
    sources_title: 'المصادر والتحديث', sources_sub: 'يفحص التطبيق المصادر تلقائياً كل {refresh} دقيقة، ويراقب الرفع الجديد عبر خلاصة كل قناة كل {feed} دقائق.', sources_static_sub: 'هذه النسخة تُحدَّث بشكل دوري من خادم البناء؛ آخر بناء {date}.',
    refresh_status: 'حالة التحديث', refresh_now: 'تحديث الآن', full_rebuild: 'إعادة بناء كاملة', full_rebuild_confirm: 'إعادة فحص كل قوائم التشغيل من الصفر؟ قد يستغرق دقائق.', connection: 'الاتصال', connected: 'متصل مباشرة', disconnected: 'منقطع', state: 'الحالة', idle: 'خامل', progress: 'التقدم', last_update: 'آخر تحديث', next_update: 'التحديث القادم', last_error: 'آخر خطأ', none: 'لا شيء',
    series_: 'مسلسلات', films_: 'أفلام', full_episodes: 'حلقات كاملة', playlists_scanned: 'قوائم تشغيل مفحوصة', videos_scanned: 'فيديوهات مفحوصة', built_at: 'بُني في', sources: 'المصادر', add: 'إضافة', add_placeholder: 'رابط قناة يوتيوب (@handle) أو قائمة تشغيل…',
    sources_hint: 'تُقرأ كل قوائم تشغيل القناة وأحدث فيديوهات صفحة الرفع، وتُستخرج الحلقات الكاملة فقط (أطول من {min} دقائق). يُختار نمط تحليل العناوين تلقائياً حسب القناة.', no_sources: 'لا توجد مصادر.', channel: 'قناة', playlist: 'قائمة تشغيل', profile: 'نمط', scans_uploads: 'يفحص آخر {n} فيديو من صفحة الرفع', not_indexed: 'لم يُفهرس بعد', remove: 'إزالة', remove_confirm: 'إزالة المصدر «{title}»؟ ستُحذف عروضه من الفهرس.', added: 'أُضيف', source_added: 'أُضيف المصدر', will_scan: 'سيُفحص الآن', add_failed: 'تعذّرت الإضافة', remove_failed: 'تعذّرت الإزالة', curation: 'تخصيص يدوي',
    curation_hint: 'لتصحيح تصنيف أو ملخّص أو اسم عرض، عدّل الملف overrides.json (المفتاح هو معرّف العرض من الرابط)، أو أرسل طلب PUT /api/overrides/shows/:id. يمكن أيضاً توحيد تهجئات مختلفة لعرض واحد عبر قسم aliases.', static_readonly: 'إدارة المصادر متاحة في نسخة الخادم فقط (ملف sources.json في المستودع).',
    toast_new_one: 'حلقة جديدة', toast_new_many: '{n} حلقات جديدة', toast_and_more: 'و{n} أخرى', toast_open: 'افتح', toast_built: 'اكتمل بناء الفهرس', toast_refreshing: 'جارٍ التحديث', toast_refreshing_body: 'نفحص المصادر بحثاً عن حلقات جديدة…', toast_refresh_failed: 'تعذّر التحديث',
    loading: 'جارٍ التحميل…', building_first: 'نجهّز الفهرس للمرة الأولى…', building_listing: 'نقرأ قوائم تشغيل القنوات…', building_playlists: 'نجلب قوائم التشغيل…', building_details: 'نجلب تفاصيل الحلقات…', building_building: 'نرتّب الفهرس…', building_hint: 'يستغرق البناء الأول بضع دقائق لأننا نفحص مئات قوائم التشغيل. ستظهر الصفحة تلقائياً عند الانتهاء.', server_error: 'تعذّر الوصول إلى الخادم:', retry: 'إعادة المحاولة', not_found: 'الصفحة غير موجودة',
    footer: 'فهرس غير رسمي للوثائقيات المتاحة علناً على يوتيوب. التشغيل يتم عبر مشغّل يوتيوب الرسمي، وكل الحقوق لأصحابها.',
    player_err_2: 'معرّف الفيديو غير صالح.', player_err_5: 'تعذّر تشغيل الفيديو في هذا المتصفح.', player_err_100: 'الفيديو غير متاح (حُذف أو أصبح خاصاً).', player_err_101: 'لا يسمح صاحب القناة بتضمين هذا الفيديو.', player_err_153: 'منع المتصفح إرسال مرجع الصفحة إلى يوتيوب (خطأ 153). جرّب متصفحاً آخر أو افتح الحلقة على يوتيوب.', player_err_other: 'تعذّر تشغيل الفيديو (رمز {code}).',
    unit_h: 'س', unit_m: 'د', ep_one: 'حلقة واحدة', ep_two: 'حلقتان', ep_few: '{n} حلقات', ep_many: '{n} حلقة', titles_one: 'عنوان واحد',
  },
  en: {
    nav_home: 'Home', nav_browse: 'Catalogue', nav_films: 'Films', nav_latest: 'Latest', nav_my: 'My list', nav_sources: 'Sources',
    search_placeholder: 'Search shows and episodes…', search: 'Search', menu: 'Menu', lang_switch: 'العربية',
    status_offline: 'Offline', status_live: 'Live', status_details: 'Fetching details', status_playlists: 'Scanning playlists', status_building: 'Building', status_listing: 'Checking sources', status_static: 'Updated',
    status_last: 'Last update', status_never: 'Not updated yet', status_click: 'click to refresh now',
    hero_watch: 'Watch now', hero_details: 'Details & episodes', hero_last_episode: 'Latest episode',
    stat_series: 'series', stat_films: 'films', stat_episodes: 'full episodes', stat_hours: 'hours', stat_channels: 'channels',
    row_continue: 'Continue watching', row_latest_eps: 'Latest episodes', row_latest_eps_sub: 'Newest uploads across all channels', row_new_series: 'Recently updated series', row_films: 'Documentary films', row_films_sub: 'Standalone single-episode documentaries', row_popular: 'Most watched', see_all: 'See all', titles_count: 'titles', episodes_count: 'episodes', browse_all: 'Browse the full catalogue',
    browse_title: 'Full catalogue', browse_films: 'Documentary films', browse_series: 'Documentary series', browse_sub: 'full episodes only (longer than {min} minutes)', browse_within: 'in', all_channels: 'All channels', all: 'All', kind_series: 'Series', kind_films: 'Films',
    filter_name: 'Filter by name…', sort: 'Sort:', sort_latest: 'Recently updated', sort_title: 'Title (A–Z)', sort_episodes: 'Episode count', sort_views: 'Most watched', sort_duration: 'Longest',
    empty_results: 'No results', empty_results_body: 'Try another tag or channel, or clear the filter.',
    badge_new: 'New', badge_film: 'Film', kind_film_label: 'Documentary film', kind_series_label: 'Documentary series', seasons: 'seasons', season: 'Season', other_episodes: 'Other episodes', views: 'views', now_playing: 'Now playing', watched: 'Watched',
    show_missing: 'Show not found', show_missing_body: 'It may have been removed from the source or renamed.', back_to_browse: 'Back to catalogue', episodes: 'Episodes', the_film: 'The film', published: 'published', last_added: 'last added', continue_watching: 'Continue watching', watch_film: 'Watch the film', watch_now: 'Watch now', in_my_list: 'In my list', add_to_list: 'Add to my list', also_known: 'Also known as:', related: 'You may also like', related_sub: 'Titles from the same topics',
    episode_missing: 'Episode not found', next_in: 'Next episode in', seconds: 'seconds', play_now: 'Play now', cancel: 'Cancel', episode: 'Episode', of: 'of', prev_episode: 'Previous episode', next_episode: 'Next episode', autoplay_next: 'Autoplay next episode', open_youtube: 'Open on YouTube', watch_on_youtube: 'Watch on YouTube', open_myflixer: 'Open on Myflixer', watch_on_myflixer: 'Watch on Myflixer', show_page: 'Show page', episodes_of: 'Episodes of',
    search_results: 'Search results for', shows_label: 'Shows', episodes_label: 'Episodes', no_results: 'No results', no_results_body: 'Try fewer words or a different spelling.',
    my_title: 'My list', my_sub: 'Your favourites and what you are watching — saved on this device', my_empty: 'Your list is empty', my_empty_body: 'Add shows from any show page; episodes you start watching will appear here.', favorites: 'Favourites', watched_list: 'Watched', clear_history: 'Clear history',
    sources_title: 'Sources & updates', sources_sub: 'Sources are checked automatically every {refresh} minutes, and each channel\'s feed is watched for new uploads every {feed} minutes.', sources_static_sub: 'This deployment is refreshed periodically by the build server; last build {date}.',
    refresh_status: 'Refresh status', refresh_now: 'Refresh now', full_rebuild: 'Full rebuild', full_rebuild_confirm: 'Re-scan every playlist from scratch? This can take minutes.', connection: 'Connection', connected: 'Live', disconnected: 'Disconnected', state: 'State', idle: 'Idle', progress: 'Progress', last_update: 'Last update', next_update: 'Next update', last_error: 'Last error', none: 'None',
    series_: 'Series', films_: 'Films', full_episodes: 'Full episodes', playlists_scanned: 'Playlists scanned', videos_scanned: 'Videos scanned', built_at: 'Built', sources: 'Sources', add: 'Add', add_placeholder: 'YouTube channel (@handle) or playlist URL…',
    sources_hint: 'Every playlist and the uploads tab of a channel are read; only full episodes (longer than {min} minutes) are kept. The title parser is chosen automatically per channel.', no_sources: 'No sources.', channel: 'Channel', playlist: 'Playlist', profile: 'profile', scans_uploads: 'scans the latest {n} uploads', not_indexed: 'not indexed yet', remove: 'Remove', remove_confirm: 'Remove "{title}"? Its shows will be dropped from the catalogue.', added: 'added', source_added: 'Source added', will_scan: 'scanning now', add_failed: 'Could not add', remove_failed: 'Could not remove', curation: 'Manual curation',
    curation_hint: 'To fix a tag, synopsis or title, edit overrides.json (keyed by the show id in the URL) or call PUT /api/overrides/shows/:id. Spelling variants can be merged through the aliases section.', static_readonly: 'Source management is available on the server edition only (sources.json in the repository).',
    toast_new_one: 'New episode', toast_new_many: '{n} new episodes', toast_and_more: 'and {n} more', toast_open: 'Open', toast_built: 'Catalogue built', toast_refreshing: 'Refreshing', toast_refreshing_body: 'Checking sources for new episodes…', toast_refresh_failed: 'Refresh failed',
    loading: 'Loading…', building_first: 'Building the catalogue for the first time…', building_listing: 'Reading channel playlists…', building_playlists: 'Fetching playlists…', building_details: 'Fetching episode details…', building_building: 'Organising the catalogue…', building_hint: 'The first build takes a few minutes because hundreds of playlists are scanned. The page appears automatically when done.', server_error: 'Cannot reach the server:', retry: 'Retry', not_found: 'Page not found',
    footer: 'An unofficial index of documentaries publicly available on YouTube. Playback uses the official YouTube player; all rights belong to their owners.',
    player_err_2: 'Invalid video id.', player_err_5: 'This video cannot be played in this browser.', player_err_100: 'Video unavailable (removed or private).', player_err_101: 'The channel does not allow embedding this video.', player_err_153: 'The browser blocked the page referrer to YouTube (error 153). Try another browser or open on YouTube.', player_err_other: 'Playback failed (code {code}).',
    unit_h: 'h', unit_m: 'min', ep_one: '1 episode', ep_two: '2 episodes', ep_few: '{n} episodes', ep_many: '{n} episodes', titles_one: '1 title',
  },
};

const Ctx = createContext(null);
const KEY = 'dh.lang';

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { const v = localStorage.getItem(KEY); if (v === 'ar' || v === 'en') return v; } catch { /* no storage */ }
    return 'ar';
  });
  const setLang = useCallback((l) => { setLangState(l); try { localStorage.setItem(KEY, l); } catch { /* ignore */ } }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = `${APP_NAME[lang]} — ${TAGLINE[lang]}`;
  }, [lang]);
  const value = useMemo(() => {
    const dict = STRINGS[lang];
    const t = (key, vars) => {
      let s = dict[key] ?? STRINGS.ar[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      return s;
    };
    return { lang, setLang, t, dir: lang === 'ar' ? 'rtl' : 'ltr', locale: lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', appName: APP_NAME[lang], tagline: TAGLINE[lang] };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLang outside provider');
  return v;
}

/** Display name of a channel in the active language. */
export function channelName(channel, lang) {
  if (!channel) return '';
  if (lang === 'en' && channel.lang !== 'en') return channel.nameEn || channel.title || channel.short;
  return channel.short || channel.title;
}
