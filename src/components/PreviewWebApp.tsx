import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cleanStreamUrl,
  extractClearKeyFromStream,
  getDashProxyFallbackUrl,
  getDirectFromDashProxyUrl,
} from '../utils/streamUtils';
import {
  getStreamPriorityInfo,
  parseSubtitleText,
  SubtitleCue,
  SubtitleTrackOption,
} from '../utils/subtitleUtils';

export interface CatalogMetaItem {
  id: string;
  type: 'movie' | 'series' | 'tv';
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  originName?: string;
  year?: string;
  episodeCurrent?: string;
  quality?: string;
  lang?: string;
  tmdbVote?: string;
  genres?: string[];
  videos?: Array<{
    id: string;
    title: string;
    season?: number;
    episode?: number;
    released?: string;
  }>;
}

export interface StreamSourceItem {
  name?: string;
  title?: string;
  url?: string;
  externalUrl?: string;
  embedUrl?: string;
  fallbackEmbedUrl?: string;
  isClearkeyFlag?: boolean;
  kidHex?: string;
  keyHex?: string;
  priorityTier?: number;
  audioLabel?: string;
  qualityLabel?: string;
  subtitles?: Array<{
    id?: string;
    url: string;
    lang?: string;
    label?: string;
    name?: string;
  }>;
  behaviorHints?: {
    isLive?: boolean;
    notWebReady?: boolean;
    drm?: string;
    drmLicenseUri?: string;
    proxyHeaders?: {
      request?: Record<string, string>;
    };
  };
}

interface WatchHistoryEntry {
  id: string;
  type: 'movie' | 'series' | 'tv';
  name: string;
  poster?: string;
  episodeId?: string;
  episodeTitle?: string;
  updatedAt: number;
}

interface PreviewWebAppProps {
  onRollbackToClassic: () => void;
  onOpenAddonSettings: () => void;
  onCopyManifestUrl: () => void;
  onOpenQrModal: () => void;
  onShowToast: (msg: string) => void;
}

type LiveTvFilterId =
  | 'tv_tong_hop'
  | 'tv_quoc_te'
  | 'tv_vtv'
  | 'tv_vtvcab'
  | 'tv_giai_tri'
  | 'tv_dia_phuong'
  | 'sports_live_matches';

export interface ActiveCatalogTarget {
  id: string;
  title: string;
  navKey:
    | 'moi-cap-nhat'
    | 'the-loai'
    | 'quoc-gia'
    | 'thuyet-minh'
    | 'phim-le'
    | 'phim-bo'
    | 'hoat-hinh'
    | 'truyen-hinh'
    | 'watchlist'
    | 'search';
  catalogType: 'movie' | 'series' | 'tv';
  subSlug?: string;
}

interface QualityLevelOption {
  id: number; // -1 for Auto
  label: string;
  height?: number;
}

type SubtitleFontSizeKey = 'sm' | 'md' | 'lg' | 'xl';

const SUBTITLE_FONT_SIZES: Array<{
  key: SubtitleFontSizeKey;
  label: string;
  pxClass: string;
  pxValue: number;
}> = [
  { key: 'sm', label: 'Nhỏ', pxClass: 'text-xs sm:text-sm', pxValue: 14 },
  { key: 'md', label: 'Vừa', pxClass: 'text-sm sm:text-base', pxValue: 18 },
  { key: 'lg', label: 'Lớn', pxClass: 'text-base sm:text-lg md:text-xl', pxValue: 22 },
  { key: 'xl', label: 'Rất Lớn', pxClass: 'text-lg sm:text-xl md:text-2xl', pxValue: 28 },
];

const LIVE_TV_FILTERS: Array<{ id: LiveTvFilterId; label: string }> = [
  { id: 'tv_tong_hop', label: 'Toàn Bộ Kênh TV' },
  { id: 'tv_quoc_te', label: 'Kênh Quốc Tế (28 Kênh)' },
  { id: 'tv_vtv', label: 'Kênh VTV' },
  { id: 'tv_vtvcab', label: 'VTVcab & ON TV' },
  { id: 'tv_giai_tri', label: 'HTV • SCTV • Giải Trí' },
  { id: 'tv_dia_phuong', label: 'Kênh Địa Phương' },
  { id: 'sports_live_matches', label: 'Bóng Đá Live' },
];

const GENRE_OPTIONS: Array<{ id: string; name: string; slug: string }> = [
  { id: 'the_loai_hanh_dong', name: 'Hành Động', slug: 'hanh-dong' },
  { id: 'the_loai_phieu_luu', name: 'Phiêu Lưu', slug: 'phieu-luu' },
  { id: 'the_loai_hai_huoc', name: 'Hài Hước', slug: 'hai-huoc' },
  { id: 'the_loai_tinh_cam', name: 'Tình Cảm', slug: 'tinh-cam' },
  { id: 'the_loai_tam_ly', name: 'Tâm Lý', slug: 'tam-ly' },
  { id: 'the_loai_hinh_su', name: 'Hình Sự', slug: 'hinh-su' },
  { id: 'the_loai_kinh_di', name: 'Kinh Dị', slug: 'kinh-di' },
  { id: 'the_loai_vien_tuong', name: 'Khoa Học Viễn Tưởng', slug: 'vien-tuong' },
  { id: 'the_loai_vo_thuat', name: 'Võ Thuật', slug: 'vo-thuat' },
  { id: 'the_loai_co_trang', name: 'Cổ Trang', slug: 'co-trang' },
  { id: 'the_loai_chien_tranh', name: 'Chiến Tranh', slug: 'chien-tranh' },
  { id: 'the_loai_bi_an', name: 'Bí Ẩn', slug: 'bi-an' },
  { id: 'the_loai_gia_dinh', name: 'Gia Đình', slug: 'gia-dinh' },
  { id: 'the_loai_tai_lieu', name: 'Tài Liệu', slug: 'tai-lieu' },
  { id: 'the_loai_than_thoai', name: 'Thần Thoại', slug: 'than-thoai' },
];

const COUNTRY_OPTIONS: Array<{ id: string; name: string; slug: string }> = [
  { id: 'quoc_gia_au_my', name: 'Âu Mỹ', slug: 'au-my' },
  { id: 'quoc_gia_han_quoc', name: 'Hàn Quốc', slug: 'han-quoc' },
  { id: 'quoc_gia_trung_quoc', name: 'Trung Quốc', slug: 'trung-quoc' },
  { id: 'quoc_gia_nhat_ban', name: 'Nhật Bản', slug: 'nhat-ban' },
  { id: 'quoc_gia_thai_lan', name: 'Thái Lan', slug: 'thai-lan' },
  { id: 'quoc_gia_anh', name: 'Anh', slug: 'anh' },
  { id: 'quoc_gia_phap', name: 'Pháp', slug: 'phap' },
  { id: 'quoc_gia_hong_kong', name: 'Hồng Kông', slug: 'hong-kong' },
  { id: 'quoc_gia_dai_loan', name: 'Đài Loan', slug: 'dai-loan' },
  { id: 'quoc_gia_viet_nam', name: 'Việt Nam', slug: 'viet-nam' },
  { id: 'quoc_gia_an_do', name: 'Ấn Độ', slug: 'an-do' },
];

const WATCHLIST_STORAGE_KEY = 'tgcp_watchlist_v1';
const HISTORY_STORAGE_KEY = 'tgcp_history_v1';
const SUB_FONT_STORAGE_KEY = 'tgcp_sub_font_v1';
const CATALOG_CACHE_PREFIX = 'tgcp_cat_cache_v3_';

// Fast in-memory catalog cache across tab switches
const catalogMemoryCache = new Map<
  string,
  { items: CatalogMetaItem[]; totalPages: number; timestamp: number }
>();

function readCachedCatalog(cacheKey: string): {
  items: CatalogMetaItem[];
  totalPages: number;
} | null {
  const mem = catalogMemoryCache.get(cacheKey);
  if (mem && mem.items.length > 0) {
    return { items: mem.items, totalPages: mem.totalPages };
  }
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
      catalogMemoryCache.set(cacheKey, {
        items: parsed.items,
        totalPages: Number(parsed.totalPages) || 2538,
        timestamp: Number(parsed.timestamp) || Date.now(),
      });
      return {
        items: parsed.items,
        totalPages: Number(parsed.totalPages) || 2538,
      };
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeCachedCatalog(cacheKey: string, items: CatalogMetaItem[], totalPages: number) {
  if (!items || items.length === 0) return;
  const payload = { items, totalPages, timestamp: Date.now() };
  catalogMemoryCache.set(cacheKey, payload);
  try {
    localStorage.setItem(CATALOG_CACHE_PREFIX + cacheKey, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
}

const CINEMAWORLD_FALLBACK_LOGO =
  'https://www.voilah.sg/wp-content/uploads/2020/04/cinema-world-2.png';

const SafePosterImage: React.FC<{
  src?: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className = '' }) => {
  const [failed, setFailed] = useState(false);

  const resolvedSrc = useMemo(() => {
    if (alt && alt.toLowerCase().includes('cinemaworld')) {
      return CINEMAWORLD_FALLBACK_LOGO;
    }
    if (src && src.includes('uG9Z4g4')) {
      return CINEMAWORLD_FALLBACK_LOGO;
    }
    return src;
  }, [src, alt]);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (!resolvedSrc || failed || resolvedSrc.includes('via.placeholder.com')) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black text-zinc-300 p-4 text-center select-none ${className}`}
      >
        <svg
          className="w-8 h-8 text-amber-400/80 mb-2 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.6}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
          />
        </svg>
        <span className="text-xs font-semibold line-clamp-2 leading-snug text-zinc-200">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth === 161 && img.naturalHeight === 81) {
          setFailed(true);
        }
      }}
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

function extractCardMeta(item: CatalogMetaItem) {
  let originName = item.originName || '';
  let year = item.year || item.releaseInfo || '';

  if ((!originName || !year) && item.description) {
    const parts = item.description.split('•');
    if (!originName && parts[0]) {
      originName = parts[0].trim();
    }
    if (!year && parts[1]) {
      const m = parts[1].match(/\d{4}/);
      if (m) year = m[0];
    }
  }
  if (!originName) originName = item.name;
  if (!year || year === 'N/A') year = '2026';

  const rawEp = (item.episodeCurrent || (item.type === 'series' ? 'TẬP MỚI' : 'FULL')).toUpperCase();
  const isFull =
    rawEp.includes('FULL') ||
    rawEp.includes('HOÀN TẤT') ||
    (item.type === 'movie' && !rawEp.includes('TẬP'));
  const epBadge =
    isFull && !rawEp.includes('TẬP') ? 'FULL' : rawEp.replace(/HOÀN TẤT/gi, '').trim() || 'FULL';
  const qualityBadge = (item.quality || 'FHD').toUpperCase();

  const rawLang = (item.lang || 'VIETSUB').toUpperCase();
  let langLabel = 'VIETSUB';
  if (rawLang.includes('THUYẾT MINH') && rawLang.includes('VIETSUB')) {
    langLabel = 'VIETSUB + THUYẾT MINH';
  } else if (rawLang.includes('THUYẾT MINH')) {
    langLabel = 'THUYẾT MINH';
  } else if (rawLang.includes('LỒNG TIẾNG')) {
    langLabel = 'LỒNG TIẾNG';
  }

  return {
    originName,
    year,
    epBadge,
    isFull,
    qualityBadge,
    langLabel,
  };
}

/**
 * Sorts and enriches playable streams by strict priority:
 * 1. Thuyết Minh / Lồng Tiếng (Priority #1)
 * 2. Vietsub / Phụ Đề Tiếng Việt (Priority #2)
 * 3. Các nguồn phát khác (Priority #3)
 * Also ensures companion Web/Nuvio embeds exist when fallbackEmbedUrl is present so both cards are populated.
 */
function buildPrioritizedStreams(
  rawStreams: StreamSourceItem[],
  isLiveTv: boolean
): StreamSourceItem[] {
  const playable = rawStreams.filter((s) => Boolean(s.url || s.externalUrl || s.embedUrl));
  if (isLiveTv) return playable;

  // Ensure that if a direct HLS stream has a fallbackEmbedUrl not yet represented as a Web/Nuvio stream,
  // we also include it as a Web/Nuvio option so the Web/Nuvio card always has choices.
  const existingEmbedUrls = new Set(
    playable
      .filter((s) => !s.url && (s.embedUrl || s.externalUrl))
      .map((s) => s.embedUrl || s.externalUrl)
  );
  const augmented = [...playable];

  for (const st of playable) {
    if (st.url && st.fallbackEmbedUrl && !existingEmbedUrls.has(st.fallbackEmbedUrl)) {
      existingEmbedUrls.add(st.fallbackEmbedUrl);
      const baseName = (st.name || 'Server VIP')
        .replace(/\[(.*?)\s+Fast\]/i, '[$1 Web/Nuvio]')
        .replace(/\[(.*?)\s+HLS\]/i, '[$1 Web/Nuvio]')
        .replace(/•\s*\[Proxy Anti-Block\]/i, '');
      augmented.push({
        name: baseName.includes('Web') || baseName.includes('Embed') ? baseName : `🌐 [Web/Nuvio] ${baseName}`,
        title: st.title,
        embedUrl: st.fallbackEmbedUrl,
        externalUrl: st.fallbackEmbedUrl,
        priorityTier: st.priorityTier,
        audioLabel: st.audioLabel,
        qualityLabel: st.qualityLabel,
      });
    }
  }

  return augmented.sort((a, b) => {
    const infoA = getStreamPriorityInfo(a);
    const infoB = getStreamPriorityInfo(b);

    // 1. Strict Language Priority: 1 (Thuyết Minh) < 2 (Vietsub) < 3 (Other)
    if (infoA.tier !== infoB.tier) {
      return infoA.tier - infoB.tier;
    }

    // 2. Within same language priority: Direct HLS first so player controls & 3s watchdog work natively
    if (infoA.isDirectHls !== infoB.isDirectHls) {
      return infoA.isDirectHls ? -1 : 1;
    }

    // 3. Prefer non-proxy direct CDN before proxy fallback
    const aProxy = Boolean(a.url && a.url.includes('/proxy/'));
    const bProxy = Boolean(b.url && b.url.includes('/proxy/'));
    if (aProxy !== bProxy) {
      return aProxy ? 1 : -1;
    }

    return 0;
  });
}

const CinemaGridCard: React.FC<{
  item: CatalogMetaItem;
  onSelect: (item: CatalogMetaItem) => void;
}> = ({ item, onSelect }) => {
  const isTv = item.type === 'tv';

  if (isTv) {
    return (
      <div
        onClick={() => onSelect({ ...item, type: 'tv' })}
        className="group bg-[#111622]/95 hover:bg-[#161d2d] border border-white/10 hover:border-amber-500/60 rounded-xl overflow-hidden flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-md"
      >
        <div className="relative aspect-video w-full bg-[#070a12] flex items-center justify-center p-3 overflow-hidden">
          <SafePosterImage
            src={item.poster}
            alt={item.name}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
          />
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-extrabold uppercase tracking-wider shadow">
            LIVE
          </span>
        </div>
        <div className="p-2.5 border-t border-white/5">
          <h4 className="text-xs font-bold text-zinc-100 group-hover:text-amber-400 truncate">
            {item.name}
          </h4>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="truncate">{item.description || 'Truyền hình trực tiếp'}</span>
          </div>
        </div>
      </div>
    );
  }

  const { originName, year, epBadge, isFull, qualityBadge, langLabel } = extractCardMeta(item);

  return (
    <div
      onClick={() => onSelect(item)}
      className="group bg-[#111520]/95 hover:bg-[#161c2a] border border-white/[0.08] hover:border-amber-500/50 rounded-xl overflow-hidden flex flex-col transition-all duration-300 hover:-translate-y-1 shadow-lg cursor-pointer"
    >
      <div className="relative aspect-[2/3] w-full bg-zinc-900 overflow-hidden">
        <SafePosterImage
          src={item.poster}
          alt={item.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 via-black/25 to-transparent pointer-events-none" />

        <div className="absolute top-2.5 left-2.5 z-10 flex flex-col items-start gap-1">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide text-white shadow-md ${
              isFull ? 'bg-red-600' : 'bg-indigo-600'
            }`}
          >
            {epBadge}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-black/85 text-zinc-100 border border-white/15 shadow">
            {qualityBadge}
          </span>
        </div>

        <div className="absolute bottom-2 right-2 z-10">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/80 border border-white/10 text-[10px] font-semibold text-zinc-200 backdrop-blur-xs">
            <svg
              className="w-2.5 h-2.5 text-amber-400 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>{year}</span>
          </span>
        </div>

        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="w-11 h-11 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-xl transform scale-90 group-hover:scale-100 transition-transform">
            <svg className="w-5 h-5 fill-current ml-0.5" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="p-3 flex-1 flex flex-col justify-between bg-[#111520]/95">
        <div>
          <h4
            title={item.name}
            className="text-[13px] font-bold text-zinc-100 group-hover:text-amber-400 transition-colors truncate leading-snug"
          >
            {item.name}
          </h4>
          <p title={originName} className="text-[11px] text-zinc-400 truncate mt-0.5 font-mono">
            {originName}
          </p>
        </div>

        <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-zinc-300 uppercase">
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-xs bg-amber-500/20 text-amber-400 text-[8px]">
            ▶
          </span>
          <span className="truncate">{langLabel}</span>
        </div>
      </div>
    </div>
  );
};

export const PreviewWebApp: React.FC<PreviewWebAppProps> = ({
  onRollbackToClassic,
  onOpenAddonSettings,
  onCopyManifestUrl,
  onOpenQrModal,
  onShowToast,
}) => {
  const [activeCatalog, setActiveCatalog] = useState<ActiveCatalogTarget>({
    id: 'cat_phim_moi_cap_nhat',
    title: 'Phim Mới Cập Nhật Hôm Nay',
    navKey: 'moi-cap-nhat',
    catalogType: 'movie',
  });

  const [openDropdown, setOpenDropdown] = useState<'the-loai' | 'quoc-gia' | 'settings' | null>(
    null
  );

  // Two separate dropdown states for the 2 stream source cards: Direct HLS & Web/Nuvio
  const [openSourceCardDropdown, setOpenSourceCardDropdown] = useState<
    'direct-hls' | 'web-nuvio' | null
  >(null);

  // Player control popover states (Subtitles & Video Quality)
  const [openPlayerMenu, setOpenPlayerMenu] = useState<'subtitles' | 'quality' | null>(null);

  const navBarRef = useRef<HTMLDivElement | null>(null);
  const sourceCardsRef = useRef<HTMLDivElement | null>(null);
  const playerControlsBarRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [liveTvFilter, setLiveTvFilter] = useState<LiveTvFilterId>('tv_tong_hop');

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Seed initial state from client cache if available for 0ms first render
  const initialCachedHome = useMemo(
    () => readCachedCatalog('movie_cat_phim_moi_cap_nhat_p1'),
    []
  );

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialCachedHome?.totalPages || 850);
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  const [items, setItems] = useState<CatalogMetaItem[]>(initialCachedHome?.items || []);
  const [isLoading, setIsLoading] = useState(!initialCachedHome);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const [spotlightPool, setSpotlightPool] = useState<CatalogMetaItem[]>(
    initialCachedHome?.items ? initialCachedHome.items.slice(0, 8) : []
  );
  const [heroIndex, setHeroIndex] = useState(0);

  const [watchlist, setWatchlist] = useState<CatalogMetaItem[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Active Watch / Detail state
  const [selectedItem, setSelectedItem] = useState<CatalogMetaItem | null>(null);
  const [detailMeta, setDetailMeta] = useState<CatalogMetaItem | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('');
  const [streams, setStreams] = useState<StreamSourceItem[]>([]);
  const [selectedStreamIdx, setSelectedStreamIdx] = useState(0);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [playerStatusMsg, setPlayerStatusMsg] = useState('');
  const [runtimeFallbackEmbedUrl, setRuntimeFallbackEmbedUrl] = useState('');
  const [streamWatchdogCountdown, setStreamWatchdogCountdown] = useState<number | null>(null);

  // Player OSD & Interactive Controls State
  const [osdMessage, setOsdMessage] = useState<string>('');
  const osdTimerRef = useRef<number | null>(null);

  // Subtitle state
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackOption[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>('auto');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [subtitleFontSize, setSubtitleFontSize] = useState<SubtitleFontSizeKey>(() => {
    try {
      const saved = localStorage.getItem(SUB_FONT_STORAGE_KEY) as SubtitleFontSizeKey;
      if (saved && ['sm', 'md', 'lg', 'xl'].includes(saved)) return saved;
    } catch {
      // ignore
    }
    return 'md';
  });
  const [subtitleOffsetSec, setSubtitleOffsetSec] = useState<number>(0);
  const [parsedCues, setParsedCues] = useState<SubtitleCue[]>([]);
  const [activeCueText, setActiveCueText] = useState<string>('');
  const [isLoadingSubtitleText, setIsLoadingSubtitleText] = useState<boolean>(false);

  // Video Quality state
  const [qualityLevels, setQualityLevels] = useState<QualityLevelOption[]>([
    { id: -1, label: 'Tự động (Auto)' },
  ]);
  const [selectedQualityId, setSelectedQualityId] = useState<number>(-1);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shakaPlayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsPlayerRef = useRef<any>(null);
  const failedStreamIndicesRef = useRef<Set<number>>(new Set());

  const triggerOsd = useCallback((msg: string) => {
    setOsdMessage(msg);
    if (osdTimerRef.current) {
      window.clearTimeout(osdTimerRef.current);
    }
    osdTimerRef.current = window.setTimeout(() => {
      setOsdMessage('');
    }, 1800);
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navBarRef.current && !navBarRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
      if (sourceCardsRef.current && !sourceCardsRef.current.contains(e.target as Node)) {
        setOpenSourceCardDropdown(null);
      }
      if (
        playerControlsBarRef.current &&
        !playerControlsBarRef.current.contains(e.target as Node)
      ) {
        setOpenPlayerMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Seek backward / forward helper
  const handleSeekRelative = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (!video) {
        onShowToast('Chức năng tua chỉ khả dụng trên trình phát Direct HLS / DASH.');
        return;
      }
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
      const nextTime = Math.max(0, Math.min(duration, (video.currentTime || 0) + deltaSeconds));
      video.currentTime = nextTime;
      const label = deltaSeconds > 0 ? `⏩ Tua tiến +${deltaSeconds}s` : `⏪ Tua lùi ${deltaSeconds}s`;
      triggerOsd(label);
    },
    [onShowToast, triggerOsd]
  );

  // Keyboard shortcuts (`/` for search, `ArrowLeft` / `ArrowRight` for -10s / +10s seek when watching)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (selectedItem && videoRef.current) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handleSeekRelative(-10);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleSeekRelative(10);
        } else if (e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          setSubtitlesEnabled((prev) => {
            const next = !prev;
            triggerOsd(next ? '🇻🇳 Phụ đề: BẬT' : '🚫 Phụ đề: TẮT');
            return next;
          });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem, handleSeekRelative, triggerOsd]);

  const selectCategory = useCallback((target: ActiveCatalogTarget) => {
    setSelectedItem(null);
    setOpenDropdown(null);
    setActiveCatalog(target);
    setPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Fetch main catalog items with Instant Cache + Parallel Backend Burst
  useEffect(() => {
    if (activeCatalog.navKey === 'watchlist' || activeCatalog.navKey === 'search') {
      return;
    }

    let mounted = true;
    const isAppending = infiniteScrollEnabled && page > 1;
    const effectiveCatalogId =
      activeCatalog.navKey === 'truyen-hinh' ? liveTvFilter : activeCatalog.id;
    const effectiveType =
      activeCatalog.navKey === 'truyen-hinh' ? 'tv' : activeCatalog.catalogType;
    const cacheKey = `${effectiveType}_${effectiveCatalogId}_p${page}`;

    // 1. Instant 0ms display from client cache if not appending
    if (!isAppending) {
      const cached = readCachedCatalog(cacheKey);
      if (cached && cached.items.length > 0) {
        setItems(cached.items);
        setTotalPages(cached.totalPages);
        setIsLoading(false);
        if (activeCatalog.navKey === 'moi-cap-nhat' && page === 1) {
          setSpotlightPool(cached.items.slice(0, 8));
        }
      } else {
        setIsLoading(true);
      }
    } else {
      setIsLoadingMore(true);
    }

    const loadCatalog = async () => {
      try {
        const skip = (page - 1) * 24;
        const url =
          skip > 0 && effectiveType !== 'tv'
            ? `/catalog/${effectiveType}/${effectiveCatalogId}/skip=${skip}.json`
            : `/catalog/${effectiveType}/${effectiveCatalogId}.json`;

        const res = await fetch(url);
        const data = await res.json();
        if (!mounted) return;

        const rawMetas: CatalogMetaItem[] = Array.isArray(data?.metas) ? data.metas : [];
        let resolvedTotalPages = 850;
        if (data?.pagination?.totalPages) {
          resolvedTotalPages = Number(data.pagination.totalPages) || 850;
          setTotalPages(resolvedTotalPages);
        } else if (effectiveType === 'tv') {
          resolvedTotalPages = 1;
          setTotalPages(1);
        }

        const seen = new Set<string>();
        const uniqueBatch: CatalogMetaItem[] = [];
        for (const item of rawMetas) {
          if (!item?.id) continue;
          const key = effectiveType === 'tv' ? `${item.id}_${item.name || ''}` : item.id;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueBatch.push({
              ...item,
              type: item.type || effectiveType,
            });
          }
        }

        if (isAppending && effectiveType !== 'tv') {
          setItems((prev) => {
            const existingIds = new Set(prev.map((x) => x.id));
            const next = [...prev];
            for (const m of uniqueBatch) {
              if (!existingIds.has(m.id)) {
                existingIds.add(m.id);
                next.push(m);
              }
            }
            return next;
          });
        } else if (uniqueBatch.length > 0) {
          setItems(uniqueBatch);
          writeCachedCatalog(cacheKey, uniqueBatch, resolvedTotalPages);
          if (activeCatalog.navKey === 'moi-cap-nhat' && page === 1) {
            setSpotlightPool(uniqueBatch.slice(0, 8));
          }

          // Non-blocking background top-up if fewer than 24 items
          if (effectiveType !== 'tv' && uniqueBatch.length < 24) {
            fetch(`/catalog/${effectiveType}/${effectiveCatalogId}/skip=${skip + 24}.json`)
              .then((r) => r.json())
              .then((extraData) => {
                if (!mounted) return;
                const extraMetas: CatalogMetaItem[] = Array.isArray(extraData?.metas)
                  ? extraData.metas
                  : [];
                if (extraMetas.length === 0) return;
                const merged = [...uniqueBatch];
                for (const item of extraMetas) {
                  if (!item?.id || seen.has(item.id)) continue;
                  seen.add(item.id);
                  merged.push({ ...item, type: item.type || effectiveType });
                  if (merged.length >= 24) break;
                }
                setItems(merged);
                writeCachedCatalog(cacheKey, merged, resolvedTotalPages);
              })
              .catch(() => {});
          }
        }
      } catch {
        if (mounted && !isAppending && items.length === 0) {
          setItems([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    };

    loadCatalog();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCatalog, page, liveTvFilter, infiniteScrollEnabled]);

  // Background prefetch of primary navigation tabs 400ms after mount so switching tabs is instantaneous
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const preloadTargets: Array<{ type: 'movie' | 'series' | 'tv'; id: string }> = [
        { type: 'movie', id: 'cat_phim_le_thuyet_minh' },
        { type: 'movie', id: 'cat_phim_le' },
        { type: 'series', id: 'cat_phim_bo' },
        { type: 'series', id: 'cat_hoat_hinh_anime' },
        { type: 'tv', id: 'tv_tong_hop' },
      ];
      preloadTargets.forEach(({ type, id }) => {
        const key = `${type}_${id}_p1`;
        if (catalogMemoryCache.has(key)) return;
        fetch(`/catalog/${type}/${id}.json`)
          .then((r) => r.json())
          .then((data) => {
            if (Array.isArray(data?.metas) && data.metas.length > 0) {
              writeCachedCatalog(
                key,
                data.metas.map((m: CatalogMetaItem) => ({ ...m, type: m.type || type })),
                Number(data?.pagination?.totalPages) || (type === 'tv' ? 1 : 850)
              );
            }
          })
          .catch(() => {});
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);

  // Auto-advance hero banner every 8 seconds
  useEffect(() => {
    if (spotlightPool.length <= 1 || selectedItem) return;
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % spotlightPool.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [spotlightPool.length, selectedItem]);

  // IntersectionObserver for Infinite Scroll when enabled
  useEffect(() => {
    if (
      selectedItem ||
      !infiniteScrollEnabled ||
      activeCatalog.navKey === 'truyen-hinh' ||
      activeCatalog.navKey === 'watchlist' ||
      activeCatalog.navKey === 'search' ||
      isLoading ||
      isLoadingMore ||
      page >= totalPages
    ) {
      return;
    }

    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setPage((prev) => prev + 1);
        }
      },
      { rootMargin: '420px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    selectedItem,
    infiniteScrollEnabled,
    activeCatalog.navKey,
    isLoading,
    isLoadingMore,
    page,
    totalPages,
  ]);

  const saveHistoryEntry = useCallback(
    (item: CatalogMetaItem, epId?: string, epTitle?: string) => {
      setWatchHistory((prev) => {
        const filtered = prev.filter((x) => x.id !== item.id);
        const updated: WatchHistoryEntry[] = [
          {
            id: item.id,
            type: item.type,
            name: item.name,
            poster: item.poster || item.background,
            episodeId: epId,
            episodeTitle: epTitle,
            updatedAt: Date.now(),
          },
          ...filtered,
        ].slice(0, 18);
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    },
    []
  );

  const toggleWatchlistItem = useCallback(
    (item: CatalogMetaItem) => {
      setWatchlist((prev) => {
        const exists = prev.some((x) => x.id === item.id);
        const updated = exists ? prev.filter((x) => x.id !== item.id) : [item, ...prev];
        try {
          localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
        onShowToast(exists ? 'Đã xóa khỏi Tủ Phim' : 'Đã lưu vào Tủ Phim cá nhân');
        return updated;
      });
    },
    [onShowToast]
  );

  const isInWatchlist = useCallback(
    (id?: string) => {
      if (!id) return false;
      return watchlist.some((x) => x.id === id);
    },
    [watchlist]
  );

  // Fetch subtitles for the current movie/episode
  const loadSubtitlesForTarget = useCallback(
    async (type: 'movie' | 'series' | 'tv', targetVideoId: string, streamList: StreamSourceItem[]) => {
      if (type === 'tv') {
        setSubtitleTracks([]);
        setParsedCues([]);
        setActiveCueText('');
        return;
      }

      const collected: SubtitleTrackOption[] = [];
      const seenUrls = new Set<string>();

      const pushTrack = (id: string, label: string, url: string, lang = 'vi') => {
        if (!url || seenUrls.has(url)) return;
        seenUrls.add(url);
        collected.push({ id, label, url, lang });
      };

      // 1. Collect subtitles attached to streams
      for (const st of streamList) {
        if (Array.isArray(st.subtitles)) {
          st.subtitles.forEach((sub, idx) => {
            if (sub?.url) {
              pushTrack(
                sub.id || `st_sub_${idx}`,
                sub.label || sub.name || `🇻🇳 Phụ đề Tiếng Việt #${collected.length + 1}`,
                sub.url,
                sub.lang || 'vi'
              );
            }
          });
        }
      }

      // 2. Also query the dedicated `/subtitles/:type/:id.json` harvester endpoint
      try {
        const res = await fetch(`/subtitles/${type}/${encodeURIComponent(targetVideoId)}.json`);
        const data = await res.json();
        const apiSubs = Array.isArray(data?.subtitles) ? data.subtitles : [];
        apiSubs.forEach((sub: { id?: string; url?: string; lang?: string; label?: string; name?: string }, idx: number) => {
          if (sub?.url) {
            pushTrack(
              sub.id || `api_sub_${idx}`,
              sub.label || sub.name || `🇻🇳 Phụ đề Tiếng Việt (${sub.lang || 'vi'}) #${collected.length + 1}`,
              sub.url,
              sub.lang || 'vi'
            );
          }
        });
      } catch {
        // ignore subtitle fetch error
      }

      // 3. Always provide the smart scraped fallback endpoint if not already in the list
      const smartFallbackUrl = `/api/sub-smart/${type}/${encodeURIComponent(targetVideoId)}.vtt`;
      pushTrack('sub_smart_default', '🇻🇳 Phụ đề Tiếng Việt (Tự động cào đa nguồn)', smartFallbackUrl, 'vi');

      setSubtitleTracks(collected);
      if (collected.length > 0) {
        setSelectedSubtitleId(collected[0].id);
      }
    },
    []
  );

  // Load and parse the selected subtitle file into cues
  useEffect(() => {
    if (!selectedItem || selectedItem.type === 'tv' || !subtitlesEnabled) {
      setActiveCueText('');
      return;
    }

    const activeTrack =
      subtitleTracks.find((t) => t.id === selectedSubtitleId) || subtitleTracks[0];
    if (!activeTrack?.url) {
      setParsedCues([]);
      setActiveCueText('');
      return;
    }

    let cancelled = false;
    setIsLoadingSubtitleText(true);

    const fetchSubText = async () => {
      try {
        let targetUrl = activeTrack.url;
        // Strip localhost host prefix if present
        targetUrl = targetUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
        const res = await fetch(targetUrl);
        const text = await res.text();
        if (cancelled) return;
        const cues = parseSubtitleText(text);
        setParsedCues(cues);
      } catch {
        if (!cancelled) {
          setParsedCues([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSubtitleText(false);
        }
      }
    };

    fetchSubText();
    return () => {
      cancelled = true;
    };
  }, [selectedItem, subtitleTracks, selectedSubtitleId, subtitlesEnabled]);

  // Sync active subtitle cue with video currentTime
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !subtitlesEnabled || parsedCues.length === 0) {
      setActiveCueText('');
      return;
    }

    const onTimeUpdate = () => {
      const current = (video.currentTime || 0) - subtitleOffsetSec;
      // Find matching cue(s)
      const active = parsedCues.filter((c) => current >= c.start && current <= c.end);
      if (active.length > 0) {
        setActiveCueText(active.map((c) => c.text).join('\n'));
      } else {
        setActiveCueText('');
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [subtitlesEnabled, parsedCues, subtitleOffsetSec, selectedStreamIdx]);

  // Fetch streams for a specific video/episode ID and sort by Priority: 1. Thuyết Minh -> 2. Vietsub -> 3. Khác
  const loadStreamsForTarget = useCallback(
    async (
      type: 'movie' | 'series' | 'tv',
      targetVideoId: string,
      itemMeta: CatalogMetaItem,
      epTitle?: string
    ) => {
      setIsLoadingStreams(true);
      setStreams([]);
      setSelectedStreamIdx(0);
      failedStreamIndicesRef.current.clear();
      setRuntimeFallbackEmbedUrl('');
      setOpenSourceCardDropdown(null);
      setOpenPlayerMenu(null);
      setPlayerStatusMsg(
        'Đang tự động tìm luồng ưu tiên: #1 Thuyết Minh → #2 Vietsub → #3 Nguồn Khác...'
      );

      try {
        const res = await fetch(`/stream/${type}/${encodeURIComponent(targetVideoId)}.json`);
        const data = await res.json();
        const rawStreams: StreamSourceItem[] = Array.isArray(data?.streams) ? data.streams : [];
        const prioritized = buildPrioritizedStreams(rawStreams, type === 'tv');

        setStreams(prioritized);
        if (prioritized.length > 0) {
          const firstInfo = getStreamPriorityInfo(prioritized[0]);
          setPlayerStatusMsg('');
          if (type !== 'tv') {
            triggerOsd(`▶ Tự động phát ${firstInfo.tierLabel}`);
          }
          saveHistoryEntry(itemMeta, targetVideoId, epTitle);
          loadSubtitlesForTarget(type, targetVideoId, prioritized);
        } else {
          setPlayerStatusMsg('Chưa tìm thấy luồng phát trực tiếp cho mục này.');
        }
      } catch {
        setPlayerStatusMsg('Lỗi kết nối khi tải luồng phát.');
      } finally {
        setIsLoadingStreams(false);
      }
    },
    [saveHistoryEntry, loadSubtitlesForTarget, triggerOsd]
  );

  // Open a movie, series, or live TV channel in the Watch / Detail view
  const handleSelectMedia = useCallback(
    async (item: CatalogMetaItem, preferredEpisodeId?: string) => {
      setSelectedItem(item);
      setDetailMeta(item);
      setIsLoadingDetail(true);
      setOpenSourceCardDropdown(null);
      setOpenPlayerMenu(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      try {
        const res = await fetch(`/meta/${item.type}/${encodeURIComponent(item.id)}.json`);
        const data = await res.json();
        const resolvedMeta: CatalogMetaItem =
          data?.meta && data.meta.id ? { ...item, ...data.meta } : item;
        setDetailMeta(resolvedMeta);

        const videos = Array.isArray(resolvedMeta.videos) ? resolvedMeta.videos : [];
        const firstVideo =
          (preferredEpisodeId && videos.find((v) => v.id === preferredEpisodeId)) ||
          videos[0];
        const targetId = firstVideo ? firstVideo.id : resolvedMeta.id;
        setSelectedEpisodeId(targetId);
        await loadStreamsForTarget(
          resolvedMeta.type || item.type,
          targetId,
          resolvedMeta,
          firstVideo?.title
        );
      } catch {
        setSelectedEpisodeId(item.id);
        await loadStreamsForTarget(item.type, item.id, item);
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [loadStreamsForTarget]
  );

  // Reset runtime fallback embed whenever the user or failover changes stream index
  useEffect(() => {
    setRuntimeFallbackEmbedUrl('');
    setPlayerStatusMsg('');
    setQualityLevels([{ id: -1, label: 'Tự động (Auto)' }]);
    setSelectedQualityId(-1);
  }, [selectedStreamIdx]);

  const activeStream = streams[selectedStreamIdx] || null;
  const activePriorityInfo = useMemo(
    () => (activeStream ? getStreamPriorityInfo(activeStream) : null),
    [activeStream]
  );

  const activeEmbedUrl = useMemo(() => {
    if (runtimeFallbackEmbedUrl) return cleanStreamUrl(runtimeFallbackEmbedUrl);
    if (!activeStream) return '';
    if (!activeStream.url && (activeStream.embedUrl || activeStream.externalUrl)) {
      return cleanStreamUrl(activeStream.embedUrl || activeStream.externalUrl || '');
    }
    return '';
  }, [activeStream, runtimeFallbackEmbedUrl]);

  // Split streams into two distinct groups for the 2 Source Cards:
  // 1. Direct HLS (`directHlsStreams`)
  // 2. Web / Nuvio (`webNuvioStreams`)
  const { directHlsStreams, webNuvioStreams } = useMemo(() => {
    const direct: Array<{ stream: StreamSourceItem; originalIdx: number }> = [];
    const web: Array<{ stream: StreamSourceItem; originalIdx: number }> = [];

    streams.forEach((st, idx) => {
      const isEmbed = Boolean(!st.url && (st.embedUrl || st.externalUrl));
      if (isEmbed) {
        web.push({ stream: st, originalIdx: idx });
      } else {
        direct.push({ stream: st, originalIdx: idx });
      }
    });

    return { directHlsStreams: direct, webNuvioStreams: web };
  }, [streams]);

  // Attach Shaka / Hls.js / HTML5 player whenever active stream changes + 3-SECOND UNRESPONSIVE WATCHDOG
  useEffect(() => {
    let isCancelled = false;
    let hasResponded = false;
    let watchdogTimeoutId: number | null = null;
    let countdownIntervalId: number | null = null;

    const clearWatchdog = () => {
      hasResponded = true;
      if (watchdogTimeoutId !== null) {
        window.clearTimeout(watchdogTimeoutId);
        watchdogTimeoutId = null;
      }
      if (countdownIntervalId !== null) {
        window.clearInterval(countdownIntervalId);
        countdownIntervalId = null;
      }
      setStreamWatchdogCountdown(null);
    };

    const cleanupPlayer = async () => {
      clearWatchdog();
      if (hlsPlayerRef.current) {
        try {
          hlsPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        hlsPlayerRef.current = null;
      }
      if (shakaPlayerRef.current) {
        try {
          await shakaPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        shakaPlayerRef.current = null;
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        } catch {
          // ignore
        }
      }
    };

    const advanceToNextStream = (reason: string) => {
      if (isCancelled || !activeStream) return;
      clearWatchdog();
      failedStreamIndicesRef.current.add(selectedStreamIdx);

      // Find next non-failed stream in priority order (1. Thuyết Minh -> 2. Vietsub -> 3. Khác)
      let nextIdx = -1;
      for (let i = selectedStreamIdx + 1; i < streams.length; i++) {
        if (!failedStreamIndicesRef.current.has(i)) {
          nextIdx = i;
          break;
        }
      }

      if (nextIdx !== -1) {
        const nextSt = streams[nextIdx];
        const nextInfo = getStreamPriorityInfo(nextSt);
        const msg = `⚡ ${reason} → Đang tự chuyển sang ${nextInfo.tierLabel} (#${nextIdx + 1})...`;
        setPlayerStatusMsg(msg);
        triggerOsd(`⚡ Tự động đổi nguồn (#${nextIdx + 1} • ${nextInfo.shortBadge})`);
        setSelectedStreamIdx(nextIdx);
        return;
      }

      // If all Direct streams failed and current stream has a fallbackEmbedUrl, use it
      const fbEmbed =
        activeStream.fallbackEmbedUrl || activeStream.embedUrl || activeStream.externalUrl;
      if (fbEmbed && !runtimeFallbackEmbedUrl) {
        setPlayerStatusMsg('');
        setRuntimeFallbackEmbedUrl(fbEmbed);
        return;
      }

      setPlayerStatusMsg(
        'Luồng phát hiện tại không phản hồi. Vui lòng chọn nguồn khác ở thẻ Direct HLS hoặc Web/Nuvio bên dưới.'
      );
    };

    const startPlayback = async () => {
      await cleanupPlayer();
      if (isCancelled || !activeStream || activeEmbedUrl || !videoRef.current) return;

      const rawUrl = activeStream.url || '';
      const cleanUrl = cleanStreamUrl(rawUrl);
      if (!cleanUrl) {
        advanceToNextStream('Nguồn trống');
        return;
      }

      const videoEl = videoRef.current;

      // Mark stream as responded as soon as first media metadata/frame arrives
      const onStreamResponded = () => {
        if (isCancelled) return;
        clearWatchdog();
        setPlayerStatusMsg('');
      };

      videoEl.addEventListener('loadedmetadata', onStreamResponded, { once: true });
      videoEl.addEventListener('loadeddata', onStreamResponded, { once: true });
      videoEl.addEventListener('canplay', onStreamResponded, { once: true });
      videoEl.addEventListener('playing', onStreamResponded, { once: true });

      // Start strict 3-second (3000ms) unresponsive stream watchdog
      hasResponded = false;
      setStreamWatchdogCountdown(3);
      let remainingSec = 3;
      countdownIntervalId = window.setInterval(() => {
        remainingSec -= 1;
        if (!hasResponded && !isCancelled && remainingSec > 0) {
          setStreamWatchdogCountdown(remainingSec);
        }
      }, 1000);

      watchdogTimeoutId = window.setTimeout(() => {
        if (!hasResponded && !isCancelled) {
          advanceToNextStream('Quá 3 giây không phản hồi');
        }
      }, 3000);

      const ck = extractClearKeyFromStream({
        streamUrl: rawUrl,
        streamName: `${activeStream.name || ''} ${activeStream.title || ''}`,
        kidHex: activeStream.kidHex,
        keyHex: activeStream.keyHex,
        drmLicenseUri: activeStream.behaviorHints?.drmLicenseUri,
      });

      const lowerUrl = cleanUrl.toLowerCase();
      const isDash =
        lowerUrl.includes('.mpd') ||
        lowerUrl.includes('/proxy/dash/') ||
        Boolean(ck) ||
        Boolean(activeStream.isClearkeyFlag);

      const shakaSupported = Boolean(
        window.shaka &&
          (typeof window.shaka.Player.isBrowserSupported === 'function'
            ? window.shaka.Player.isBrowserSupported()
            : true)
      );

      // 1. MPEG-DASH (.mpd) & ClearKey Live TV via Shaka Player
      if (isDash && shakaSupported && window.shaka) {
        try {
          window.shaka.polyfill?.installAll?.();
          const player = new window.shaka.Player(videoEl);
          shakaPlayerRef.current = player;

          const drmConfig: Record<string, unknown> = {};
          if (ck && ck.kid && ck.key) {
            const cleanKid = ck.kid.replace(/-/g, '').toLowerCase();
            const cleanKey = ck.key.replace(/-/g, '').toLowerCase();
            const clearKeysMap: Record<string, string> = {
              [cleanKid]: cleanKey,
            };
            if (cleanKid.length === 32) {
              const dashed = `${cleanKid.slice(0, 8)}-${cleanKid.slice(8, 12)}-${cleanKid.slice(
                12,
                16
              )}-${cleanKid.slice(16, 20)}-${cleanKid.slice(20)}`;
              clearKeysMap[dashed] = cleanKey;
            }
            drmConfig.clearKeys = clearKeysMap;
            drmConfig.preferredKeySystems = ['org.w3.clearkey'];
          }

          player.getNetworkingEngine().registerResponseFilter((type, response) => {
            if (
              window.shaka &&
              type === window.shaka.net.NetworkingEngine.RequestType.MANIFEST
            ) {
              onStreamResponded();
              try {
                let mpdStr = new TextDecoder('utf-8').decode(response.data);
                mpdStr = mpdStr.replace(
                  /<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*>[\s\S]*?<\/ContentProtection>/gi,
                  ''
                );
                mpdStr = mpdStr.replace(
                  /<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*\/>/gi,
                  ''
                );
                mpdStr = mpdStr.replace(
                  /<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*>[\s\S]*?<\/ContentProtection>/gi,
                  ''
                );
                mpdStr = mpdStr.replace(
                  /<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*\/>/gi,
                  ''
                );
                response.data = new TextEncoder().encode(mpdStr);
              } catch {
                // ignore
              }
            }
          });

          player.configure({
            drm: drmConfig,
            streaming: {
              bufferingGoal: 10,
              rebufferingGoal: 2,
              bufferBehind: 15,
              ignoreTextStreamFailures: true,
              retryParameters: {
                maxAttempts: 2,
                baseDelay: 400,
                backoffFactor: 1.3,
              },
            },
            manifest: {
              retryParameters: {
                maxAttempts: 2,
              },
            },
          });

          const directMpdUrl = getDirectFromDashProxyUrl(cleanUrl) || cleanUrl;
          const proxyMpdFallback = getDashProxyFallbackUrl(directMpdUrl);

          try {
            await player.load(directMpdUrl);
          } catch (firstErr) {
            if (!isCancelled && proxyMpdFallback && proxyMpdFallback !== directMpdUrl) {
              await player.load(proxyMpdFallback);
            } else {
              throw firstErr;
            }
          }

          if (!isCancelled && videoRef.current) {
            onStreamResponded();
            // Extract Shaka variant tracks for Video Quality selector
            try {
              if (typeof player.getVariantTracks === 'function') {
                const tracks = player.getVariantTracks() || [];
                const seenHeights = new Set<number>();
                const levels: QualityLevelOption[] = [{ id: -1, label: 'Tự động (Auto)' }];
                tracks
                  .filter((t: { height?: number }) => Boolean(t.height))
                  .sort((a: { height: number }, b: { height: number }) => b.height - a.height)
                  .forEach((t: { id: number; height: number }) => {
                    if (!seenHeights.has(t.height)) {
                      seenHeights.add(t.height);
                      levels.push({
                        id: t.id,
                        height: t.height,
                        label:
                          t.height >= 2160
                            ? '4K (2160p)'
                            : t.height >= 1080
                            ? 'Full HD (1080p)'
                            : t.height >= 720
                            ? 'HD (720p)'
                            : `${t.height}p`,
                      });
                    }
                  });
                if (levels.length > 1) {
                  setQualityLevels(levels);
                }
              }
            } catch {
              // ignore
            }

            try {
              await videoRef.current.play();
            } catch {
              if (videoRef.current) {
                videoRef.current.muted = true;
                await videoRef.current.play().catch(() => {});
              }
            }
          }
          return;
        } catch {
          if (!isCancelled) {
            advanceToNextStream('Lỗi tải luồng DASH');
          }
          return;
        }
      }

      // 2. HLS (.m3u8) via Hls.js with fast 2.8s manifest timeout to respect the 3-second rule
      const isDirectMp4OrMkv =
        /\.(mp4|mkv|webm)(\?|$)/i.test(lowerUrl) && !lowerUrl.includes('/proxy/hls');

      if (!isDirectMp4OrMkv && window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 60,
          manifestLoadingTimeOut: 2800,
          manifestLoadingMaxRetry: 0,
          levelLoadingTimeOut: 2800,
          levelLoadingMaxRetry: 1,
          fragLoadingTimeOut: 3500,
        });
        hlsPlayerRef.current = hls;
        hls.loadSource(cleanUrl);
        hls.attachMedia(videoEl);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hls.on(window.Hls.Events.MANIFEST_PARSED, (_event: any, data: any) => {
          if (isCancelled || !videoRef.current) return;
          onStreamResponded();

          // Populate Video Quality selector from Hls.js levels
          const rawLevels = Array.isArray(data?.levels) ? data.levels : hls.levels || [];
          const seenHeights = new Set<number>();
          const levels: QualityLevelOption[] = [{ id: -1, label: 'Tự động (Auto)' }];
          rawLevels.forEach((lv: { height?: number }, idx: number) => {
            const h = lv.height || 0;
            if (h > 0 && !seenHeights.has(h)) {
              seenHeights.add(h);
              levels.push({
                id: idx,
                height: h,
                label:
                  h >= 2160
                    ? '4K (2160p)'
                    : h >= 1080
                    ? 'Full HD (1080p)'
                    : h >= 720
                    ? 'HD (720p)'
                    : `${h}p`,
              });
            }
          });
          levels.sort((a, b) => (a.id === -1 ? -1 : b.id === -1 ? 1 : (b.height || 0) - (a.height || 0)));
          setQualityLevels(levels);

          videoRef.current.play().catch(() => {
            if (videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().catch(() => {});
            }
          });
        });

        hls.on(window.Hls.Events.LEVEL_LOADED, () => {
          onStreamResponded();
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hls.on(window.Hls.Events.ERROR, (_event: any, data: any) => {
          if (!data?.fatal || isCancelled) return;
          if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            try {
              hls.recoverMediaError();
              return;
            } catch {
              // fall through
            }
          }
          advanceToNextStream('Luồng HLS không phản hồi');
        });
        return;
      }

      // 3. Native HTML5 video (Safari HLS or direct MP4/MKV)
      if (!isCancelled && videoRef.current) {
        const onVideoError = () => {
          videoEl.removeEventListener('error', onVideoError);
          advanceToNextStream('Lỗi kết nối luồng video');
        };
        videoEl.addEventListener('error', onVideoError, { once: true });
        videoEl.src = cleanUrl;
        videoEl.play().catch(() => {});
      }
    };

    startPlayback();

    return () => {
      isCancelled = true;
      cleanupPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStream, activeEmbedUrl, selectedStreamIdx, streams.length]);

  // Handle Video Quality selection
  const handleSelectQuality = useCallback(
    (levelId: number, label: string) => {
      setSelectedQualityId(levelId);
      setOpenPlayerMenu(null);

      if (hlsPlayerRef.current) {
        hlsPlayerRef.current.currentLevel = levelId;
        triggerOsd(`🎬 Chất lượng: ${label}`);
        return;
      }

      if (shakaPlayerRef.current) {
        try {
          if (levelId === -1) {
            shakaPlayerRef.current.configure({ abr: { enabled: true } });
          } else {
            shakaPlayerRef.current.configure({ abr: { enabled: false } });
            const tracks = shakaPlayerRef.current.getVariantTracks?.() || [];
            const targetTrack = tracks.find((t: { id: number }) => t.id === levelId);
            if (targetTrack) {
              shakaPlayerRef.current.selectVariantTrack(targetTrack, true);
            }
          }
          triggerOsd(`🎬 Chất lượng: ${label}`);
        } catch {
          // ignore
        }
      }
    },
    [triggerOsd]
  );

  // Handle Subtitle Font Size change
  const handleSelectSubtitleFontSize = useCallback(
    (key: SubtitleFontSizeKey, label: string) => {
      setSubtitleFontSize(key);
      try {
        localStorage.setItem(SUB_FONT_STORAGE_KEY, key);
      } catch {
        // ignore
      }
      triggerOsd(`🔤 Cỡ chữ phụ đề: ${label}`);
    },
    [triggerOsd]
  );

  // Handle Search Submission
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setSelectedItem(null);
    setOpenDropdown(null);
    setActiveCatalog({
      id: 'search_all',
      title: `Kết Quả Tìm Kiếm: "${q}"`,
      navKey: 'search',
      catalogType: 'movie',
    });
    setIsSearching(true);
    setIsLoading(true);

    try {
      const [resMov, resSer] = await Promise.all([
        fetch(`/catalog/movie/search_movie/search=${encodeURIComponent(q)}.json`)
          .then((r) => r.json())
          .catch(() => ({ metas: [] })),
        fetch(`/catalog/series/search_series/search=${encodeURIComponent(q)}.json`)
          .then((r) => r.json())
          .catch(() => ({ metas: [] })),
      ]);

      const merged: CatalogMetaItem[] = [];
      const seen = new Set<string>();
      for (const item of [...(resMov.metas || []), ...(resSer.metas || [])]) {
        if (item?.id && !seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }
      setItems(merged);
      setTotalPages(1);
    } finally {
      setIsSearching(false);
      setIsLoading(false);
    }
  };

  const activeHero = spotlightPool[heroIndex] || spotlightPool[0] || items[0] || null;
  const heroMeta = useMemo(() => (activeHero ? extractCardMeta(activeHero) : null), [activeHero]);

  const episodes = detailMeta?.videos || [];
  const currentEpisodeIdx = episodes.findIndex((ep) => ep.id === selectedEpisodeId);

  const displayedItems = useMemo(() => {
    if (activeCatalog.navKey === 'watchlist') return watchlist;
    if (
      activeCatalog.navKey === 'truyen-hinh' ||
      activeCatalog.navKey === 'search' ||
      items.length < 6
    ) {
      return items;
    }
    const cleanCount = Math.floor(items.length / 6) * 6;
    return items.slice(0, cleanCount);
  }, [activeCatalog.navKey, items, watchlist]);

  const pageNumbers = useMemo(() => {
    const pages: Array<number | 'ellipsis'> = [];
    const maxPage = Math.max(1, totalPages);
    if (maxPage <= 6) {
      for (let i = 1; i <= maxPage; i++) pages.push(i);
      return pages;
    }
    if (page <= 3) {
      pages.push(1, 2, 3, 4, 'ellipsis', maxPage);
    } else if (page >= maxPage - 2) {
      pages.push(1, 'ellipsis', maxPage - 3, maxPage - 2, maxPage - 1, maxPage);
    } else {
      pages.push(1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', maxPage);
    }
    return pages;
  }, [page, totalPages]);

  const handlePageSelect = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || newPage === page) return;
    setInfiniteScrollEnabled(false);
    setPage(newPage);
    window.scrollTo({ top: 320, behavior: 'smooth' });
  };

  const currentSubtitleFontObj =
    SUBTITLE_FONT_SIZES.find((s) => s.key === subtitleFontSize) || SUBTITLE_FONT_SIZES[1];

  const activeQualityLabel = useMemo(() => {
    const found = qualityLevels.find((q) => q.id === selectedQualityId);
    if (found && found.id !== -1) return found.label;
    return activeStream?.qualityLabel ? `Auto (${activeStream.qualityLabel})` : 'Auto (FHD)';
  }, [qualityLevels, selectedQualityId, activeStream]);

  const activeDirectHlsStream = useMemo(
    () => directHlsStreams.find((x) => x.originalIdx === selectedStreamIdx) || null,
    [directHlsStreams, selectedStreamIdx]
  );

  const activeWebNuvioStream = useMemo(
    () => webNuvioStreams.find((x) => x.originalIdx === selectedStreamIdx) || null,
    [webNuvioStreams, selectedStreamIdx]
  );

  return (
    <div className="min-h-screen w-full bg-[#080b12]/40 text-zinc-100 font-sans selection:bg-amber-500 selection:text-black overflow-x-hidden flex flex-col justify-between">
      {/* =====================================================================
          HEADER & COMPACT CATEGORY BAR
         ===================================================================== */}
      <header
        ref={navBarRef}
        className="sticky top-0 w-full z-50 bg-[#080b12]/90 backdrop-blur-xl border-b border-white/[0.08] shadow-lg"
      >
        <div className="max-w-[1380px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() =>
              selectCategory({
                id: 'cat_phim_moi_cap_nhat',
                title: 'Phim Mới Cập Nhật Hôm Nay',
                navKey: 'moi-cap-nhat',
                catalogType: 'movie',
              })
            }
            className="flex items-center gap-2.5 shrink-0 cursor-pointer group text-left"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/20 border border-amber-300/40 group-hover:scale-105 transition-transform">
              <svg className="w-5 h-5 text-black fill-current" viewBox="0 0 24 24">
                <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z" />
              </svg>
            </div>
            <div className="flex items-baseline tracking-tight">
              <span className="text-lg md:text-xl font-black text-white uppercase">PHIM</span>
              <span className="text-lg md:text-xl font-black text-amber-400 uppercase">.TNUI</span>
            </div>
          </button>

          <form
            onSubmit={handleSearchSubmit}
            className="flex-1 max-w-xl mx-auto relative flex items-center"
          >
            <svg
              className="w-4 h-4 text-zinc-400 absolute left-4 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên phim, diễn viên... (/)"
              className="w-full pl-10 pr-10 py-2 text-xs md:text-sm rounded-full bg-[#131824] border border-white/10 text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-amber-500/70 focus:bg-[#171d2b] transition-all shadow-inner"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </form>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                selectCategory({
                  id: 'watchlist',
                  title: `Tủ Phim Cá Nhân (${watchlist.length})`,
                  navKey: 'watchlist',
                  catalogType: 'movie',
                })
              }
              className={`px-3.5 py-2 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeCatalog.navKey === 'watchlist'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-[#131824] hover:bg-[#1a2030] border-white/10 text-zinc-200'
              }`}
            >
              <svg
                className="w-3.5 h-3.5 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                />
              </svg>
              <span className="hidden sm:inline">Tủ Phim</span>
              {watchlist.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-black text-[10px] font-extrabold">
                  {watchlist.length}
                </span>
              )}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown((prev) => (prev === 'settings' ? null : 'settings'))
                }
                className={`px-4 py-2 rounded-full border text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  openDropdown === 'settings'
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                    : 'bg-[#131824] hover:bg-[#1a2030] border-white/10 text-zinc-100'
                }`}
              >
                <span>⚙️ Cài Đặt</span>
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${
                    openDropdown === 'settings' ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {openDropdown === 'settings' && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-[#111623] border border-white/15 shadow-2xl p-2.5 z-50 space-y-1.5">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400 border-b border-white/10">
                    Cài Đặt PHIM.TNUI &amp; Nuvio Addon
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDropdown(null);
                      onOpenQrModal();
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <span>📱 Cài App TV / Nuvio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDropdown(null);
                      onOpenAddonSettings();
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <span>⚙️ Cấu Hình Addon PRO</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDropdown(null);
                      onCopyManifestUrl();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-zinc-200 hover:bg-white/10 flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <span>📋 Chép Link Manifest</span>
                  </button>
                  <div className="pt-1 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenDropdown(null);
                        onRollbackToClassic();
                      }}
                      className="w-full text-center px-3 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black transition-colors cursor-pointer"
                    >
                      Quay Về Bản Addon Gốc
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-white/[0.06] bg-[#0a0e17]/90">
          <div className="max-w-[1380px] mx-auto px-4 md:px-8 py-2.5 flex items-center justify-center flex-wrap gap-2 md:gap-3">
            <button
              type="button"
              onClick={() =>
                selectCategory({
                  id: 'cat_phim_moi_cap_nhat',
                  title: 'Phim Mới Cập Nhật Hôm Nay',
                  navKey: 'moi-cap-nhat',
                  catalogType: 'movie',
                })
              }
              className={`px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeCatalog.navKey === 'moi-cap-nhat' && !selectedItem
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-sm shadow-amber-500/10'
                  : 'bg-[#131824] hover:bg-[#192030] text-zinc-200 border border-white/10'
              }`}
            >
              <svg
                className="w-3.5 h-3.5 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>Mới Cập Nhật</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown((prev) => (prev === 'the-loai' ? null : 'the-loai'))
                }
                className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  activeCatalog.navKey === 'the-loai' || openDropdown === 'the-loai'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 font-bold'
                    : 'bg-[#131824] hover:bg-[#192030] text-zinc-200 border border-white/10'
                }`}
              >
                <span>
                  {activeCatalog.navKey === 'the-loai'
                    ? activeCatalog.title.replace('Thể Loại: ', '')
                    : 'Thể loại'}
                </span>
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${
                    openDropdown === 'the-loai' ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {openDropdown === 'the-loai' && (
                <div className="absolute left-0 mt-2 w-80 sm:w-96 rounded-2xl bg-[#111623] border border-white/15 shadow-2xl p-3 z-50 grid grid-cols-3 gap-1.5">
                  {GENRE_OPTIONS.map((g) => {
                    const isSelected = activeCatalog.id === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          selectCategory({
                            id: g.id,
                            title: `Thể Loại: Phim ${g.name}`,
                            navKey: 'the-loai',
                            catalogType: 'movie',
                            subSlug: g.slug,
                          })
                        }
                        className={`px-2.5 py-2 rounded-lg text-xs text-left truncate transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500 text-black font-bold'
                            : 'text-zinc-300 hover:bg-white/10 hover:text-amber-300'
                        }`}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown((prev) => (prev === 'quoc-gia' ? null : 'quoc-gia'))
                }
                className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  activeCatalog.navKey === 'quoc-gia' || openDropdown === 'quoc-gia'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 font-bold'
                    : 'bg-[#131824] hover:bg-[#192030] text-zinc-200 border border-white/10'
                }`}
              >
                <span>
                  {activeCatalog.navKey === 'quoc-gia'
                    ? activeCatalog.title.replace('Quốc Gia: ', '')
                    : 'Quốc gia'}
                </span>
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${
                    openDropdown === 'quoc-gia' ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {openDropdown === 'quoc-gia' && (
                <div className="absolute left-0 mt-2 w-72 sm:w-80 rounded-2xl bg-[#111623] border border-white/15 shadow-2xl p-3 z-50 grid grid-cols-3 gap-1.5">
                  {COUNTRY_OPTIONS.map((c) => {
                    const isSelected = activeCatalog.id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          selectCategory({
                            id: c.id,
                            title: `Quốc Gia: Phim ${c.name}`,
                            navKey: 'quoc-gia',
                            catalogType: 'movie',
                            subSlug: c.slug,
                          })
                        }
                        className={`px-2.5 py-2 rounded-lg text-xs text-left truncate transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500 text-black font-bold'
                            : 'text-zinc-300 hover:bg-white/10 hover:text-amber-300'
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                selectCategory({
                  id: 'cat_phim_le_thuyet_minh',
                  title: 'Phim Thuyết Minh & Lồng Tiếng',
                  navKey: 'thuyet-minh',
                  catalogType: 'movie',
                })
              }
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeCatalog.navKey === 'thuyet-minh' && !selectedItem
                  ? 'text-amber-400 font-bold bg-amber-500/15 border border-amber-500/40'
                  : 'text-zinc-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                />
              </svg>
              <span>Phim Thuyết Minh</span>
            </button>

            <button
              type="button"
              onClick={() =>
                selectCategory({
                  id: 'cat_phim_le',
                  title: 'Danh Sách Phim Lẻ Mới Cập Nhật',
                  navKey: 'phim-le',
                  catalogType: 'movie',
                })
              }
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeCatalog.navKey === 'phim-le' && !selectedItem
                  ? 'text-amber-400 font-bold bg-amber-500/15 border border-amber-500/40'
                  : 'text-zinc-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
                />
              </svg>
              <span>Phim Lẻ</span>
            </button>

            <button
              type="button"
              onClick={() =>
                selectCategory({
                  id: 'cat_phim_bo',
                  title: 'Danh Sách Phim Bộ Đang Phát Sóng',
                  navKey: 'phim-bo',
                  catalogType: 'series',
                })
              }
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeCatalog.navKey === 'phim-bo' && !selectedItem
                  ? 'text-amber-400 font-bold bg-amber-500/15 border border-amber-500/40'
                  : 'text-zinc-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <span>Phim Bộ</span>
            </button>

            <button
              type="button"
              onClick={() =>
                selectCategory({
                  id: 'cat_hoat_hinh_anime',
                  title: 'Phim Hoạt Hình & Anime Chọn Lọc',
                  navKey: 'hoat-hinh',
                  catalogType: 'series',
                })
              }
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeCatalog.navKey === 'hoat-hinh' && !selectedItem
                  ? 'text-amber-400 font-bold bg-amber-500/15 border border-amber-500/40'
                  : 'text-zinc-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
              <span>Hoạt Hình</span>
            </button>

            <button
              type="button"
              onClick={() =>
                selectCategory({
                  id: liveTvFilter,
                  title: 'Truyền Hình Trực Tiếp & Bóng Đá Live',
                  navKey: 'truyen-hinh',
                  catalogType: 'tv',
                })
              }
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeCatalog.navKey === 'truyen-hinh' && !selectedItem
                  ? 'text-amber-400 font-bold bg-amber-500/15 border border-amber-500/40'
                  : 'text-zinc-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span>Truyền Hình &amp; Bóng Đá</span>
            </button>
          </div>
        </div>
      </header>

      {/* =====================================================================
          1. WATCH / DETAIL VIEW (WHEN A MOVIE OR CHANNEL IS CLICKED)
         ===================================================================== */}
      {selectedItem ? (
        <main className="max-w-[1380px] w-full mx-auto px-4 md:px-8 py-6 space-y-5 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-100 transition-colors cursor-pointer"
            >
              ← Quay Lại Trang Danh Sách
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {activePriorityInfo && selectedItem.type !== 'tv' && (
                <span
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border ${
                    activePriorityInfo.tier === 1
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : activePriorityInfo.tier === 2
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                  }`}
                >
                  🎯 Đang phát {activePriorityInfo.tierLabel}
                </span>
              )}
              <button
                type="button"
                onClick={() => toggleWatchlistItem(detailMeta || selectedItem)}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors cursor-pointer"
              >
                {isInWatchlist(selectedItem.id) ? '✓ Đã Lưu Tủ Phim' : '+ Lưu Vào Tủ Phim'}
              </button>
              <button
                type="button"
                onClick={() => setIsTheaterMode((prev) => !prev)}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors cursor-pointer"
              >
                {isTheaterMode ? 'Thu Nhỏ Khung Phát' : 'Chế Độ Rạp Phim'}
              </button>
            </div>
          </div>

          {/* VIDEO PLAYER CONTAINER WITH SUBTITLE OVERLAY, OSD & 3-SECOND WATCHDOG */}
          <div
            ref={playerContainerRef}
            className={`w-full bg-black rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl ${
              isTheaterMode ? 'aspect-[21/9]' : 'aspect-video'
            } relative group select-none`}
          >
            {activeEmbedUrl ? (
              <iframe
                key={activeEmbedUrl}
                src={activeEmbedUrl}
                title={activeStream?.name || 'PHIM.TNUI Cloud Player'}
                className="w-full h-full border-0 bg-black"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                allowFullScreen
              />
            ) : (
              <video
                ref={videoRef}
                controls
                playsInline
                autoPlay
                className="w-full h-full object-contain bg-black"
              />
            )}

            {/* CUSTOM HIGH-CONTRAST SUBTITLE CUE OVERLAY (ADJUSTABLE FONT SIZE) */}
            {!activeEmbedUrl &&
              subtitlesEnabled &&
              activeCueText &&
              selectedItem.type !== 'tv' && (
                <div className="absolute inset-x-4 bottom-14 sm:bottom-16 z-20 flex justify-center pointer-events-none">
                  <div
                    style={{ fontSize: `${currentSubtitleFontObj.pxValue}px` }}
                    className="max-w-4xl px-3.5 py-1.5 rounded-lg bg-black/75 text-white font-semibold text-center leading-snug whitespace-pre-line drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] border border-white/10"
                  >
                    {activeCueText}
                  </div>
                </div>
              )}

            {/* ON-SCREEN DISPLAY (OSD) TOAST FOR SEEK / SUBTITLE / QUALITY */}
            {osdMessage && (
              <div className="absolute top-4 right-4 z-30 px-3.5 py-2 rounded-xl bg-black/85 border border-amber-500/50 text-amber-300 text-xs font-extrabold shadow-xl pointer-events-none">
                {osdMessage}
              </div>
            )}

            {/* 3-SECOND WATCHDOG STATUS BADGE */}
            {!activeEmbedUrl &&
              !isLoadingStreams &&
              streamWatchdogCountdown !== null && (
                <div className="absolute top-4 left-4 z-30 px-3 py-1.5 rounded-xl bg-black/80 border border-amber-500/40 text-[11px] font-bold text-amber-300 flex items-center gap-2 pointer-events-none">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span>
                    Kiểm tra phản hồi luồng ({streamWatchdogCountdown}s • Tự đổi nguồn nếu chậm)...
                  </span>
                </div>
              )}

            {(isLoadingStreams || playerStatusMsg) && (
              <div className="absolute inset-0 z-25 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
                <p className="text-sm font-semibold text-amber-300 mb-2">
                  {isLoadingStreams
                    ? 'Đang tự động tìm & xếp hạng luồng phát ưu tiên (#1 Thuyết Minh → #2 Vietsub → #3 Nguồn Khác)...'
                    : playerStatusMsg}
                </p>
              </div>
            )}
          </div>

          {/* =====================================================================
              DEDICATED PLAYER CONTROL BAR:
              1. Tua lùi / Tua tiến (-30s, -10s, +10s, +30s)
              2. Bật / Tắt phụ đề & Chọn phụ đề + Cân chỉnh thời gian
              3. Kích thước chữ phụ đề (Nhỏ, Vừa, Lớn, Rất Lớn)
              4. Chất lượng video (Auto, 4K, 1080p FHD, 720p HD...)
             ===================================================================== */}
          <div
            ref={playerControlsBarRef}
            className="bg-[#111520]/95 border border-white/10 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 relative z-40"
          >
            {/* Left Group: Seek Backward / Forward Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-zinc-400 mr-1 hidden sm:inline">
                Tua nhanh:
              </span>
              <button
                type="button"
                onClick={() => handleSeekRelative(-30)}
                className="px-2.5 py-1.5 rounded-lg bg-[#181f2e] hover:bg-amber-500 hover:text-black text-zinc-200 border border-white/10 text-xs font-bold transition-colors cursor-pointer"
                title="Tua lùi 30 giây"
              >
                ⏪ -30s
              </button>
              <button
                type="button"
                onClick={() => handleSeekRelative(-10)}
                className="px-3 py-1.5 rounded-lg bg-[#181f2e] hover:bg-amber-500 hover:text-black text-zinc-100 border border-white/10 text-xs font-bold transition-colors cursor-pointer"
                title="Tua lùi 10 giây (Phím mũi tên trái)"
              >
                ⏪ -10s
              </button>
              <button
                type="button"
                onClick={() => handleSeekRelative(10)}
                className="px-3 py-1.5 rounded-lg bg-[#181f2e] hover:bg-amber-500 hover:text-black text-zinc-100 border border-white/10 text-xs font-bold transition-colors cursor-pointer"
                title="Tua tiến 10 giây (Phím mũi tên phải)"
              >
                +10s ⏩
              </button>
              <button
                type="button"
                onClick={() => handleSeekRelative(30)}
                className="px-2.5 py-1.5 rounded-lg bg-[#181f2e] hover:bg-amber-500 hover:text-black text-zinc-200 border border-white/10 text-xs font-bold transition-colors cursor-pointer"
                title="Tua tiến 30 giây"
              >
                +30s ⏩
              </button>
            </div>

            {/* Center Group: Subtitle ON/OFF + Subtitle Track Picker + Font Size Selector */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Toggle Subtitle ON / OFF */}
              <button
                type="button"
                onClick={() => {
                  setSubtitlesEnabled((prev) => {
                    const next = !prev;
                    triggerOsd(next ? '🇻🇳 Đã BẬT Phụ Đề' : '🚫 Đã TẮT Phụ Đề');
                    return next;
                  });
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  subtitlesEnabled
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-[#181f2e] border-white/10 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>CC Phụ Đề: {subtitlesEnabled ? 'BẬT' : 'TẮT'}</span>
              </button>

              {/* Subtitle Track & Sync Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPlayerMenu((prev) => (prev === 'subtitles' ? null : 'subtitles'))
                  }
                  className="px-3 py-1.5 rounded-lg bg-[#181f2e] hover:bg-[#20293d] border border-white/10 text-xs font-bold text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>
                    🇻🇳 Chọn Phụ Đề ({subtitleTracks.length || 1})
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${
                      openPlayerMenu === 'subtitles' ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {openPlayerMenu === 'subtitles' && (
                  <div className="absolute right-0 sm:left-0 mt-2 w-80 rounded-2xl bg-[#111623] border border-white/15 shadow-2xl p-3 z-50 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <span className="text-xs font-extrabold text-amber-400">
                        Danh Sách Phụ Đề Tiếng Việt
                      </span>
                      <button
                        type="button"
                        onClick={() => setSubtitlesEnabled((prev) => !prev)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                          subtitlesEnabled
                            ? 'bg-emerald-500 text-black'
                            : 'bg-zinc-700 text-zinc-300'
                        }`}
                      >
                        {subtitlesEnabled ? 'Đang BẬT' : 'Đang TẮT'}
                      </button>
                    </div>

                    <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                      {subtitleTracks.length === 0 ? (
                        <div className="text-xs text-zinc-400 py-2">
                          Phim đang sử dụng phụ đề/thuyết minh nhúng trực tiếp trong luồng video.
                        </div>
                      ) : (
                        subtitleTracks.map((tr) => {
                          const isSelected = tr.id === selectedSubtitleId && subtitlesEnabled;
                          return (
                            <button
                              key={tr.id}
                              type="button"
                              onClick={() => {
                                setSubtitlesEnabled(true);
                                setSelectedSubtitleId(tr.id);
                                setOpenPlayerMenu(null);
                                triggerOsd(`🇻🇳 Đã chọn: ${tr.label}`);
                              }}
                              className={`w-full px-2.5 py-2 rounded-lg text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-amber-500 text-black font-bold'
                                  : 'hover:bg-white/10 text-zinc-200'
                              }`}
                            >
                              <span className="truncate">{tr.label}</span>
                              {isSelected && <span className="font-black">✓</span>}
                            </button>
                          );
                        })
                      )}
                    </div>

                    {/* Subtitle Timing Sync Offset */}
                    <div className="pt-2 border-t border-white/10 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-zinc-300">
                        <span>Độ trễ phụ đề:</span>
                        <span className="font-mono font-bold text-amber-400">
                          {subtitleOffsetSec > 0
                            ? `+${subtitleOffsetSec.toFixed(1)}s`
                            : `${subtitleOffsetSec.toFixed(1)}s`}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSubtitleOffsetSec((s) => Number((s - 0.5).toFixed(1)))}
                          className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 cursor-pointer"
                        >
                          -0.5s
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubtitleOffsetSec(0)}
                          className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-amber-300 cursor-pointer"
                        >
                          Mặc định (0s)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubtitleOffsetSec((s) => Number((s + 0.5).toFixed(1)))}
                          className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 cursor-pointer"
                        >
                          +0.5s
                        </button>
                      </div>
                    </div>

                    {isLoadingSubtitleText && (
                      <div className="text-[10px] text-amber-300 animate-pulse">
                        Đang nạp dữ liệu phụ đề...
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Direct Subtitle Font Size Buttons (`Cỡ chữ`) */}
              <div className="inline-flex items-center bg-[#181f2e] border border-white/10 rounded-lg p-0.5 gap-0.5">
                <span className="text-[11px] font-bold text-zinc-400 px-2 hidden md:inline">
                  Cỡ chữ:
                </span>
                {SUBTITLE_FONT_SIZES.map((sz) => (
                  <button
                    key={sz.key}
                    type="button"
                    onClick={() => handleSelectSubtitleFontSize(sz.key, sz.label)}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      subtitleFontSize === sz.key
                        ? 'bg-amber-500 text-black'
                        : 'text-zinc-300 hover:text-white'
                    }`}
                    title={`Kích thước chữ phụ đề: ${sz.label}`}
                  >
                    {sz.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Group: Video Quality Selector + Next Priority Server Button */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPlayerMenu((prev) => (prev === 'quality' ? null : 'quality'))
                  }
                  className="px-3 py-1.5 rounded-lg bg-[#181f2e] hover:bg-[#20293d] border border-white/10 text-xs font-bold text-amber-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>🎬 Chất lượng: {activeQualityLabel}</span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${
                      openPlayerMenu === 'quality' ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {openPlayerMenu === 'quality' && (
                  <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-[#111623] border border-white/15 shadow-2xl p-2.5 z-50 space-y-1">
                    <div className="px-2.5 py-1 text-[11px] font-extrabold text-amber-400 border-b border-white/10">
                      Độ Phân Giải Video
                    </div>
                    {qualityLevels.map((q) => {
                      const isCurrent = selectedQualityId === q.id;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => handleSelectQuality(q.id, q.label)}
                          className={`w-full px-3 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-amber-500 text-black font-bold'
                              : 'hover:bg-white/10 text-zinc-200'
                          }`}
                        >
                          <span>{q.label}</span>
                          {isCurrent && <span className="font-black">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {streams.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = (selectedStreamIdx + 1) % streams.length;
                    setSelectedStreamIdx(nextIdx);
                    triggerOsd(`⚡ Đã chuyển sang Nguồn #${nextIdx + 1}`);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition-colors cursor-pointer"
                  title="Chuyển nhanh sang nguồn phát tiếp theo"
                >
                  Đổi Nhanh Server Kế ⏭
                </button>
              )}
            </div>
          </div>

          {/* =====================================================================
              2 SEPARATE STREAM SOURCE CARDS:
              - THẺ 1: NGUỒN PHÁT DIRECT HLS (Mũi tên cuộn xuống `⌄`)
              - THẺ 2: NGUỒN PHÁT WEB / NUVIO (Mũi tên cuộn xuống `⌄`)
             ===================================================================== */}
          {streams.length > 0 && (
            <div ref={sourceCardsRef} className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-30">
              {/* THẺ 1: DIRECT HLS CARD */}
              <div
                className={`rounded-2xl p-4 border transition-all flex flex-col justify-between gap-3 relative ${
                  activeDirectHlsStream
                    ? 'bg-[#121929]/95 border-emerald-500/60 shadow-lg shadow-emerald-500/5'
                    : 'bg-[#111520]/95 border-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-extrabold uppercase">
                        Thẻ 1 • Direct HLS
                      </span>
                      <span className="text-xs font-bold text-zinc-300">
                        ({directHlsStreams.length} luồng)
                      </span>
                      {activeDirectHlsStream && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-black text-[10px] font-extrabold">
                          ● Đang phát
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Luồng HLS/DASH trực tiếp hỗ trợ chọn phụ đề, chỉnh cỡ chữ, chất lượng &amp; tự chuyển sau 3s
                    </p>
                  </div>
                </div>

                {/* Dropdown Button with Down Arrow (`⌄`) for Direct HLS */}
                <div className="relative">
                  <button
                    type="button"
                    disabled={directHlsStreams.length === 0}
                    onClick={() =>
                      setOpenSourceCardDropdown((prev) =>
                        prev === 'direct-hls' ? null : 'direct-hls'
                      )
                    }
                    className={`w-full px-4 py-2.5 rounded-xl font-extrabold text-xs flex items-center justify-between gap-3 transition-all cursor-pointer ${
                      activeDirectHlsStream
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-md'
                        : 'bg-[#182032] hover:bg-[#1f2940] text-zinc-100 border border-white/15'
                    } disabled:opacity-40`}
                  >
                    <span className="truncate">
                      {activeDirectHlsStream
                        ? `${
                            activeDirectHlsStream.stream.name?.replace(/\n/g, ' ') ||
                            `Direct HLS #${activeDirectHlsStream.originalIdx + 1}`
                          } (${getStreamPriorityInfo(activeDirectHlsStream.stream).shortBadge})`
                        : directHlsStreams.length > 0
                        ? `Chọn Nguồn Direct HLS (${directHlsStreams.length} nguồn khả dụng)`
                        : 'Không có luồng Direct HLS'}
                    </span>
                    <svg
                      className={`w-4 h-4 shrink-0 transition-transform ${
                        openSourceCardDropdown === 'direct-hls' ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.4}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {openSourceCardDropdown === 'direct-hls' && directHlsStreams.length > 0 && (
                    <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-[#111623] border border-white/15 shadow-2xl p-2 z-50 space-y-1 max-h-80 overflow-y-auto">
                      {directHlsStreams.map(({ stream: st, originalIdx }) => {
                        const label =
                          st.name?.replace(/\n/g, ' ') || `Direct HLS #${originalIdx + 1}`;
                        const subLabel = st.title?.split('\n')[0] || '';
                        const isCurrent = selectedStreamIdx === originalIdx && !runtimeFallbackEmbedUrl;
                        const pInfo = getStreamPriorityInfo(st);
                        return (
                          <button
                            key={originalIdx}
                            type="button"
                            onClick={() => {
                              setSelectedStreamIdx(originalIdx);
                              setOpenSourceCardDropdown(null);
                            }}
                            className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                              isCurrent
                                ? 'bg-emerald-500 text-black font-bold'
                                : 'hover:bg-white/10 text-zinc-200'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase shrink-0 ${
                                    isCurrent
                                      ? 'bg-black/20 text-black'
                                      : pInfo.tier === 1
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                      : pInfo.tier === 2
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                      : 'bg-zinc-700 text-zinc-300'
                                  }`}
                                >
                                  #{pInfo.tier} {pInfo.shortBadge}
                                </span>
                                <span className="text-xs truncate">{label}</span>
                              </div>
                              {subLabel && (
                                <div
                                  className={`text-[10px] truncate mt-0.5 ${
                                    isCurrent ? 'text-zinc-900' : 'text-zinc-400'
                                  }`}
                                >
                                  {subLabel}
                                </div>
                              )}
                            </div>
                            {isCurrent && <span className="text-xs font-black shrink-0">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* THẺ 2: WEB / NUVIO CARD */}
              <div
                className={`rounded-2xl p-4 border transition-all flex flex-col justify-between gap-3 relative ${
                  activeWebNuvioStream || Boolean(runtimeFallbackEmbedUrl)
                    ? 'bg-[#121929]/95 border-amber-500/60 shadow-lg shadow-amber-500/5'
                    : 'bg-[#111520]/95 border-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-extrabold uppercase">
                        Thẻ 2 • Web / Nuvio
                      </span>
                      <span className="text-xs font-bold text-zinc-300">
                        ({webNuvioStreams.length} luồng)
                      </span>
                      {(activeWebNuvioStream || Boolean(runtimeFallbackEmbedUrl)) && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-extrabold">
                          ● Đang phát
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Luồng nhúng Trình phát Web / Cloud VIP &amp; Nuvio Webview chống chặn tuyệt đối
                    </p>
                  </div>
                </div>

                {/* Dropdown Button with Down Arrow (`⌄`) for Web / Nuvio */}
                <div className="relative">
                  <button
                    type="button"
                    disabled={webNuvioStreams.length === 0}
                    onClick={() =>
                      setOpenSourceCardDropdown((prev) =>
                        prev === 'web-nuvio' ? null : 'web-nuvio'
                      )
                    }
                    className={`w-full px-4 py-2.5 rounded-xl font-extrabold text-xs flex items-center justify-between gap-3 transition-all cursor-pointer ${
                      activeWebNuvioStream || Boolean(runtimeFallbackEmbedUrl)
                        ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-md'
                        : 'bg-[#182032] hover:bg-[#1f2940] text-zinc-100 border border-white/15'
                    } disabled:opacity-40`}
                  >
                    <span className="truncate">
                      {activeWebNuvioStream
                        ? `${
                            activeWebNuvioStream.stream.name?.replace(/\n/g, ' ') ||
                            `Web / Nuvio #${activeWebNuvioStream.originalIdx + 1}`
                          } (${getStreamPriorityInfo(activeWebNuvioStream.stream).shortBadge})`
                        : webNuvioStreams.length > 0
                        ? `Chọn Nguồn Web / Nuvio (${webNuvioStreams.length} nguồn khả dụng)`
                        : 'Không có luồng Web / Nuvio'}
                    </span>
                    <svg
                      className={`w-4 h-4 shrink-0 transition-transform ${
                        openSourceCardDropdown === 'web-nuvio' ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.4}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {openSourceCardDropdown === 'web-nuvio' && webNuvioStreams.length > 0 && (
                    <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-[#111623] border border-white/15 shadow-2xl p-2 z-50 space-y-1 max-h-80 overflow-y-auto">
                      {webNuvioStreams.map(({ stream: st, originalIdx }) => {
                        const label =
                          st.name?.replace(/\n/g, ' ') || `Web / Nuvio #${originalIdx + 1}`;
                        const subLabel = st.title?.split('\n')[0] || '';
                        const isCurrent = selectedStreamIdx === originalIdx;
                        const pInfo = getStreamPriorityInfo(st);
                        return (
                          <button
                            key={originalIdx}
                            type="button"
                            onClick={() => {
                              setSelectedStreamIdx(originalIdx);
                              setOpenSourceCardDropdown(null);
                            }}
                            className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                              isCurrent
                                ? 'bg-amber-500 text-black font-bold'
                                : 'hover:bg-white/10 text-zinc-200'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase shrink-0 ${
                                    isCurrent
                                      ? 'bg-black/20 text-black'
                                      : pInfo.tier === 1
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                      : pInfo.tier === 2
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                      : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                  }`}
                                >
                                  #{pInfo.tier} {pInfo.shortBadge}
                                </span>
                                <span className="text-xs truncate">{label}</span>
                              </div>
                              {subLabel && (
                                <div
                                  className={`text-[10px] truncate mt-0.5 ${
                                    isCurrent ? 'text-zinc-900' : 'text-zinc-400'
                                  }`}
                                >
                                  {subLabel}
                                </div>
                              )}
                            </div>
                            {isCurrent && <span className="text-xs font-black shrink-0">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* EPISODE SELECTOR FOR SERIES */}
          {episodes.length > 1 && (
            <div className="bg-[#111520]/95 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-zinc-200">
                  Danh Sách Tập Phim ({episodes.length} tập)
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentEpisodeIdx <= 0}
                    onClick={() => {
                      if (currentEpisodeIdx > 0 && detailMeta) {
                        const prevEp = episodes[currentEpisodeIdx - 1];
                        setSelectedEpisodeId(prevEp.id);
                        loadStreamsForTarget(detailMeta.type, prevEp.id, detailMeta, prevEp.title);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 disabled:opacity-40 text-xs font-medium text-zinc-200 cursor-pointer"
                  >
                    ← Tập Trước
                  </button>
                  <button
                    type="button"
                    disabled={currentEpisodeIdx < 0 || currentEpisodeIdx >= episodes.length - 1}
                    onClick={() => {
                      if (
                        currentEpisodeIdx >= 0 &&
                        currentEpisodeIdx < episodes.length - 1 &&
                        detailMeta
                      ) {
                        const nextEp = episodes[currentEpisodeIdx + 1];
                        setSelectedEpisodeId(nextEp.id);
                        loadStreamsForTarget(detailMeta.type, nextEp.id, detailMeta, nextEp.title);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 disabled:opacity-40 text-xs font-medium text-zinc-200 cursor-pointer"
                  >
                    Tập Tiếp →
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2 max-h-60 overflow-y-auto pr-1">
                {episodes.map((ep) => (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => {
                      if (!detailMeta) return;
                      setSelectedEpisodeId(ep.id);
                      loadStreamsForTarget(detailMeta.type, ep.id, detailMeta, ep.title);
                    }}
                    className={`py-2 px-2.5 rounded-lg text-xs font-medium truncate transition-colors cursor-pointer ${
                      selectedEpisodeId === ep.id
                        ? 'bg-amber-500 text-black font-bold'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    {ep.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* MOVIE / CHANNEL METADATA */}
          <div className="bg-[#111520]/95 border border-white/10 rounded-2xl p-5 flex flex-col md:flex-row gap-6">
            <div className="w-40 md:w-48 shrink-0 rounded-xl overflow-hidden aspect-[2/3] bg-zinc-800">
              <SafePosterImage
                src={detailMeta?.poster || selectedItem.poster}
                alt={detailMeta?.name || selectedItem.name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-3 flex-1">
              <h1 className="text-xl md:text-2xl font-bold text-white">
                {detailMeta?.name || selectedItem.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>
                  {detailMeta?.type === 'tv'
                    ? 'Truyền Hình Trực Tiếp'
                    : detailMeta?.type === 'series'
                    ? 'Phim Bộ'
                    : 'Phim Lẻ'}
                </span>
                {detailMeta?.releaseInfo && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Năm {detailMeta.releaseInfo}</span>
                  </>
                )}
                {detailMeta?.genres && detailMeta.genres.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{detailMeta.genres.join(', ')}</span>
                  </>
                )}
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
                {isLoadingDetail
                  ? 'Đang tải thông tin chi tiết...'
                  : detailMeta?.description ||
                    selectedItem.description ||
                    'Nội dung được tổng hợp tự động từ đa nguồn KKPhim, OPhim, NguonC, VSMOV và VipTorrent.'}
              </p>
            </div>
          </div>
        </main>
      ) : (
        /* =====================================================================
            2. MAIN HOME & UNIFIED 6-COLUMN GRID LAYOUT
           ===================================================================== */
        <main className="flex-1 pb-12">
          <div className="max-w-[1380px] mx-auto px-4 md:px-8 pt-5 space-y-6">
            {/* FULL-FRAME CINEMA HERO SPOTLIGHT */}
            {activeCatalog.navKey === 'moi-cap-nhat' && page === 1 && activeHero && heroMeta && (
              <section className="relative w-full min-h-[360px] md:min-h-[430px] lg:min-h-[460px] rounded-2xl overflow-hidden border border-white/15 bg-[#070a12] shadow-2xl flex items-end">
                <div className="absolute inset-0 pointer-events-none overflow-hidden bg-[#070a12]">
                  <SafePosterImage
                    src={activeHero.background || activeHero.poster}
                    alt=""
                    className="w-full h-full object-cover object-center blur-xl opacity-25"
                  />
                  <div className="absolute inset-y-0 right-0 w-full lg:w-[74%] h-full overflow-hidden">
                    <SafePosterImage
                      src={activeHero.background || activeHero.poster}
                      alt={activeHero.name}
                      className="w-full h-full object-cover object-[center_22%] opacity-90 transition-opacity duration-500"
                    />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-r from-[#070a12] via-[#070a12]/85 via-42% to-[#070a12]/15" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#070a12] via-[#070a12]/40 to-transparent" />
                </div>

                <div className="relative z-10 w-full p-5 sm:p-7 md:p-9 flex flex-col lg:flex-row items-center lg:items-end justify-between gap-6">
                  <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 md:gap-6 flex-1 min-w-0 w-full">
                    <div
                      onClick={() => handleSelectMedia(activeHero)}
                      className="w-32 sm:w-36 md:w-44 aspect-[2/3] rounded-xl overflow-hidden border border-white/20 shadow-2xl shrink-0 cursor-pointer group relative bg-zinc-900"
                    >
                      <SafePosterImage
                        src={activeHero.poster}
                        alt={activeHero.name}
                        className="w-full h-full object-cover object-center group-hover:scale-[1.03] transition-transform duration-300"
                      />
                      <div className="absolute top-2 left-2 flex flex-col gap-1">
                        <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-extrabold uppercase shadow">
                          {heroMeta.epBadge}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-black/85 text-amber-300 border border-amber-500/30 text-[9px] font-bold uppercase">
                          {heroMeta.qualityBadge}
                        </span>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 space-y-3 text-center sm:text-left">
                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-extrabold uppercase tracking-wider">
                          🔥 Phim Đề Cử Hôm Nay
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500 text-black font-extrabold text-xs shadow">
                          <span>★</span>
                          <span>{activeHero.tmdbVote || '8.4'}</span>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white/10 text-zinc-200 text-xs font-bold">
                          {heroMeta.year}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold">
                          {activeHero.episodeCurrent || heroMeta.epBadge}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
                          {heroMeta.langLabel}
                        </span>
                      </div>

                      <div>
                        <h1
                          onClick={() => handleSelectMedia(activeHero)}
                          className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-white hover:text-amber-400 transition-colors cursor-pointer leading-tight line-clamp-2 drop-shadow-md"
                        >
                          {activeHero.name}
                        </h1>
                        <p className="text-xs sm:text-sm md:text-base font-bold text-amber-400 mt-1 font-mono truncate">
                          {heroMeta.originName}
                        </p>
                      </div>

                      <p className="text-xs sm:text-sm text-zinc-200/90 line-clamp-2 max-w-2xl mx-auto sm:mx-0 leading-relaxed">
                        {activeHero.description && activeHero.description.length > 30
                          ? activeHero.description
                          : `Siêu phẩm ${heroMeta.originName} (${heroMeta.year}) chất lượng ${heroMeta.qualityBadge} ${heroMeta.langLabel}. Hỗ trợ xem mượt đa luồng trên Web PHIMTNUI và Nuvio TV Addon.`}
                      </p>

                      <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                        <button
                          type="button"
                          onClick={() => handleSelectMedia(activeHero)}
                          className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-amber-500/25 transition-all cursor-pointer"
                        >
                          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          <span>Xem Phim Ngay</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleWatchlistItem(activeHero)}
                          className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-zinc-100 font-bold text-xs sm:text-sm backdrop-blur-xs transition-colors cursor-pointer"
                        >
                          {isInWatchlist(activeHero.id) ? '✓ Đã Lưu Tủ Phim' : '+ Lưu Tủ Phim'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {spotlightPool.length > 1 && (
                    <div className="flex flex-col items-center lg:items-end gap-2.5 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-zinc-300 mr-1 uppercase tracking-wider">
                          Đề cử ({heroIndex + 1}/{Math.min(spotlightPool.length, 6)})
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setHeroIndex(
                              (prev) => (prev - 1 + spotlightPool.length) % spotlightPool.length
                            )
                          }
                          aria-label="Phim trước"
                          className="w-8 h-8 rounded-lg bg-black/60 hover:bg-amber-500 text-white hover:text-black border border-white/15 flex items-center justify-center transition-colors cursor-pointer"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setHeroIndex((prev) => (prev + 1) % spotlightPool.length)
                          }
                          aria-label="Phim tiếp"
                          className="w-8 h-8 rounded-lg bg-black/60 hover:bg-amber-500 text-white hover:text-black border border-white/15 flex items-center justify-center transition-colors cursor-pointer"
                        >
                          ›
                        </button>
                      </div>

                      <div className="flex items-center justify-center gap-2 p-1.5 rounded-xl bg-black/55 border border-white/10 backdrop-blur-md">
                        {spotlightPool.slice(0, 6).map((sp, idx) => {
                          const isCurrent = idx === heroIndex;
                          return (
                            <button
                              key={sp.id}
                              type="button"
                              onClick={() => setHeroIndex(idx)}
                              title={sp.name}
                              className={`relative w-11 h-16 rounded-lg overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                                isCurrent
                                  ? 'border-amber-400 shadow-md shadow-amber-500/30'
                                  : 'border-white/10 opacity-60 hover:opacity-100'
                              }`}
                            >
                              <SafePosterImage
                                src={sp.poster}
                                alt={sp.name}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* CONTINUE WATCHING STRIP */}
            {activeCatalog.navKey === 'moi-cap-nhat' && page === 1 && watchHistory.length > 0 && (
              <section className="bg-[#111520]/85 border border-white/[0.08] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                    <span>▶ Tiếp Tục Xem Gần Đây</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setWatchHistory([]);
                      localStorage.removeItem(HISTORY_STORAGE_KEY);
                    }}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    Xóa lịch sử
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                  {watchHistory.slice(0, 6).map((h, idx) => (
                    <div
                      key={`hist_${h.id}_${idx}`}
                      onClick={() =>
                        handleSelectMedia(
                          { id: h.id, type: h.type, name: h.name, poster: h.poster },
                          h.episodeId
                        )
                      }
                      className="group flex items-center gap-2.5 p-2 rounded-xl bg-black/40 hover:bg-amber-500/10 border border-white/5 hover:border-amber-500/40 transition-all cursor-pointer"
                    >
                      <div className="w-10 h-14 rounded-lg overflow-hidden bg-zinc-900 shrink-0">
                        <SafePosterImage
                          src={h.poster}
                          alt={h.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-zinc-100 group-hover:text-amber-400 truncate">
                          {h.name}
                        </div>
                        <div className="text-[10px] text-amber-400 truncate mt-0.5">
                          {h.episodeTitle || 'Xem tiếp'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* SECTION HEADER BAR */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/[0.10]">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-400">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
                    />
                  </svg>
                </span>
                <h2 className="text-lg md:text-xl font-extrabold text-white tracking-tight drop-shadow">
                  {activeCatalog.title}
                </h2>
                {activeCatalog.navKey === 'truyen-hinh' && !isLoading && (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-extrabold">
                    {displayedItems.length} kênh
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {activeCatalog.navKey === 'truyen-hinh' ? (
                  <div className="inline-flex flex-wrap items-center bg-[#131824] border border-white/10 rounded-xl p-1 gap-1">
                    {LIVE_TV_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setLiveTvFilter(f.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          liveTvFilter === f.id
                            ? 'bg-amber-500 text-black'
                            : 'text-zinc-300 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  activeCatalog.navKey !== 'watchlist' &&
                  activeCatalog.navKey !== 'search' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setInfiniteScrollEnabled((prev) => !prev)}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer ${
                          infiniteScrollEnabled
                            ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                            : 'bg-[#131824] border-white/10 text-zinc-300 hover:text-white'
                        }`}
                      >
                        {infiniteScrollEnabled ? '✓ Cuộn vô tận: BẬT' : 'Cuộn vô tận: TẮT'}
                      </button>

                      <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-zinc-300">
                        <span className="text-amber-400">◉</span>
                        <span>
                          TRANG <strong className="text-white">{page}</strong> / {totalPages}
                        </span>
                      </div>
                    </>
                  )
                )}
              </div>
            </div>

            {/* 6-COLUMN MOVIE POSTER GRID */}
            {(isLoading || isSearching) && displayedItems.length === 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {Array.from({ length: 12 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl bg-[#111520] border border-white/5 overflow-hidden animate-pulse"
                  >
                    <div className="aspect-[2/3] w-full bg-zinc-800/70" />
                    <div className="p-3 space-y-2">
                      <div className="h-3.5 w-4/5 bg-zinc-800 rounded" />
                      <div className="h-2.5 w-3/5 bg-zinc-800/70 rounded" />
                      <div className="h-2.5 w-2/5 bg-zinc-800/50 rounded pt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayedItems.length === 0 ? (
              <div className="bg-[#111520]/90 border border-white/10 rounded-2xl p-12 text-center space-y-3">
                <p className="text-base font-bold text-zinc-200">
                  {activeCatalog.navKey === 'watchlist'
                    ? 'Tủ Phim của bạn đang trống.'
                    : 'Không tìm thấy phim phù hợp trong danh mục này.'}
                </p>
                <p className="text-xs text-zinc-400">
                  Hãy chọn danh mục khác trên thanh điều hướng hoặc quay lại Mới Cập Nhật.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {displayedItems.map((item, idx) => (
                    <CinemaGridCard
                      key={`${activeCatalog.id}_${item.id}_${idx}`}
                      item={item}
                      onSelect={handleSelectMedia}
                    />
                  ))}
                </div>

                {infiniteScrollEnabled &&
                  activeCatalog.navKey !== 'truyen-hinh' &&
                  activeCatalog.navKey !== 'watchlist' &&
                  activeCatalog.navKey !== 'search' && (
                    <div ref={sentinelRef} className="py-6 flex justify-center">
                      {isLoadingMore && (
                        <div className="px-4 py-2 rounded-full bg-[#131824] border border-amber-500/30 text-xs font-semibold text-amber-300 animate-pulse">
                          Đang tải thêm phim trang tiếp theo...
                        </div>
                      )}
                    </div>
                  )}

                {activeCatalog.navKey !== 'truyen-hinh' &&
                  activeCatalog.navKey !== 'watchlist' &&
                  activeCatalog.navKey !== 'search' &&
                  totalPages > 1 && (
                    <div className="pt-8 pb-4 flex items-center justify-center gap-2 flex-wrap">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => handlePageSelect(page - 1)}
                        aria-label="Trang trước"
                        className="w-10 h-10 rounded-full bg-[#131824] hover:bg-[#1c2333] disabled:opacity-40 border border-white/10 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        ‹
                      </button>

                      {pageNumbers.map((pg, i) =>
                        pg === 'ellipsis' ? (
                          <span
                            key={`ellipsis_${i}`}
                            className="px-2 text-zinc-400 text-xs font-bold select-none"
                          >
                            ...
                          </span>
                        ) : (
                          <button
                            key={pg}
                            type="button"
                            onClick={() => handlePageSelect(pg)}
                            className={`min-w-[40px] h-10 px-3 rounded-full text-xs font-extrabold transition-all cursor-pointer ${
                              page === pg
                                ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/25 scale-105'
                                : 'bg-[#131824] hover:bg-[#1c2333] border border-white/10 text-zinc-300 hover:text-white'
                            }`}
                          >
                            {pg}
                          </button>
                        )
                      )}

                      <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => handlePageSelect(page + 1)}
                        aria-label="Trang tiếp"
                        className="w-10 h-10 rounded-full bg-[#131824] hover:bg-[#1c2333] disabled:opacity-40 border border-white/10 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        ›
                      </button>
                    </div>
                  )}
              </>
            )}
          </div>
        </main>
      )}

      {/* =====================================================================
          FOOTER MATCHING REFERENCE IMAGE (BRAND PHIMTNUI + DISCLAIMER)
         ===================================================================== */}
      <footer className="mt-12 border-t border-white/10 bg-[#04060b] py-10 px-4 md:px-8 text-center">
        <div className="max-w-4xl mx-auto space-y-4">
          <p className="text-xs sm:text-sm text-zinc-400 tracking-wide">
            © 2026 <strong className="font-bold text-white">PHIMTNUI.</strong> All rights reserved.
          </p>
          <p className="text-[11px] sm:text-xs text-zinc-400/80 leading-relaxed max-w-3xl mx-auto">
            Tất cả nội dung trên trang web này được tổng hợp tự động từ các nguồn công khai trên Internet và không lưu trữ hay phát trực tuyến bất kỳ tệp tin phương tiện nào trên máy chủ của chúng tôi. Nếu có bất kỳ nội dung nào vi phạm quyền sở hữu trí tuệ của bạn, vui lòng liên hệ thông báo, chúng tôi sẽ xử lý ngay lập tức.
          </p>
        </div>
      </footer>
    </div>
  );
};
