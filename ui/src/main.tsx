import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransportProvider } from '@connectrpc/connect-query';
import { createConnectTransport } from '@connectrpc/connect-web';
import App from './App';
import './index.css';

// Create Connect-RPC transport
const transport = createConnectTransport({
  baseUrl: window.location.origin,
});

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <TransportProvider transport={transport}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </TransportProvider>
);
