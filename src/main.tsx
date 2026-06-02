import React from 'react';
import { createRoot } from 'react-dom/client';
import { SDKProvider } from '@contentful/react-apps-toolkit';
import App from './App';
import './styles.css';

type ErrorBoundaryState = {
  error?: Error;
};

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell">
          <h1>DEV Crosspost</h1>
          <p className="status warning">{this.state.error.message || 'The app failed to render.'}</p>
        </main>
      );
    }

    return this.props.children;
  }
}

function LocalDevelopmentFallback() {
  return (
    <main className="app-shell">
      <h1>DEV Crosspost</h1>
      <p className="muted">
        Open this app inside Contentful to use the sidebar. For local payload checks, run <code>npm run dev:payload</code>.
      </p>
    </main>
  );
}

const isStandalone = window.self === window.top;

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {isStandalone ? (
        <LocalDevelopmentFallback />
      ) : (
        <SDKProvider>
          <App />
        </SDKProvider>
      )}
    </AppErrorBoundary>
  </React.StrictMode>,
);
