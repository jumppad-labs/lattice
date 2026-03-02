import { useEffect, useState } from 'react';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { ObserverService } from '../gen/observer/v1/observer_pb';
import type { Topology, Service } from '../gen/observer/v1/observer_pb';

export interface UseTopologyResult {
  topology: Topology | null;
  services: Service[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to stream topology updates from Lattice
 * Uses WatchTopology streaming RPC for real-time updates
 */
export function useTopology(): UseTopologyResult {
  const [topology, setTopology] = useState<Topology | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const transport = createConnectTransport({
      baseUrl: window.location.origin,
    });

    const client = createClient(ObserverService, transport);

    let aborted = false;

    async function streamTopology() {
      try {
        // Start streaming topology updates
        const stream = client.watchTopology({});

        for await (const update of stream) {
          if (aborted) break;

          if (update.topology) {
            setTopology(update.topology);
            setIsLoading(false);
          }
        }
      } catch (err) {
        if (!aborted) {
          console.error('Topology stream error:', err);
          setError(err instanceof Error ? err : new Error('Unknown error'));
          setIsLoading(false);
        }
      }
    }

    streamTopology();

    // Cleanup on unmount
    return () => {
      aborted = true;
    };
  }, []);

  return {
    topology,
    services: topology?.services || [],
    isLoading,
    error,
  };
}
