import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '40px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#333',
          background: '#fafafa',
        }}>
          <h1 style={{ fontSize: '1.5em', marginBottom: '12px' }}>应用遇到了问题</h1>
          <p style={{ color: '#666', marginBottom: '24px', textAlign: 'center', maxWidth: '480px' }}>
            发生了一个意外错误。你的笔记数据仍然安全地保存在本地文件中。
          </p>
          {this.state.error && (
            <pre style={{
              background: '#f0f0f0',
              padding: '16px',
              borderRadius: '8px',
              fontSize: '0.85em',
              maxWidth: '100%',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              marginBottom: '24px',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            style={{
              padding: '10px 24px',
              fontSize: '1em',
              borderRadius: '6px',
              border: 'none',
              background: '#7c3aed',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
