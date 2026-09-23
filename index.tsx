import './index.css';
import React, { Component, ReactNode, ErrorInfo } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Safely unregister any stale service workers and purge caches
try {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    }).catch(() => {});
  }
} catch (_) {}

try {
  if (typeof window !== 'undefined' && 'caches' in window) {
    caches.keys().then((keys) => {
      for (const key of keys) {
        caches.delete(key);
      }
    }).catch(() => {});
  }
} catch (_) {}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          width: '100vw',
          backgroundColor: '#0f0f0f',
          color: '#ffffff',
          fontFamily: 'system-ui, sans-serif',
          padding: '24px',
          boxSizing: 'border-box',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 12px 0', color: '#f97316' }}>
            Παρουσιάστηκε σφάλμα κατά τη φόρτωση
          </h2>
          <p style={{ fontSize: '13px', color: '#a1a1aa', maxWidth: '500px', lineHeight: '1.5', margin: '0 0 20px 0' }}>
            {this.state.error?.message || "Άγνωστο σφάλμα"}
          </p>
          <button
            onClick={() => {
              window.location.reload();
            }}
            style={{
              padding: '10px 20px',
              backgroundColor: '#f97316',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Επαναφόρτωση Σελίδας
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
