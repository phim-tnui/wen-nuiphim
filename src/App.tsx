import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CatalogItem, CustomEndpoints, PreviewTarget, StreamMode } from './types';
import {
  DEFAULT_ADULT_CATALOGS,
  DEFAULT_MOVIE_CATALOGS,
  DEFAULT_TV_CATALOGS,
} from './data/catalogs';
import { fromBase64Url, parseMultipleUrls, toBase64Url } from './utils/streamUtils';
import { PlayerModal } from './components/PlayerModal';
import { AdminAuthGateModal, QrModal, Unlock18Modal } from './components/Modals';
import { AdvancedSettingsModal } from './components/AdvancedSettingsModal';
import { PreviewErrorBoundary } from './components/PreviewErrorBoundary';
import { PreviewWebApp } from './components/PreviewWebApp';

// ============================================================================
// HIDDEN BACKGROUND AUTOMATION CONSTANTS
// Live TV, Live Football, Live Network Scraper, Captured Streams,
// Stream Proxy & ClearKey Decryption, and Auraflix 30m run automatically.
// ============================================================================
const HIDDEN_BACKGROUND_AUTOMATION = Object.freeze({
  DEFAULT_STREAM_MODE: 'native' as StreamMode,
  STREAM_PROXY_ENABLED: true,
  CLEARKEY_DECRYPTION_ENABLED: true,
  LIVE_TV_SYNC_INTERVAL_MS: 10 * 60 * 1000, // 10m automated .mpd health & channel sync
  LIVE_FOOTBALL_SYNC_INTERVAL_MS: 5 * 60 * 1000, // 5m automated live football sync
  AURAFLIX_CRAWLER_INTERVAL_MS: 30 * 60 * 1000, // 30m automated Auraflix & ClearKey crawl
  CAPTURED_STREAMS_SYNC_INTERVAL_MS: 15 * 60 * 1000, // 15m captured stream pool refresh
  ALLOWED_TV_CATALOG_IDS: [
    'tv_tong_hop',
    'tv_quoc_te',
    'tv_vtv',
    'tv_vtvcab',
    'tv_giai_tri',
    'tv_dia_phuong',
    'sports_live_matches',
  ] as const,
});

export const App: React.FC = () => {
  // Safe Preview vs Classic Addon Mode state (Default: Classic Root Addon UI)
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(() => {
    const path = window.location.pathname || '';
    const search = window.location.search || '';
    return path.startsWith('/preview') || search.includes('preview=1');
  });

  // Catalogs state (Live TV strictly maintains the 4 selection filters)
  const [tvCatalogs, setTvCatalogs] = useState<CatalogItem[]>(DEFAULT_TV_CATALOGS);
  const [movieCatalogs, setMovieCatalogs] = useState<CatalogItem[]>(DEFAULT_MOVIE_CATALOGS);
  const [adultCatalogs, setAdultCatalogs] = useState<CatalogItem[]>(DEFAULT_ADULT_CATALOGS);

  // User config state
  const [selectedCatalogs, setSelectedCatalogs] = useState<string[]>(() => {
    return [
      ...DEFAULT_TV_CATALOGS.filter((c) => c.defaultChecked).map((c) => c.id),
      ...DEFAULT_MOVIE_CATALOGS.filter((c) => c.defaultChecked).map((c) => c.id),
    ];
  });
  const [debridKey, setDebridKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [customMovieApi, setCustomMovieApi] = useState('');
  const [customEndpoints, setCustomEndpoints] = useState<CustomEndpoints>({});
  const [isSavingMovieApi, setIsSavingMovieApi] = useState(false);
  const [movieApiSavedBadge, setMovieApiSavedBadge] = useState(false);

  // 18+ unlock state
  const [is18Unlocked, setIs18Unlocked] = useState(false);
  const [adultExpanded, setAdultExpanded] = useState(false);

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminAuthOpen, setIsAdminAuthOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isUnlock18ModalOpen, setIsUnlock18ModalOpen] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);

  // Toast state
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToastMessage = useCallback((msg: string) => {
    setToastMsg(msg || '✅ Hoàn tất!');
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 2500);
  }, []);

  // Sync body class and browser history for Preview Mode & Rollback
  useEffect(() => {
    document.body.classList.toggle('preview-web-active', isPreviewMode);
    return () => {
      document.body.classList.remove('preview-web-active');
    };
  }, [isPreviewMode]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname || '';
      const search = window.location.search || '';
      setIsPreviewMode(path.startsWith('/preview') || search.includes('preview=1'));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleEnterPreviewMode = useCallback(() => {
    try {
      window.history.pushState({}, '', '/preview');
    } catch {
      // ignore
    }
    setIsPreviewMode(true);
    showToastMessage('🎬 Đang mở Bản Preview: Web Xem Phim Cá Nhân 2-in-1');
  }, [showToastMessage]);

  const handleRollbackToClassic = useCallback(() => {
    try {
      window.history.pushState({}, '', '/');
    } catch {
      // ignore
    }
    setIsPreviewMode(false);
    showToastMessage('⏪ Đã quay về Bản Addon Gốc an toàn!');
  }, [showToastMessage]);

  // Automated background synchronization workers (no UI toggles required)
  const runAutomatedBackgroundSync = useCallback(async () => {
    try {
      await Promise.allSettled([
        fetch('/api/bot/status'),
        fetch('/api/live-tv/channels?status=all&category=all'),
        fetch('/api/football/matches'),
        fetch('/api/scraped-streams'),
        fetch('/api/scraper/crawler-status'),
      ]);
    } catch {
      // silent background automation
    }
  }, []);

  // Restore configuration from URL / localStorage and initialize automated background processes
  useEffect(() => {
    fetch('/api/catalogs')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) {
          if (Array.isArray(d.tvCatalogs) && d.tvCatalogs.length > 0) {
            const allowedSet = new Set<string>(HIDDEN_BACKGROUND_AUTOMATION.ALLOWED_TV_CATALOG_IDS);
            const prunedTv = d.tvCatalogs.filter((c: CatalogItem) => allowedSet.has(c.id));
            if (prunedTv.length > 0) setTvCatalogs(prunedTv);
          }
          if (Array.isArray(d.movieCatalogs) && d.movieCatalogs.length > 0)
            setMovieCatalogs(d.movieCatalogs);
          if (Array.isArray(d.adultCatalogs) && d.adultCatalogs.length > 0)
            setAdultCatalogs(d.adultCatalogs);
        }
      })
      .catch(() => {});

    try {
      let urlCfg = '';
      const path = window.location.pathname || '';
      if (path.includes('configure')) {
        const parts = path.split('/');
        for (let pi = 0; pi < parts.length; pi++) {
          if (parts[pi] === 'configure' && pi > 0) {
            const cand = parts[pi - 1];
            if (cand && cand !== 'config') {
              urlCfg = cand;
              break;
            }
          }
        }
      }

      let parsedUrlConfig: {
        rd?: string;
        ai?: string;
        c?: string[];
        catalogs?: string[];
      } | null = null;

      if (urlCfg) {
        try {
          parsedUrlConfig = JSON.parse(fromBase64Url(urlCfg));
        } catch {
          parsedUrlConfig = null;
        }
      }

      if (parsedUrlConfig) {
        if (parsedUrlConfig.rd) setDebridKey(parsedUrlConfig.rd);
        if (parsedUrlConfig.ai) setGeminiKey(parsedUrlConfig.ai);
        const cats = parsedUrlConfig.c || parsedUrlConfig.catalogs;
        if (Array.isArray(cats)) {
          setSelectedCatalogs(cats);
        }
      } else {
        const savedDebrid = localStorage.getItem('tungnui_debrid_key');
        if (savedDebrid) setDebridKey(savedDebrid);

        const savedGemini = localStorage.getItem('tungnui_gemini_key');
        if (savedGemini) setGeminiKey(savedGemini);

        const savedMovieApi = localStorage.getItem('tungnui_custom_movie_api');
        if (savedMovieApi) setCustomMovieApi(savedMovieApi);

        fetch('/api/settings/movie-source')
          .then((r) => r.json())
          .then((d) => {
            if (d?.endpoints) {
              setCustomEndpoints(d.endpoints);
              const apis =
                d.endpoints.customMovieApis ||
                (d.endpoints.customMovieApi ? [d.endpoints.customMovieApi] : []);
              if (apis.length > 0 && !savedMovieApi) {
                setCustomMovieApi(apis.join(', '));
              }
            }
          })
          .catch(() => {});

        const savedConfigsRaw = localStorage.getItem('tungnui_selected_cats');
        if (savedConfigsRaw) {
          const savedConfigs = JSON.parse(savedConfigsRaw);
          if (Array.isArray(savedConfigs)) {
            setSelectedCatalogs(savedConfigs);
          }
        }
      }

      const saved18 = localStorage.getItem('nuvio_18_unlocked') === 'true';
      if (saved18) {
        setIs18Unlocked(true);
      }

      if (
        window.location.pathname.includes('configure') ||
        window.location.hash.includes('settings')
      ) {
        setTimeout(() => {
          const isAuth =
            sessionStorage.getItem('nuvio_admin_auth') === 'true' ||
            localStorage.getItem('nuvio_admin_auth') === 'true';
          if (isAuth) setIsSettingsOpen(true);
          else setIsAdminAuthOpen(true);
        }, 120);
      }
    } catch {
      // ignore storage errors
    }

    // Start automated background processes immediately and on hidden schedules
    runAutomatedBackgroundSync();

    const liveTvTimer = setInterval(() => {
      fetch('/api/live-tv/channels?status=all&category=all').catch(() => {});
    }, HIDDEN_BACKGROUND_AUTOMATION.LIVE_TV_SYNC_INTERVAL_MS);

    const footballTimer = setInterval(() => {
      fetch('/api/football/matches').catch(() => {});
    }, HIDDEN_BACKGROUND_AUTOMATION.LIVE_FOOTBALL_SYNC_INTERVAL_MS);

    const capturedStreamsTimer = setInterval(() => {
      fetch('/api/scraped-streams').catch(() => {});
    }, HIDDEN_BACKGROUND_AUTOMATION.CAPTURED_STREAMS_SYNC_INTERVAL_MS);

    const auraflixTimer = setInterval(() => {
      fetch('/api/scraper/crawler-status').catch(() => {});
      fetch('/api/bot/status').catch(() => {});
    }, HIDDEN_BACKGROUND_AUTOMATION.AURAFLIX_CRAWLER_INTERVAL_MS);

    return () => {
      clearInterval(liveTvTimer);
      clearInterval(footballTimer);
      clearInterval(capturedStreamsTimer);
      clearInterval(auraflixTimer);
    };
  }, [runAutomatedBackgroundSync]);

  // Persist user configuration changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('tungnui_selected_cats', JSON.stringify(selectedCatalogs));
      localStorage.setItem('tungnui_debrid_key', debridKey.trim());
      localStorage.setItem('tungnui_gemini_key', geminiKey.trim());
      localStorage.setItem('tungnui_stream_mode', HIDDEN_BACKGROUND_AUTOMATION.DEFAULT_STREAM_MODE);
    } catch {
      // ignore storage errors
    }
  }, [selectedCatalogs, debridKey, geminiKey]);

  // Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSettingsOpen(false);
        setIsAdminAuthOpen(false);
        setIsUnlock18ModalOpen(false);
        setIsQrModalOpen(false);
        setPreviewTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Build manifest URL path using hardcoded background stream mode
  const getUrlPath = useCallback(() => {
    const configObj: {
      c: string[];
      m: StreamMode;
      rd?: string;
      ai?: string;
    } = {
      c: selectedCatalogs,
      m: HIDDEN_BACKGROUND_AUTOMATION.DEFAULT_STREAM_MODE,
    };
    if (debridKey.trim()) configObj.rd = debridKey.trim();
    if (geminiKey.trim()) configObj.ai = geminiKey.trim();

    const jsonStr = JSON.stringify(configObj);
    const b64 = toBase64Url(jsonStr);
    return `/config/${b64}/manifest.json`;
  }, [selectedCatalogs, debridKey, geminiKey]);

  const stremioInstallHref = `stremio://${window.location.host}${getUrlPath()}`;
  const fullManifestUrl = `${window.location.origin}${getUrlPath()}`;

  const copyTextToClipboard = useCallback(
    (text: string, successMessage: string, fallbackPrefix?: string) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            showToastMessage(successMessage);
          })
          .catch(() => {
            showToastMessage(`${fallbackPrefix || '📋'} ${text}`);
          });
      } else {
        showToastMessage(`${fallbackPrefix || '📋'} ${text}`);
      }
    },
    [showToastMessage]
  );

  const handleOpenAdvancedSettings = () => {
    const isAuth =
      sessionStorage.getItem('nuvio_admin_auth') === 'true' ||
      localStorage.getItem('nuvio_admin_auth') === 'true';
    if (!isAuth) {
      setIsAdminAuthOpen(true);
      return;
    }
    setIsSettingsOpen(true);
  };

  const handleAdminAuthenticated = () => {
    try {
      sessionStorage.setItem('nuvio_admin_auth', 'true');
    } catch {
      // ignore
    }
    setIsAdminAuthOpen(false);
    showToastMessage('🔓 Mở khóa Cài Đặt PRO thành công!');
    setIsSettingsOpen(true);
  };

  const handleLockAdmin = () => {
    try {
      sessionStorage.removeItem('nuvio_admin_auth');
      localStorage.removeItem('nuvio_admin_auth');
    } catch {
      // ignore
    }
    setIsSettingsOpen(false);
    showToastMessage('🔒 Đã khóa giao diện Cài Đặt PRO!');
  };

  const handleToggleCatalog = (id: string) => {
    setSelectedCatalogs((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSaveMovieApi = async () => {
    const val = customMovieApi.trim();
    const parsedUrls = parseMultipleUrls(val);
    setIsSavingMovieApi(true);
    try {
      localStorage.setItem('tungnui_custom_movie_api', val);
      const res = await fetch('/api/settings/movie-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: val, urls: parsedUrls }),
      });
      const data = await res.json();
      setMovieApiSavedBadge(true);
      setTimeout(() => setMovieApiSavedBadge(false), 3000);
      if (data.endpoints) setCustomEndpoints(data.endpoints);
      showToastMessage(`✅ ${data.message || 'Đã lưu nguồn phim API mới thành công!'}`);
    } catch {
      showToastMessage('⚠️ Đã lưu URL API vào cấu hình trình duyệt!');
    } finally {
      setIsSavingMovieApi(false);
    }
  };

  const handleUnlock18Click = () => {
    if (is18Unlocked) {
      setAdultExpanded((prev) => !prev);
      return;
    }
    setIsUnlock18ModalOpen(true);
  };

  const handleUnlock18Success = () => {
    setIs18Unlocked(true);
    setAdultExpanded(true);
    try {
      localStorage.setItem('nuvio_18_unlocked', 'true');
    } catch {
      // ignore
    }
    const adultIds = adultCatalogs.map((c) => c.id);
    setSelectedCatalogs((prev) => Array.from(new Set([...prev, ...adultIds])));
    setIsUnlock18ModalOpen(false);
    showToastMessage('🔓 Đã mở khóa danh mục 18+ thành công!');
  };

  return (
    <>
      {isPreviewMode ? (
        <PreviewErrorBoundary onRollback={handleRollbackToClassic}>
          <PreviewWebApp
            onRollbackToClassic={handleRollbackToClassic}
            onOpenAddonSettings={handleOpenAdvancedSettings}
            onCopyManifestUrl={() =>
              copyTextToClipboard(
                fullManifestUrl,
                '✅ Đã sao chép Link Manifest thành công!',
                '📋 Manifest:'
              )
            }
            onOpenQrModal={() => setIsQrModalOpen(true)}
            onShowToast={showToastMessage}
          />
        </PreviewErrorBoundary>
      ) : (
        <div className="titanium-frame">
          <div className="app-wrapper">
            {/* DYNAMIC ISLAND */}
            <div className="dynamic-island" title="Nuvio Studio Titanium">
              <div className="island-pill">
                <span className="island-sensor" />
                <span className="island-camera" />
              </div>
            </div>

            {/* CORE HEADER */}
            <div className="brand-header">
              <div className="popcorn-icon">🍿</div>
              <h1 className="brand-title">Tungnui-Addon AI</h1>
              <p className="brand-subtitle">
                Truyền Hình, Phim Đa Nguồn &amp; Dynamic Media Scraper
              </p>
            </div>

            {/* PREVIEW LAUNCHER BAR (SAFE SANDBOX PREVIEW FOR 2-IN-1 WEB PHIM) */}
            <div
              style={{
                width: '100%',
                marginBottom: '12px',
                padding: '10px 14px',
                borderRadius: '16px',
                background:
                  'linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(15, 23, 42, 0.9))',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#fef3c7' }}>
                  🎬 Bản Xem Trước: Web Xem Phim Cá Nhân (2-in-1)
                </span>
                <span style={{ fontSize: '10.5px', color: '#cbd5e1' }}>
                  Xem thử giao diện PHIM.TNUI (có nút quay lại bản gốc tức thì)
                </span>
              </div>
              <button
                type="button"
                onClick={handleEnterPreviewMode}
                style={{
                  padding: '8px 14px',
                  borderRadius: '12px',
                  border: 'none',
                  background: '#f59e0b',
                  color: '#050505',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                👁️ Mở Bản Preview
              </button>
            </div>

            {/* COMPACT MEDIA TOOLBAR & SETTINGS PRO TOGGLE */}
            <div
              className="settings-hub-bar"
              style={{ marginBottom: '14px' }}
              onClick={handleOpenAdvancedSettings}
              title="Nhấn để mở Cài Đặt"
            >
              <div className="settings-hub-info">
                <span style={{ fontSize: '16px' }}>🍿</span>
                <span className="settings-hub-title">
                  Danh Mục Nội Dung: TRUYỀN HÌNH &amp; PHIM TRUYỆN
                </span>
              </div>
              <button
                type="button"
                className="btn-settings-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAdvancedSettings();
                }}
                title="Mở Cài Đặt PRO"
              >
                <span className="gear-icon">⚙️</span>
                <span>Cài Đặt</span>
                <span className="badge-settings-tag">PRO</span>
              </button>
            </div>

            {/* SECTION 1: TRUYỀN HÌNH (4 SELECTION FILTERS) */}
            <div className="section-group">
              <div className="section-header">
                <div className="section-title">📺 Truyền Hình</div>
                <span className="section-badge-count">Live TV Channels</span>
              </div>
              <div className="catalog-grid-tv">
                {tvCatalogs.map((item) => (
                  <label key={item.id} className="cat-pill tv-pill">
                    <input
                      type="checkbox"
                      value={item.id}
                      checked={selectedCatalogs.includes(item.id)}
                      onChange={() => handleToggleCatalog(item.id)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* SECTION 2: PHIM TRUYỆN (MOVIES & SERIES) */}
            <div className="section-group">
              <div className="section-header">
                <div className="section-title">🎬 Phim Truyện</div>
                <span className="section-badge-count">Movies &amp; Series</span>
              </div>
              <div className="catalog-grid-movie">
                {movieCatalogs.map((item) => (
                  <label key={item.id} className="cat-pill movie-pill">
                    <input
                      type="checkbox"
                      value={item.id}
                      checked={selectedCatalogs.includes(item.id)}
                      onChange={() => handleToggleCatalog(item.id)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* BOTTOM ACTIONS */}
            <div className="bottom-actions" style={{ marginTop: '14px' }}>
              <a id="install-btn" className="btn-act btn-install" href={stremioInstallHref}>
                🧩 CÀI VÀO NUVIO / STREMIO
              </a>
              <button
                type="button"
                className="btn-act btn-qr"
                onClick={() => setIsQrModalOpen(true)}
              >
                📱 Quét QR Cài TV
              </button>
              <button
                type="button"
                className="btn-act btn-copy"
                onClick={() =>
                  copyTextToClipboard(
                    fullManifestUrl,
                    '✅ Đã sao chép Link thành công!',
                    '📋 Manifest:'
                  )
                }
              >
                📋 Chép Link Manifest
              </button>
            </div>

            {/* FOOTER PHIMTNUI */}
            <footer className="w-full mt-5 pt-4 border-t border-white/10 text-center space-y-2">
              <p className="text-xs text-zinc-400">
                © 2026 <strong className="font-bold text-white">PHIMTNUI.</strong> All rights reserved.
              </p>
              <p className="text-[11px] text-zinc-400/80 leading-relaxed">
                Tất cả nội dung trên trang web này được tổng hợp tự động từ các nguồn công khai trên Internet và không lưu trữ hay phát trực tuyến bất kỳ tệp tin phương tiện nào trên máy chủ của chúng tôi. Nếu có bất kỳ nội dung nào vi phạm quyền sở hữu trí tuệ của bạn, vui lòng liên hệ thông báo, chúng tôi sẽ xử lý ngay lập tức.
              </p>
            </footer>
          </div>
        </div>
      )}

      {/* TOAST */}
      <div id="toast" className={toastMsg ? 'show' : ''}>
        {toastMsg || '✅ Đã hoàn tất!'}
      </div>

      {/* PLAYER PREVIEW MODAL */}
      <PlayerModal
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
        onCopyUrl={(url) =>
          copyTextToClipboard(url, '📋 Đã sao chép link stream!', '📋 Stream:')
        }
        onShowToast={showToastMessage}
      />

      {/* QR MODAL */}
      <QrModal
        isOpen={isQrModalOpen}
        manifestUrl={fullManifestUrl}
        onClose={() => setIsQrModalOpen(false)}
      />

      {/* UNLOCK 18+ MODAL */}
      <Unlock18Modal
        isOpen={isUnlock18ModalOpen}
        onClose={() => setIsUnlock18ModalOpen(false)}
        onSuccess={handleUnlock18Success}
      />

      {/* ADMIN AUTHENTICATION GATE MODAL */}
      <AdminAuthGateModal
        isOpen={isAdminAuthOpen}
        onClose={() => setIsAdminAuthOpen(false)}
        onAuthenticated={handleAdminAuthenticated}
      />

      {/* CONDENSED SETTINGS MODAL (CORE HEADER + CUSTOM MOVIE APIS & VOD + API KEYS & INTEGRATIONS) */}
      <AdvancedSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onLockAdmin={handleLockAdmin}
        customMovieApi={customMovieApi}
        onCustomMovieApiChange={(val) => {
          setCustomMovieApi(val);
          try {
            localStorage.setItem('tungnui_custom_movie_api', val);
          } catch {
            // ignore
          }
        }}
        customEndpoints={customEndpoints}
        onSaveMovieApi={handleSaveMovieApi}
        isSavingMovieApi={isSavingMovieApi}
        movieApiSavedBadge={movieApiSavedBadge}
        debridKey={debridKey}
        onDebridKeyChange={setDebridKey}
        geminiKey={geminiKey}
        onGeminiKeyChange={setGeminiKey}
        is18Unlocked={is18Unlocked}
        adultExpanded={adultExpanded}
        onHandleUnlock18={handleUnlock18Click}
        adultCatalogs={adultCatalogs}
        selectedCatalogs={selectedCatalogs}
        onToggleCatalog={handleToggleCatalog}
        onShowToast={showToastMessage}
      />
    </>
  );
};

export default App;
