import React, { useEffect, useRef, useState } from 'react';
import { PreviewTarget } from '../types';
import {
  FALLBACK_CLEAR_KEYS,
  getDashProxyFallbackUrl,
  getDirectFromDashProxyUrl,
  getPlayableStreamUrl,
} from '../utils/streamUtils';

declare global {
  interface Window {
    shaka?: {
      Player: {
        new (video: HTMLVideoElement): ShakaPlayerInstance;
        isBrowserSupported?: () => boolean;
        isTypeSupported?: (mimeType: string) => boolean;
      };
      polyfill?: {
        installAll?: () => void;
      };
      net: {
        NetworkingEngine: {
          RequestType: {
            MANIFEST: number;
          };
        };
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Hls?: any;
  }
}

interface ShakaPlayerInstance {
  destroy: () => Promise<void>;
  configure: (config: Record<string, unknown>) => void;
  load: (url: string) => Promise<void>;
  getVariantTracks?: () => Array<{ id: number; height: number }>;
  selectVariantTrack?: (track: { id: number; height: number }, clearBuffer?: boolean) => void;
  getNetworkingEngine: () => {
    registerResponseFilter: (
      callback: (type: number, response: { data: BufferSource }) => void
    ) => void;
  };
}

interface PlayerModalProps {
  target: PreviewTarget | null;
  onClose: () => void;
  onCopyUrl: (url: string) => void;
  onShowToast: (msg: string) => void;
}

const ASPECT_MODES: Array<'contain' | 'cover' | 'fill'> = ['contain', 'cover', 'fill'];
const ASPECT_LABELS = ['Vừa Vặn', 'Tràn Viền', 'Kéo Giãn'];

export const PlayerModal: React.FC<PlayerModalProps> = ({
  target,
  onClose,
  onCopyUrl,
  onShowToast,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<ShakaPlayerInstance | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null);
  const [statusText, setStatusText] = useState('Shaka Player Ready');
  const [aspectIdx, setAspectIdx] = useState(0);
  const [resolvedKid, setResolvedKid] = useState('');
  const [resolvedKey, setResolvedKey] = useState('');

  useEffect(() => {
    if (!target) return;

    const videoEl = videoRef.current;
    if (!videoEl) return;

    let isCancelled = false;
    const playableUrl = getPlayableStreamUrl(target.streamUrl);
    let kidHex = target.kidHex || '';
    let keyHex = target.keyHex || '';

    if (!kidHex || !keyHex) {
      const sLower = `${target.streamUrl} ${target.streamName || ''}`.toLowerCase();
      for (const k of Object.keys(FALLBACK_CLEAR_KEYS)) {
        if (sLower.includes(k)) {
          kidHex = FALLBACK_CLEAR_KEYS[k].kid;
          keyHex = FALLBACK_CLEAR_KEYS[k].key;
          break;
        }
      }
    }

    setResolvedKid(kidHex);
    setResolvedKey(keyHex);

    const initPlayer = async () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }
      if (playerRef.current) {
        try {
          await playerRef.current.destroy();
        } catch {
          // ignore cleanup error
        }
        playerRef.current = null;
      }

      if (isCancelled) return;

      const isMpd =
        target.streamType === 'dash' ||
        playableUrl.includes('.mpd') ||
        playableUrl.includes('/proxy/dash/') ||
        target.streamUrl.includes('.mpd') ||
        Boolean(kidHex && keyHex);

      const shakaSupported = Boolean(
        window.shaka &&
          (typeof window.shaka.Player.isBrowserSupported === 'function'
            ? window.shaka.Player.isBrowserSupported()
            : true)
      );

      if (shakaSupported && isMpd && window.shaka) {
        window.shaka.polyfill?.installAll?.();
        setStatusText('Đang khởi chạy Shaka Player (MPEG-DASH & ClearKey)...');
        const player = new window.shaka.Player(videoEl);
        playerRef.current = player;

        const config: Record<string, unknown> = {
          streaming: {
            bufferingGoal: 12,
            rebufferingGoal: 2,
            bufferBehind: 15,
            retryParameters: { maxAttempts: 3, baseDelay: 800, backoffFactor: 1.5 },
            ignoreTextStreamFailures: true,
            alwaysStreamText: false,
          },
          manifest: {
            retryParameters: { maxAttempts: 3 },
          },
        };

        if (kidHex && keyHex) {
          const cleanKid = kidHex.replace(/-/g, '').toLowerCase();
          const cleanKey = keyHex.replace(/-/g, '').toLowerCase();
          const drmConf: Record<string, string> = {
            [cleanKid]: cleanKey,
          };
          if (cleanKid.length === 32) {
            const dashed = `${cleanKid.slice(0, 8)}-${cleanKid.slice(8, 12)}-${cleanKid.slice(
              12,
              16
            )}-${cleanKid.slice(16, 20)}-${cleanKid.slice(20)}`;
            drmConf[dashed] = cleanKey;
          }
          config.drm = {
            clearKeys: drmConf,
            preferredKeySystems: ['org.w3.clearkey'],
          };
        }

        player.getNetworkingEngine().registerResponseFilter((type, response) => {
          if (
            window.shaka &&
            type === window.shaka.net.NetworkingEngine.RequestType.MANIFEST
          ) {
            try {
              let mpdStr = new TextDecoder('utf-8').decode(response.data);
              mpdStr = mpdStr.replace(
                new RegExp(
                  '<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*>[^]*?</ContentProtection>',
                  'gi'
                ),
                ''
              );
              mpdStr = mpdStr.replace(
                new RegExp(
                  '<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*/>',
                  'gi'
                ),
                ''
              );
              mpdStr = mpdStr.replace(
                new RegExp(
                  '<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*>[^]*?</ContentProtection>',
                  'gi'
                ),
                ''
              );
              mpdStr = mpdStr.replace(
                new RegExp(
                  '<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*/>',
                  'gi'
                ),
                ''
              );
              response.data = new TextEncoder().encode(mpdStr);
            } catch {
              // ignore filter parse error
            }
          }
        });

        player.configure(config);

        const directUrl = getDirectFromDashProxyUrl(playableUrl) || playableUrl;
        const proxyFallbackUrl = getDashProxyFallbackUrl(directUrl);

        try {
          await player.load(directUrl);
          if (!isCancelled) {
            setStatusText('Đang phát trực tiếp MPEG-DASH + ClearKey ✅');
            try {
              await videoEl.play();
            } catch {
              videoEl.muted = true;
              await videoEl.play().catch(() => {});
            }
          }
          return;
        } catch (err: unknown) {
          if (!isCancelled && proxyFallbackUrl && proxyFallbackUrl !== directUrl) {
            try {
              await player.load(proxyFallbackUrl);
              if (!isCancelled) {
                setStatusText('Đang phát trực tiếp MPEG-DASH (Proxy) ✅');
                try {
                  await videoEl.play();
                } catch {
                  videoEl.muted = true;
                  await videoEl.play().catch(() => {});
                }
              }
              return;
            } catch {
              // continue to error status
            }
          }
          if (!isCancelled) {
            const msg = err instanceof Error ? err.message : String(err);
            setStatusText(`Lỗi phát Shaka: ${msg}`);
          }
          return;
        }
      }

      if (window.Hls && window.Hls.isSupported()) {
        setStatusText('Đang khởi chạy HLS Engine...');
        const hls = new window.Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;
        hls.loadSource(playableUrl);
        hls.attachMedia(videoEl);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          if (!isCancelled) {
            setStatusText('Đang phát trực tiếp HLS ✅');
            videoEl.play().catch(() => {});
          }
        });
        return;
      }

      setStatusText('Phát video trực tiếp...');
      videoEl.src = playableUrl;
      videoEl.play().catch(() => {});
    };

    initPlayer();

    return () => {
      isCancelled = true;
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }
      if (videoEl) {
        videoEl.pause();
        videoEl.src = '';
      }
      if (playerRef.current) {
        playerRef.current.destroy().catch(() => {});
        playerRef.current = null;
      }
    };
  }, [target]);

  if (!target) return null;

  const playableUrl = getPlayableStreamUrl(target.streamUrl);
  const externalWebPlayerHref = `/api/player?url=${encodeURIComponent(playableUrl)}${
    resolvedKid ? `&kid=${encodeURIComponent(resolvedKid)}` : ''
  }${resolvedKey ? `&key=${encodeURIComponent(resolvedKey)}` : ''}&name=${encodeURIComponent(
    target.streamName || 'Live TV'
  )}`;

  const handleCycleAspect = () => {
    const nextIdx = (aspectIdx + 1) % ASPECT_MODES.length;
    setAspectIdx(nextIdx);
    onShowToast(`📐 Thu phóng: ${ASPECT_LABELS[nextIdx]}`);
  };

  return (
    <div className="player-modal" onClick={onClose}>
      <div className="player-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="player-modal-header">
          <span className="player-modal-title">
            {target.streamName || 'Trình Phát Thử Nghiệm'}
          </span>
          <button type="button" className="player-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="player-video-wrap">
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            style={{ objectFit: ASPECT_MODES[aspectIdx] }}
          />
        </div>
        <div
          style={{
            padding: '10px 14px',
            background: '#090d16',
            fontSize: '10.5px',
            color: '#94a3b8',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <span>{statusText}</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn-stream-action" onClick={handleCycleAspect}>
              📐 <span>{ASPECT_LABELS[aspectIdx]}</span>
            </button>
            <a
              href={externalWebPlayerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-stream-action"
              style={{
                background: 'rgba(56,189,248,0.2)',
                color: '#38bdf8',
                borderColor: '#38bdf8',
                textDecoration: 'none',
              }}
            >
              🚀 Web Player Vượt Màn Đen
            </a>
            <button
              type="button"
              className="btn-stream-action"
              onClick={() => onCopyUrl(playableUrl)}
            >
              📋 Chép URL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
