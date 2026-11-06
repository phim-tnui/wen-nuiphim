import React, { useState } from 'react';
import { CatalogItem, CustomEndpoints } from '../types';
import { parseMultipleUrls } from '../utils/streamUtils';

interface AdvancedSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLockAdmin: () => void;

  // Custom Movie APIs & VOD props
  customMovieApi: string;
  onCustomMovieApiChange: (val: string) => void;
  customEndpoints: CustomEndpoints;
  onSaveMovieApi: () => Promise<void>;
  isSavingMovieApi: boolean;
  movieApiSavedBadge: boolean;

  // API Keys & Integrations props
  debridKey: string;
  onDebridKeyChange: (val: string) => void;
  geminiKey: string;
  onGeminiKeyChange: (val: string) => void;
  is18Unlocked: boolean;
  adultExpanded: boolean;
  onHandleUnlock18: () => void;
  adultCatalogs: CatalogItem[];
  selectedCatalogs: string[];
  onToggleCatalog: (id: string) => void;

  // Shared actions
  onShowToast: (msg: string) => void;
}

export const AdvancedSettingsModal: React.FC<AdvancedSettingsModalProps> = ({
  isOpen,
  onClose,
  onLockAdmin,
  customMovieApi,
  onCustomMovieApiChange,
  customEndpoints,
  onSaveMovieApi,
  isSavingMovieApi,
  movieApiSavedBadge,
  debridKey,
  onDebridKeyChange,
  geminiKey,
  onGeminiKeyChange,
  is18Unlocked,
  adultExpanded,
  onHandleUnlock18,
  adultCatalogs,
  selectedCatalogs,
  onToggleCatalog,
  onShowToast,
}) => {
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{
    visible: boolean;
    status: 'loading' | 'success' | 'error';
    title?: string;
    message: string;
    samples?: string[];
  }>({ visible: false, status: 'loading', message: '' });

  if (!isOpen) return null;

  const handleTestMovieApi = async () => {
    const parsedUrls = parseMultipleUrls(customMovieApi);
    const testUrl = parsedUrls.length > 0 ? parsedUrls[0] : customMovieApi.trim();

    if (!testUrl || !testUrl.startsWith('http')) {
      onShowToast('⚠️ Vui lòng nhập link URL hợp lệ (bắt đầu bằng http:// hoặc https://)');
      return;
    }

    setIsTestingApi(true);
    setApiTestResult({
      visible: true,
      status: 'loading',
      message: `🔄 Đang kiểm tra kết nối và trích xuất dữ liệu từ: ${testUrl}...`,
    });

    try {
      const res = await fetch('/api/settings/test-movie-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: testUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setApiTestResult({
          visible: true,
          status: 'success',
          title: `✅ ${data.apiType || 'Chuẩn API'} (Ping: ${data.latencyMs || 0}ms)`,
          message: data.message || 'Kết nối thành công!',
          samples: Array.isArray(data.samples) ? data.samples : [],
        });
        onShowToast(`🟢 Test API thành công: ${data.apiType || ''}`);
      } else {
        setApiTestResult({
          visible: true,
          status: 'error',
          title: '❌ Lỗi kết nối API:',
          message: data.error || 'Không phản hồi đúng cấu trúc JSON',
        });
        onShowToast('❌ Lỗi kiểm tra API');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiTestResult({
        visible: true,
        status: 'error',
        title: '⚠️ Lỗi mạng:',
        message: msg,
      });
    } finally {
      setIsTestingApi(false);
    }
  };

  const customApiList =
    customEndpoints.customMovieApis ||
    (customEndpoints.customMovieApi ? [customEndpoints.customMovieApi] : []);

  return (
    <div className="settings-modal" onClick={onClose}>
      <div className="settings-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* CORE HEADER */}
        <div className="settings-modal-header">
          <div className="settings-modal-title">
            <span style={{ fontSize: '16px' }}>⚙️</span>
            <span>CÀI ĐẶT PRO • CẤU HÌNH NGUỒN PHIM &amp; TÍCH HỢP</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn-stream-action"
              onClick={onLockAdmin}
              style={{
                padding: '4px 9px',
                fontSize: '10.5px',
                background: 'rgba(239,68,68,0.15)',
                color: '#fca5a5',
                border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: '8px',
              }}
              title="Khóa bảo vệ Cài Đặt PRO"
            >
              🔒 Khóa
            </button>
            <button
              type="button"
              className="settings-close-btn"
              onClick={onClose}
              title="Đóng cài đặt"
            >
              ✕
            </button>
          </div>
        </div>

        {/* CONDENSED CONFIGURATION BODY: ONLY CUSTOM MOVIE APIS & VOD + API KEYS & INTEGRATIONS */}
        <div className="settings-modal-body">
          <div className="settings-tab-pane">
            {/* 1. CUSTOM MOVIE APIS & VOD */}
            <div className="custom-api-card">
              <div className="custom-api-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>🎬</span>
                  <div>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 800,
                        color: '#67e8f9',
                        letterSpacing: '0.3px',
                      }}
                    >
                      Nguồn API Phim Mới (Custom Movie APIs &amp; VOD)
                    </div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                      Nhập endpoint API phim để hệ thống tự động fetch và phân giải luồng (.m3u8,
                      MacCMS, REST)
                    </div>
                  </div>
                </div>
                {movieApiSavedBadge && (
                  <span
                    style={{
                      fontSize: '9.5px',
                      color: '#10b981',
                      fontWeight: 700,
                      background: 'rgba(16,185,129,0.15)',
                      border: '1px solid rgba(16,185,129,0.3)',
                      padding: '2px 7px',
                      borderRadius: '6px',
                    }}
                  >
                    ✓ Đã Lưu &amp; Tích Hợp
                  </span>
                )}
              </div>

              <div className="custom-api-input-row">
                <input
                  type="text"
                  className="panel-input custom-api-input"
                  placeholder="https://api.xink.pro/api, https://phimapi.com... (nhập nhiều link cách nhau dấu phẩy)"
                  value={customMovieApi}
                  onChange={(e) => onCustomMovieApiChange(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-api-act btn-api-save"
                  disabled={isSavingMovieApi}
                  onClick={onSaveMovieApi}
                  title="Lưu và tích hợp nguồn phim API vào hệ thống"
                >
                  <span>{isSavingMovieApi ? '⏳ Đang lưu...' : '💾 Lưu API'}</span>
                </button>
                <button
                  type="button"
                  className="btn-api-act btn-api-test"
                  disabled={isTestingApi}
                  onClick={handleTestMovieApi}
                  title="Kiểm tra kết nối và cấu trúc dữ liệu"
                >
                  <span>{isTestingApi ? '⏳ Đang test...' : '⚡ Kiểm Tra'}</span>
                </button>
              </div>

              {apiTestResult.visible && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '7px 11px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    lineHeight: 1.4,
                    background:
                      apiTestResult.status === 'loading'
                        ? 'rgba(56, 189, 248, 0.1)'
                        : apiTestResult.status === 'success'
                        ? 'rgba(16, 185, 129, 0.12)'
                        : 'rgba(239, 68, 68, 0.12)',
                    border:
                      apiTestResult.status === 'loading'
                        ? '1px solid rgba(56, 189, 248, 0.3)'
                        : apiTestResult.status === 'success'
                        ? '1px solid rgba(16, 185, 129, 0.4)'
                        : '1px solid rgba(239, 68, 68, 0.4)',
                    color:
                      apiTestResult.status === 'loading'
                        ? '#38bdf8'
                        : apiTestResult.status === 'success'
                        ? '#34d399'
                        : '#f87171',
                  }}
                >
                  {apiTestResult.title && (
                    <div>
                      <b>{apiTestResult.title}</b>
                    </div>
                  )}
                  <div>{apiTestResult.message}</div>
                  {apiTestResult.samples && apiTestResult.samples.length > 0 && (
                    <div>
                      🎬 Phim mẫu phát hiện: <b>{apiTestResult.samples.join(', ')}</b>
                    </div>
                  )}
                </div>
              )}

              <div className="custom-api-tags">
                <span className="api-tag-item default">🟢 KKPhim</span>
                <span className="api-tag-item default">🟢 OPhim</span>
                <span className="api-tag-item default">🟢 NguonC</span>
                <span className="api-tag-item default">🟢 VSMOV</span>
                <span className="api-tag-item default">🟢 XinkPro</span>
                {customApiList.map((u, idx) => {
                  let label = u.substring(0, 22);
                  try {
                    label = new URL(u).hostname.replace(/^www\./, '');
                  } catch {
                    // fallback to substring
                  }
                  return (
                    <span key={idx} className="api-tag-item custom" title={u}>
                      🚀 {label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* 2. API KEYS & INTEGRATIONS */}
            <div className="settings-compact-card" style={{ width: '100%' }}>
              <div className="settings-compact-header">
                <span className="settings-compact-title">🔑 Khóa API &amp; Tích Hợp</span>
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                  Real-Debrid / AI / 18+
                </span>
              </div>

              <div className="compact-input-group">
                <span className="compact-label" style={{ color: '#fef08a' }}>
                  Token Real-Debrid / TorBox:
                </span>
                <input
                  type="password"
                  className="panel-input"
                  placeholder="Mã token VIP (nếu có)..."
                  value={debridKey}
                  onChange={(e) => onDebridKeyChange(e.target.value)}
                  style={{ marginTop: '2px', padding: '6px 10px', fontSize: '11px' }}
                />
              </div>

              <div className="compact-input-group">
                <span className="compact-label" style={{ color: '#d8b4fe' }}>
                  Google Gemini API Key:
                </span>
                <input
                  type="password"
                  className="panel-input"
                  placeholder="Khóa AI dịch phụ đề (nếu có)..."
                  value={geminiKey}
                  onChange={(e) => onGeminiKeyChange(e.target.value)}
                  style={{ marginTop: '2px', padding: '6px 10px', fontSize: '11px' }}
                />
              </div>

              <div style={{ marginTop: '2px' }}>
                <button
                  className={`tool-btn btn-lock-18 ${is18Unlocked ? 'unlocked' : ''}`}
                  type="button"
                  onClick={onHandleUnlock18}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    minHeight: '34px',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderRadius: '10px',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{is18Unlocked ? '🔓' : '🔒'}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700 }}>
                      {is18Unlocked ? 'Phim Mở' : 'Phim API (18+)'}
                    </span>
                  </span>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>Nhập Pass Admin</span>
                </button>
                <div className={`adult-subgroup ${adultExpanded ? 'expanded' : ''}`}>
                  <div
                    style={{
                      background: 'rgba(20,10,10,0.88)',
                      border: '1px solid rgba(239,68,68,0.35)',
                      borderRadius: '12px',
                      padding: '8px',
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '6px',
                      marginTop: '6px',
                    }}
                  >
                    {adultCatalogs.map((item) => (
                      <label key={item.id} className="adult-pill">
                        <input
                          type="checkbox"
                          value={item.id}
                          checked={selectedCatalogs.includes(item.id)}
                          onChange={() => onToggleCatalog(item.id)}
                        />
                        <span>{item.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
