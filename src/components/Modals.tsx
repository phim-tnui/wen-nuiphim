import React, { useState } from 'react';

interface QrModalProps {
  isOpen: boolean;
  manifestUrl: string;
  onClose: () => void;
}

export const QrModal: React.FC<QrModalProps> = ({ isOpen, manifestUrl, onClose }) => {
  if (!isOpen) return null;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    manifestUrl
  )}`;

  return (
    <div className="qr-modal" onClick={onClose}>
      <div className="qr-box" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ color: '#fbbf24', marginBottom: '10px' }}>📱 Quét Mã QR Cài Mạng</h3>
        <div id="qrcode-container">
          <img
            src={qrSrc}
            width={220}
            height={220}
            alt="QR Code"
            style={{ display: 'block', borderRadius: '12px' }}
          />
        </div>
        <button type="button" className="btn-close-qr" onClick={onClose}>
          Đóng
        </button>
      </div>
    </div>
  );
};

interface Unlock18ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const Unlock18Modal: React.FC<Unlock18ModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [pass, setPass] = useState('');
  const [error, setError] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (pass.trim() === 'admin') {
      setPass('');
      setError(false);
      onSuccess();
    } else {
      setError(true);
    }
  };

  return (
    <div className="qr-modal" onClick={onClose}>
      <div
        className="qr-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '340px', textAlign: 'left' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '22px' }}>🔒</span>
          <div>
            <h3 style={{ color: '#ef4444', margin: 0, fontSize: '15px', fontWeight: 800 }}>
              Mở Khóa Danh Mục Phim API
            </h3>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              Nhập mật khẩu quản trị để mở khóa nội dung
            </div>
          </div>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <input
            type="password"
            className="panel-input"
            placeholder="Nhập mật khẩu (admin)..."
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            style={{ marginTop: 0, fontSize: '13px', padding: '10px 12px' }}
            autoFocus
          />
          {error && (
            <div style={{ color: '#f87171', fontSize: '11px', marginTop: '5px' }}>
              ❌ Mật khẩu không chính xác!
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn-stream-action"
            onClick={onClose}
            style={{
              flex: 1,
              justifyContent: 'center',
              padding: '10px',
              background: 'rgba(255,255,255,0.08)',
              color: '#cbd5e1',
            }}
          >
            Hủy
          </button>
          <button
            type="button"
            className="btn-stream-action"
            onClick={handleSubmit}
            style={{
              flex: 1,
              justifyContent: 'center',
              padding: '10px',
              background: '#ef4444',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            Mở Khóa
          </button>
        </div>
      </div>
    </div>
  );
};

interface TvBoxGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCopyTvBoxConfig: () => void;
}

export const TvBoxGuideModal: React.FC<TvBoxGuideModalProps> = ({
  isOpen,
  onClose,
  onCopyTvBoxConfig,
}) => {
  if (!isOpen) return null;
  const tvboxUrl = `${window.location.origin}/api/tvbox.json`;

  return (
    <div className="qr-modal" onClick={onClose}>
      <div
        className="qr-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '480px', textAlign: 'left' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            paddingBottom: '8px',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              fontWeight: 800,
              color: '#38bdf8',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>📺</span>
            <span>CÀI ĐẶT TVBOX & FONGMI (ANDROID TV)</span>
          </span>
          <button
            type="button"
            className="player-close-btn"
            onClick={onClose}
            style={{
              color: '#94a3b8',
              background: 'none',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            fontSize: '11.5px',
            color: '#cbd5e1',
            lineHeight: 1.6,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div
            style={{
              background: 'rgba(15,23,42,0.6)',
              padding: '10px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <b style={{ color: '#fef08a' }}>Bước 1: Sao chép Link Cấu Hình Đăng Ký</b>
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
              <input
                type="text"
                readOnly
                value={tvboxUrl}
                style={{
                  flex: 1,
                  background: '#050914',
                  border: '1px solid #334155',
                  color: '#38bdf8',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                }}
              />
              <button
                type="button"
                className="btn-stream-action"
                onClick={onCopyTvBoxConfig}
                style={{
                  padding: '6px 10px',
                  fontSize: '10.5px',
                  background: '#38bdf8',
                  color: '#000',
                  fontWeight: 700,
                }}
              >
                Chép
              </button>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(15,23,42,0.6)',
              padding: '10px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <b style={{ color: '#fef08a' }}>Bước 2: Nhập vào Ứng Dụng TVBox / FongMi</b>
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              <li>
                Mở ứng dụng <b>TVBox</b> (hoặc <b>FongMi / OKCat</b>) trên Android TV / Box.
              </li>
              <li>
                Vào <b>Cài đặt (Settings)</b> ➔ Chọn{' '}
                <b>Cấu hình / Đường dẫn đăng ký (Configuration / Subscribe)</b>.
              </li>
              <li>
                Dán đường link vừa sao chép ở trên vào ô URL rồi bấm <b>Xác nhận (OK)</b>.
              </li>
            </ul>
          </div>

          <div
            style={{
              background: 'rgba(16,185,129,0.1)',
              padding: '10px',
              borderRadius: '10px',
              border: '1px solid rgba(16,185,129,0.25)',
            }}
          >
            <b style={{ color: '#34d399' }}>Bước 3: Thưởng thức Trải Nghiệm Hoàn Toàn Miễn Phí</b>
            <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '11px' }}>
              Hệ thống tự động kích hoạt kho phim MacCMS, Live TV và bóng đá trực tiếp kèm giải mã
              DRM MPEG-DASH 2-Layer Bypass!
            </p>
          </div>
        </div>

        <div style={{ marginTop: '14px', textAlign: 'right' }}>
          <button
            type="button"
            className="btn-stream-action"
            onClick={onClose}
            style={{
              padding: '6px 16px',
              background: '#38bdf8',
              color: '#000',
              fontWeight: 700,
              borderRadius: '8px',
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

interface ConfirmResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const ConfirmResetModal: React.FC<ConfirmResetModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="qr-modal" onClick={onClose}>
      <div
        className="qr-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '360px', textAlign: 'left' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <span style={{ fontSize: '22px' }}>⚠️</span>
          <div>
            <h3 style={{ color: '#fbbf24', margin: 0, fontSize: '15px', fontWeight: 800 }}>
              Xác Nhận Khôi Phục Gốc
            </h3>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              Hành động này sẽ xóa dữ liệu cấu hình đã lưu
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: '12px',
            color: '#cbd5e1',
            lineHeight: 1.5,
            marginBottom: '14px',
          }}
        >
          Bạn có chắc chắn muốn khôi phục toàn bộ cài đặt gốc? Tất cả lựa chọn danh mục kênh, token
          Real-Debrid và Gemini API sẽ được đặt lại về mặc định chuẩn.
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn-stream-action"
            onClick={onClose}
            style={{
              flex: 1,
              justifyContent: 'center',
              padding: '10px',
              background: 'rgba(255,255,255,0.08)',
              color: '#cbd5e1',
            }}
          >
            Hủy Bỏ
          </button>
          <button
            type="button"
            className="btn-stream-action btn-stream-delete"
            onClick={onConfirm}
            style={{ flex: 1, justifyContent: 'center', padding: '10px', fontWeight: 700 }}
          >
            Khôi Phục Gốc
          </button>
        </div>
      </div>
    </div>
  );
};

interface AdminAuthGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}

export const AdminAuthGateModal: React.FC<AdminAuthGateModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
}) => {
  const [pass, setPass] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pass.trim() === 'admin') {
      setPass('');
      setErrorMsg('');
      onAuthenticated();
    } else {
      setErrorMsg('❌ Mật khẩu không chính xác! Vui lòng nhập: admin');
    }
  };

  return (
    <div className="auth-gate-overlay" onClick={onClose}>
      <div className="auth-gate-box" onClick={(e) => e.stopPropagation()}>
        <div style={{ textAlign: 'right', marginBottom: '-10px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '18px',
              cursor: 'pointer',
            }}
            title="Đóng"
          >
            ✕
          </button>
        </div>
        <div className="auth-gate-icon">🔐</div>
        <h2 className="auth-gate-title">Xác Thực Cài Đặt PRO</h2>
        <p className="auth-gate-subtitle">Vui lòng nhập mật khẩu.</p>

        <form className="auth-gate-form" onSubmit={handleSubmit}>
          <label className="auth-gate-label" htmlFor="auth-gate-pass">
            Mật khẩu quản trị:
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPwd ? 'text' : 'password'}
              id="auth-gate-pass"
              className="auth-gate-input"
              placeholder="Nhập mật khẩu ..."
              autoComplete="current-password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setErrorMsg('');
              }}
              required
              autoFocus
            />
            <button
              type="button"
              className="auth-toggle-pwd"
              onClick={() => setShowPwd((prev) => !prev)}
              title="Hiện/ẩn"
            >
              👁️
            </button>
          </div>

          {errorMsg && <div className="auth-gate-error">{errorMsg}</div>}

          <button type="submit" className="auth-gate-submit">
            Vào Trang Cài Đặt ➔
          </button>
        </form>

        <div className="auth-gate-hint">
          Nhập mật khẩu: <code>admin</code> (không cần tên người dùng)
        </div>
      </div>
    </div>
  );
};
