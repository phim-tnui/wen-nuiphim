import React, { Component, ErrorInfo, ReactNode } from 'react';

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  onRollback: () => void;
}

interface PreviewErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  constructor(props: PreviewErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Lỗi không xác định trong giao diện Preview',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[PreviewErrorBoundary] Caught error in Preview UI:', error, errorInfo);
  }

  handleSafeRollback = () => {
    this.setState({ hasError: false, errorMessage: '' });
    this.props.onRollback();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            width: '100%',
            background: '#090d16',
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              width: '100%',
              background: '#131b2e',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              borderRadius: '20px',
              padding: '28px 24px',
              textAlign: 'center',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
            }}
          >
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🛡️</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 800, color: '#fef3c7' }}>
              Chế Độ Bảo Vệ Tự Động (Safe Rollback)
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
              Phát hiện sự cố khi hiển thị bản Preview:{' '}
              <span style={{ color: '#fca5a5' }}>{this.state.errorMessage}</span>. Bản Addon gốc của
              bạn vẫn an toàn tuyệt đối.
            </p>
            <button
              type="button"
              onClick={this.handleSafeRollback}
              style={{
                width: '100%',
                padding: '12px 18px',
                borderRadius: '12px',
                border: 'none',
                background: '#f59e0b',
                color: '#050505',
                fontWeight: 800,
                fontSize: '13.5px',
                cursor: 'pointer',
              }}
            >
              ⏪ Quay Về Bản Addon Gốc Ngay Lập Tức
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
