import { useQuery } from '@tanstack/react-query';
import { createConnectTransport } from '@connectrpc/connect-web';
import { createClient } from '@connectrpc/connect';
import { ObserverService } from '../gen/observer/v1/observer_pb';
import type { RequestLog } from '../gen/observer/v1/observer_pb';

const transport = createConnectTransport({
  baseUrl: window.location.origin,
});

const client = createClient(ObserverService, transport);

interface UseRequestLogsOptions {
  serviceName: string;
  afterSequence?: bigint;
  limit?: number;
  enabled?: boolean;
  refetchInterval?: number | false;
}

interface RequestLogsResult {
  logs: RequestLog[];
  latestSequence: bigint;
}

export function useRequestLogs({
  serviceName,
  afterSequence = 0n,
  limit = 100,
  enabled = true,
  refetchInterval = 2000, // Poll every 2 seconds
}: UseRequestLogsOptions) {
  return useQuery<RequestLogsResult>({
    queryKey: ['requestLogs', serviceName, afterSequence.toString()],
    queryFn: async () => {
      const response = await client.getRequestLogs({
        serviceName,
        afterSequence,
        limit,
      });

      return {
        logs: response.logs,
        latestSequence: response.latestSequence,
      };
    },
    enabled: enabled && serviceName !== '',
    refetchInterval, // Auto-refresh to get new logs
  });
}
