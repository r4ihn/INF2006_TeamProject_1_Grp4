import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';

declare global {
  interface Window {
    __showStartupError?: (message: string) => void;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

// Caches API data between pages and refetches it after changes.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } },
});

// Tell the startup safety net in index.html that the app is alive.
root.setAttribute('data-app-ready', 'true');

createRoot(root, {
  // A crash while rendering would otherwise leave an empty page.
  onUncaughtError(error) {
    root.removeAttribute('data-app-ready');
    window.__showStartupError?.(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  },
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
