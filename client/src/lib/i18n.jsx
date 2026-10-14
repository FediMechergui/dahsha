import { DOCUMENTARIES, PRODUCT } from './product.js';
// Two-language UI (English default, Arabic). Tailored for Movies & TV Series streaming.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const APP_NAME = DOCUMENTARIES ? { ar: 'دهشة', en: 'Dahsha' } : { ar: 'فليكسر', en: 'Flixer' };
export const TAGLINE = DOCUMENTARIES ? { ar: 'وثائقيات تدهشك', en: 'Documentaries that amaze' } : { ar: 'أفلام ومسلسلات بلا حدود', en: 'Movies & TV Series' };

const STRINGS = {
  ar: {
    nav_home: 'الرئيسية', nav_browse: 'تصفح', nav_films: 'الأفلام', nav_movies: 'الأفلام', nav_series: 'المسلسلات', nav_latest: 'الأحدث', nav_my: 'قائمتي', nav_sources: 'السيرفرات',
    search_placeholder: 'ابحث عن فيلم أو مسلسل…', search: 'بحث', menu: 'القائمة', lang_switch: 'English',
    status_offline: 'غير متصل', status_live: 'مباشر', status_details: 'يجلب التفاصيل', status_playlists: 'يفحص المحتوى', status_building: 'يبني الفهرس', status_listing: 'يفحص المصادر', status_static: 'محدّث',
    status_last: 'آخر تحديث', status_never: 'لم يُحدَّث بعد', status_click: 'اضغط للتحديث الآن',
    hero_watch: 'شاهد الآن', hero_details: 'التفاصيل والحلقات', hero_last_episode: 'آخر حلقة',
    stat_series: 'مسلسلاً', stat_films: 'فيلماً', stat_episodes: 'حلقة كاملة', stat_hours: 'ساعة مشاهدة', stat_channels: 'تصنيفات',
    row_continue: 'متابعة المشاهدة', row_latest_eps: 'أحدث الحلقات', row_latest_eps_sub: 'آخر الحلقات المضافة', row_new_series: 'مسلسلات محدّثة مؤخراً', row_films: 'أفلام رائجة', row_films_sub: 'أحدث الأفلام العالمية', row_popular: 'الأكثر مشاهدة', see_all: 'عرض الكل', titles_count: 'عنواناً', episodes_count: 'حلقة', browse_all: 'تصفّح كل المحتوى',
    browse_title: 'تصفح الأفلام والمسلسلات', browse_films: 'أفلام', browse_series: 'مسلسلات', browse_sub: 'أحدث الإصدارات بجودة عالية', browse_within: 'ضمن', all_channels: 'كل التصنيفات', all: 'الكل', kind_series: 'مسلسلات', kind_films: 'أفلام',
    filter_name: 'تصفية بالاسم…', sort: 'ترتيب:', sort_latest: 'الأحدث تحديثاً', sort_title: 'الاسم (أ-ي)', sort_episodes: 'عدد الحلقات', sort_views: 'الأكثر مشاهدة', sort_duration: 'الأطول',
    empty_results: 'لا توجد نتائج', empty_results_body: 'جرّب تصنيفاً آخر أو امسح التصفية.',
    badge_new: 'جديد', badge_film: 'فيلم', kind_film_label: 'فيلم سينمائي', kind_series_label: 'مسلسل تلفزيوني', seasons: 'مواسم', season: 'الموسم', other_episodes: 'حلقات أخرى', views: 'مشاهدة', now_playing: 'يُعرض الآن', watched: 'تمت مشاهدتها',
    show_missing: 'العمل غير موجود', show_missing_body: 'ربما تم نقله أو تغيّر عنوانه.', back_to_browse: 'العودة إلى التصفح', episodes: 'الحلقات', the_film: 'الفيلم', published: 'سنة الإصدار', last_added: 'آخر إضافة', continue_watching: 'متابعة المشاهدة', watch_film: 'شاهد الفيلم', watch_now: 'شاهد الآن', in_my_list: 'في قائمتي', add_to_list: 'أضف إلى قائمتي', also_known: 'يُعرف أيضاً بـ:', related: 'أعمال مشابهة', related_sub: 'عناوين من التصنيفات نفسها',
    episode_missing: 'الحلقة غير موجودة', next_in: 'الحلقة التالية خلال', seconds: 'ثوانٍ', play_now: 'شغّل الآن', cancel: 'إلغاء', episode: 'الحلقة', of: 'من', prev_episode: 'الحلقة السابقة', next_episode: 'الحلقة التالية', autoplay_next: 'تشغيل تلقائي للحلقة التالية', open_youtube: 'فتح في المصدر', watch_on_youtube: 'مشاهدة', open_myflixer: 'فتح في Myflixer', watch_on_myflixer: 'شاهد على Myflixer', show_page: 'صفحة العمل', episodes_of: 'حلقات',
    search_results: 'نتائج البحث عن', shows_label: 'الأعمال', episodes_label: 'الحلقات', no_results: 'لا نتائج', no_results_body: 'جرّب كلمات بحث أخرى أو اسم فيلم مختلف.',
    my_title: 'قائمتي', my_sub: 'أفلامك ومسلسلاتك المفضّلة — محفوظة على هذا الجهاز', my_empty: 'قائمتك فارغة', my_empty_body: 'أضف أفلاماً أو مسلسلات إلى قائمتك للرجوع إليها سريعاً.', favorites: 'المفضّلة', watched_list: 'شاهدتها', clear_history: 'مسح السجل',
    sources_title: 'السيرفرات والمصادر', sources_sub: 'نظام تشغيل متعدد السيرفرات مدعوم بـ 7 مشغلات مدمجة.', sources_static_sub: 'تحديث المحتوى والسيرفرات يتم تلقائياً.',
    refresh_status: 'حالة التحديث', refresh_now: 'تحديث الآن', full_rebuild: 'إعادة بناء كاملة', full_rebuild_confirm: 'إعادة التحديث من الصفر؟', connection: 'الاتصال', connected: 'متصل مباشرة', disconnected: 'منقطع', state: 'الحالة', idle: 'خامل', progress: 'التقدم', last_update: 'آخر تحديث', next_update: 'التحديث القادم', last_error: 'آخر خطأ', none: 'لا شيء',
    series_: 'مسلسلات', films_: 'أفلام', full_episodes: 'حلقات كاملة', playlists_scanned: 'أعمال مفحوصة', videos_scanned: 'سيرفرات مفحوصة', built_at: 'بُني في', sources: 'المصادر', add: 'إضافة', add_placeholder: 'رابط المحتوى…',
    sources_hint: 'مشغلات متعددة تضمن استقرار البث وسرعة التحميل وجودة تصل إلى 1080p.', no_sources: 'لا توجد مصادر.', channel: 'المصدر', playlist: 'المسلسل', profile: 'نمط', scans_uploads: 'تحديث مستمر', not_indexed: 'غير مفهرس', remove: 'إزالة', remove_confirm: 'إزالة العمل؟', added: 'أُضيف', source_added: 'أُضيف المصدر', will_scan: 'جارٍ الفحص', add_failed: 'تعذّرت الإضافة', remove_failed: 'تعذّرت الإزالة', curation: 'تخصيص يدوي',
    curation_hint: 'تخصيص المحتوى والتصنيفات.', static_readonly: 'نسخة ثابتة.',
    toast_new_one: 'حلقة جديدة', toast_new_many: '{n} حلقات جديدة', toast_and_more: 'و{n} أخرى', toast_open: 'افتح', toast_built: 'اكتمل تجهيز المحتوى', toast_refreshing: 'جارٍ التحديث', toast_refreshing_body: 'جلب أحدث الأفلام والمسلسلات…', toast_refresh_failed: 'تعذّر التحديث',
    loading: 'جارٍ التحميل…', building_first: 'نجهّز المحتوى…', building_listing: 'نجلب أحدث الأفلام…', building_playlists: 'نجلب المسلسلات…', building_details: 'نجلب تفاصيل الحلقات…', building_building: 'نرتّب الأفلام والمسلسلات…', building_hint: 'لحظات ونكون جاهزين.', server_error: 'تعذّر الوصول إلى الخادم:', retry: 'إعادة المحاولة', not_found: 'الصفحة غير موجودة',
    footer: 'فليكسر (Flixer) — منصة بث الأفلام والمسلسلات العالمية بأحدث السيرفرات السريعة والمستقرة.',
    player_err_2: 'معرّف الفيديو غير صالح.', player_err_5: 'تعذّر تشغيل الفيديو في هذا المتصفح.', player_err_100: 'الفيديو غير متاح.', player_err_101: 'السيرفر غير متاح حالياً.', player_err_153: 'خطأ في تشغيل السيرفر.', player_err_other: 'تعذّر تشغيل الفيديو (رمز {code}).',
    load_more: 'عرض المزيد', unit_h: 'س', unit_m: 'د', ep_one: 'حلقة واحدة', ep_two: 'حلقتان', ep_few: '{n} حلقات', ep_many: '{n} حلقة', titles_one: 'عنوان واحد',
  },
  en: {
    nav_home: 'Home', nav_browse: 'Browse', nav_films: 'Movies', nav_movies: 'Movies', nav_series: 'TV Shows', nav_latest: 'Latest', nav_my: 'My List', nav_sources: 'Servers',
    search_placeholder: 'Search movies & TV series…', search: 'Search', menu: 'Menu', lang_switch: 'العربية',
    status_offline: 'Offline', status_live: 'Live', status_details: 'Fetching details', status_playlists: 'Scanning content', status_building: 'Building', status_listing: 'Checking sources', status_static: 'Updated',
    status_last: 'Last update', status_never: 'Not updated yet', status_click: 'click to refresh now',
    hero_watch: 'Watch Now', hero_details: 'Details & Episodes', hero_last_episode: 'Latest Episode',
    stat_series: 'series', stat_films: 'movies', stat_episodes: 'episodes', stat_hours: 'hours', stat_channels: 'genres',
    row_continue: 'Continue Watching', row_latest_eps: 'Latest Episodes', row_latest_eps_sub: 'Recently added episodes', row_new_series: 'Updated TV Series', row_films: 'Trending Movies', row_films_sub: 'Latest worldwide releases', row_popular: 'Most Watched', see_all: 'See all', titles_count: 'titles', episodes_count: 'episodes', browse_all: 'Browse all content',
    browse_title: 'Browse Movies & TV Shows', browse_films: 'Movies', browse_series: 'TV Shows', browse_sub: 'Stream latest releases in high definition', browse_within: 'in', all_channels: 'All Genres', all: 'All', kind_series: 'Series', kind_films: 'Movies',
    filter_name: 'Filter by name…', sort: 'Sort:', sort_latest: 'Recently Updated', sort_title: 'Title (A–Z)', sort_episodes: 'Episode Count', sort_views: 'Most Watched', sort_duration: 'Longest',
    empty_results: 'No results found', empty_results_body: 'Try another genre or search query.',
    badge_new: 'New', badge_film: 'Movie', kind_film_label: 'Feature Movie', kind_series_label: 'TV Series', seasons: 'seasons', season: 'Season', other_episodes: 'Other episodes', views: 'views', now_playing: 'Now Playing', watched: 'Watched',
    show_missing: 'Title not found', show_missing_body: 'It may have been removed or renamed.', back_to_browse: 'Back to browse', episodes: 'Episodes', the_film: 'The Movie', published: 'Release Year', last_added: 'Last added', continue_watching: 'Continue Watching', watch_film: 'Watch Movie', watch_now: 'Watch Now', in_my_list: 'In My List', add_to_list: 'Add to My List', also_known: 'Also known as:', related: 'You may also like', related_sub: 'Titles from the same genres',
    episode_missing: 'Episode not found', next_in: 'Next episode in', seconds: 'seconds', play_now: 'Play now', cancel: 'Cancel', episode: 'Episode', of: 'of', prev_episode: 'Previous episode', next_episode: 'Next episode', autoplay_next: 'Autoplay next episode', open_youtube: 'Source', watch_on_youtube: 'Watch', open_myflixer: 'Open on Myflixer', watch_on_myflixer: 'Watch on Myflixer', show_page: 'Title details', episodes_of: 'Episodes of',
    search_results: 'Search results for', shows_label: 'Titles', episodes_label: 'Episodes', no_results: 'No results', no_results_body: 'Try fewer words or check spelling.',
    my_title: 'My List', my_sub: 'Your favourites and watchlist saved on this device', my_empty: 'Your watchlist is empty', my_empty_body: 'Add titles to your list to easily watch them anytime.', favorites: 'Favourites', watched_list: 'Watched', clear_history: 'Clear history',
    sources_title: 'Servers & Streaming', sources_sub: 'Multi-server streaming powered by 7 integrated playback providers.', sources_static_sub: 'Content and servers update automatically.',
    refresh_status: 'Refresh status', refresh_now: 'Refresh now', full_rebuild: 'Full rebuild', full_rebuild_confirm: 'Refresh catalogue from scratch?', connection: 'Connection', connected: 'Live', disconnected: 'Disconnected', state: 'State', idle: 'Idle', progress: 'Progress', last_update: 'Last update', next_update: 'Next update', last_error: 'Last error', none: 'None',
    series_: 'Series', films_: 'Movies', full_episodes: 'Full episodes', playlists_scanned: 'Titles scanned', videos_scanned: 'Servers verified', built_at: 'Built', sources: 'Servers', add: 'Add', add_placeholder: 'Media URL…',
    sources_hint: 'Redundant players ensure instant buffering and multi-CDN failover up to 1080p.', no_sources: 'No sources found.', channel: 'Provider', playlist: 'Series', profile: 'Profile', scans_uploads: 'Continuous sync', not_indexed: 'Not indexed', remove: 'Remove', remove_confirm: 'Remove title?', added: 'Added', source_added: 'Source added', will_scan: 'Scanning now', add_failed: 'Could not add', remove_failed: 'Could not remove', curation: 'Curation',
    curation_hint: 'Customization settings.', static_readonly: 'Static client.',
    toast_new_one: 'New episode', toast_new_many: '{n} new episodes', toast_and_more: 'and {n} more', toast_open: 'Open', toast_built: 'Catalogue ready', toast_refreshing: 'Refreshing', toast_refreshing_body: 'Fetching latest releases…', toast_refresh_failed: 'Refresh failed',
    loading: 'Loading…', building_first: 'Loading catalog…', building_listing: 'Fetching movies…', building_playlists: 'Fetching TV shows…', building_details: 'Fetching episodes…', building_building: 'Organising catalogue…', building_hint: 'Ready in just a moment.', server_error: 'Cannot reach server:', retry: 'Retry', not_found: 'Page not found',
    footer: 'Flixer — Free movies and TV series streaming platform with multi-server playback.',
    player_err_2: 'Invalid video id.', player_err_5: 'This stream cannot be played in this browser.', player_err_100: 'Video unavailable.', player_err_101: 'Server unavailable.', player_err_153: 'Stream connection error.', player_err_other: 'Playback failed (code {code}).',
    load_more: 'Load more', unit_h: 'h', unit_m: 'min', ep_one: '1 episode', ep_two: '2 episodes', ep_few: '{n} episodes', ep_many: '{n} episodes', titles_one: '1 title',
  },
};

if (DOCUMENTARIES) {
  Object.assign(STRINGS.en, {
    nav_movies: 'Documentary Films', nav_films: 'Films', nav_series: 'Docuseries', nav_sources: 'Sources',
    search_placeholder: 'Search documentaries...', stat_films: 'films', stat_channels: 'channels',
    row_films: 'Documentary Films', row_films_sub: 'Full-length documentaries', row_new_series: 'Recently updated docuseries',
    browse_title: 'Browse Documentaries', browse_films: 'Documentary Films', browse_series: 'Docuseries',
    browse_sub: 'Full-length documentaries by show and topic', all_channels: 'All Channels', kind_films: 'Films',
    kind_film_label: 'Documentary Film', kind_series_label: 'Docuseries', the_film: 'The Film', watch_film: 'Watch Film',
    sources_title: 'Documentary Sources', sources_sub: 'Manage documentary channels and catalogue refreshes.',
    sources: 'Sources', sources_hint: 'Add a documentary YouTube channel or playlist.', add_placeholder: 'YouTube channel or playlist URL',
    remove_confirm: 'Remove this source?', profile: 'Parsing profile', scans_uploads: 'Scans uploads',
    footer: 'Dahsha - full-length documentaries in Arabic and English. Playback belongs to the original channels.',
  });
  Object.assign(STRINGS.ar, {
    nav_movies: 'أفلام وثائقية', nav_films: 'أفلام', nav_series: 'سلاسل وثائقية', nav_sources: 'المصادر',
    search_placeholder: 'ابحث عن وثائقي…', stat_films: 'أفلام', stat_channels: 'قنوات',
    row_films: 'أفلام وثائقية', row_films_sub: 'وثائقيات كاملة', row_new_series: 'سلاسل وثائقية محدثة',
    browse_title: 'تصفح الوثائقيات', browse_films: 'أفلام وثائقية', browse_series: 'سلاسل وثائقية',
    browse_sub: 'وثائقيات كاملة مرتبة حسب البرنامج والموضوع', all_channels: 'كل القنوات', kind_films: 'أفلام',
    kind_film_label: 'فيلم وثائقي', kind_series_label: 'سلسلة وثائقية', the_film: 'الفيلم', watch_film: 'شاهد الفيلم',
    sources_title: 'مصادر الوثائقيات', sources_sub: 'إدارة القنوات الوثائقية وتحديث الفهرس.',
    sources: 'المصادر', sources_hint: 'أضف قناة وثائقية أو قائمة تشغيل من يوتيوب.', add_placeholder: 'رابط قناة أو قائمة تشغيل يوتيوب',
    remove_confirm: 'إزالة هذا المصدر؟', profile: 'نمط التحليل', scans_uploads: 'يفحص الفيديوهات الجديدة',
    footer: 'دهشة — وثائقيات كاملة بالعربية والإنجليزية. حقوق المحتوى لأصحاب القنوات.',
  });
}

const Ctx = createContext(null);
const KEY = `${PRODUCT}.lang`;

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { const v = localStorage.getItem(KEY); if (v === 'ar' || v === 'en') return v; } catch { /* no storage */ }
    return DOCUMENTARIES ? 'ar' : 'en';
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
