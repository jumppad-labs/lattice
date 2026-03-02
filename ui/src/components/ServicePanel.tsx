import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import type { Service } from '../gen/observer/v1/observer_pb';
import { ServiceStatus } from '../gen/observer/v1/observer_pb';
import { Heading, Subheading } from '../catalyst/heading';
import { Badge } from '../catalyst/badge';
import { Text, Code } from '../catalyst/text';
import { DescriptionList, DescriptionTerm, DescriptionDetails } from '../catalyst/description-list';
import { Divider } from '../catalyst/divider';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../catalyst/table';
import { useServiceResources } from '../hooks/useServiceResources';
import { useResourceData } from '../hooks/useResourceData';
import { useRequestLogs } from '../hooks/useRequestLogs';

interface ServicePanelProps {
  service: Service | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Get status badge color
 */
function getStatusBadgeColor(status: number): 'green' | 'red' | 'zinc' {
  switch (status) {
    case ServiceStatus.HEALTHY:
      return 'green';
    case ServiceStatus.UNHEALTHY:
      return 'red';
    default:
      return 'zinc';
  }
}

/**
 * Get status label
 */
function getStatusLabel(status: number): string {
  switch (status) {
    case ServiceStatus.HEALTHY:
      return 'Healthy';
    case ServiceStatus.UNHEALTHY:
      return 'Unhealthy';
    case ServiceStatus.UNKNOWN:
      return 'Unknown';
    default:
      return 'Unspecified';
  }
}

/**
 * RequestLogsView - Shows recent HTTP request logs
 */
function RequestLogsView({ serviceName }: { serviceName: string }) {
  const [logLevel, setLogLevel] = useState<'debug' | 'info' | 'warn' | 'error'>('info');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, error } = useRequestLogs({
    serviceName,
    enabled: autoRefresh, // Only poll when auto-refresh is on
    refetchInterval: autoRefresh ? 2000 : false, // Poll every 2s when enabled
    limit: 50, // Show last 50 requests
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3">
          <svg
            className="h-5 w-5 animate-spin text-norn-green"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <Text>Loading request logs...</Text>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-6 py-12 text-center">
        <Text className="text-red-400">Failed to load logs: {error.message}</Text>
      </div>
    );
  }

  if (!data || data.logs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-700 px-6 py-12 text-center">
        <svg
          className="mx-auto h-12 w-12 text-gray-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
          />
        </svg>
        <Text className="mt-4">No requests logged yet</Text>
        <Text className="mt-1 text-xs">
          Request logs will appear here when the service receives HTTP requests
        </Text>
      </div>
    );
  }

  // Format timestamp
  const formatTimestamp = (timestamp: bigint) => {
    const date = new Date(Number(timestamp));
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  // Get status badge color based on HTTP status code
  const getStatusColor = (status: number): 'green' | 'yellow' | 'red' | 'zinc' => {
    if (status >= 200 && status < 300) return 'green';
    if (status >= 300 && status < 400) return 'yellow';
    if (status >= 400 && status < 500) return 'yellow';
    if (status >= 500) return 'red';
    return 'zinc';
  };

  // Filter logs based on selected level (hierarchical)
  // Log level hierarchy: debug < info < warn < error
  const logLevelPriority: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const filteredLogs = data.logs.filter((log) => {
    const logPriority = logLevelPriority[log.level] ?? 0;
    const selectedPriority = logLevelPriority[logLevel] ?? 0;
    // Show logs at the selected level and above
    return logPriority >= selectedPriority;
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <Subheading>Recent Requests</Subheading>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="flex items-center gap-2 rounded-lg border border-gray-700 bg-norn-dark px-3 py-1.5 text-sm text-white transition-colors hover:border-norn-green focus:outline-none focus:ring-1 focus:ring-norn-green"
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
          >
            {autoRefresh ? (
              <>
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>Pause</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                <span>Play</span>
              </>
            )}
          </button>
          <span className="text-sm text-gray-400">Level:</span>
          <select
            value={logLevel}
            onChange={(e) => setLogLevel(e.target.value as 'debug' | 'info' | 'warn' | 'error')}
            className="rounded-lg border border-gray-700 bg-norn-dark px-3 py-1.5 text-sm text-white focus:border-norn-green focus:outline-none focus:ring-1 focus:ring-norn-green"
          >
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>
      <Divider className="my-4" />
      <Table dense striped>
        <TableHead>
          <TableRow>
            <TableHeader>Time</TableHeader>
            <TableHeader>Method</TableHeader>
            <TableHeader>Path</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Duration</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredLogs.slice().reverse().map((log) => (
            <TableRow key={log.sequence.toString()}>
              <TableCell className="font-mono text-xs">{formatTimestamp(log.timestamp)}</TableCell>
              <TableCell>
                <Badge color="zinc">{log.method}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{log.path}</TableCell>
              <TableCell>
                <Badge color={getStatusColor(log.status)}>{log.status}</Badge>
              </TableCell>
              <TableCell className="text-xs">{log.durationMs}ms</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * ResourceDataView - Shows actual data from a resource endpoint
 */
function ResourceDataView({
  serviceAddress,
  resourceName,
  pluralName,
  fields
}: {
  serviceAddress: string;
  resourceName: string;
  pluralName: string;
  fields: Array<{ name: string }>;
}) {
  const { data, isLoading, error } = useResourceData({
    serviceAddress,
    resourceName: pluralName, // Use plural form for endpoint
    enabled: true,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3">
          <svg
            className="h-5 w-5 animate-spin text-norn-green"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <Text>Loading data...</Text>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-6 py-8 text-center">
        <Text className="text-red-400">Failed to load data: {error.message}</Text>
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-6 py-8 text-center">
        <Text className="text-gray-400">No data available</Text>
      </div>
    );
  }

  // Get first 10 rows for preview
  const previewData = data.slice(0, 10);

  return (
    <div>
      <Table dense striped>
        <TableHead>
          <TableRow>
            {fields.map((field) => (
              <TableHeader key={field.name}>{field.name}</TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {previewData.map((row, idx) => (
            <TableRow key={idx}>
              {fields.map((field) => (
                <TableCell key={field.name}>
                  <Text className="text-sm">
                    {row[field.name] !== null && row[field.name] !== undefined
                      ? String(row[field.name])
                      : '—'}
                  </Text>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.length > 10 && (
        <div className="mt-4 text-center">
          <Text className="text-xs text-gray-500">
            Showing 10 of {data.length.toLocaleString()} rows
          </Text>
        </div>
      )}
    </div>
  );
}

/**
 * Sliding panel for service details using Catalyst components
 */
export function ServicePanel({ service, open, onClose }: ServicePanelProps) {
  const { data: resources, isLoading, error } = useServiceResources(service);
  // Track view mode for each resource: 'schema' or 'data'
  const [resourceViews, setResourceViews] = useState<Record<string, 'schema' | 'data'>>({});
  const [selectedTab, setSelectedTab] = useState(0); // Track active tab (0=Overview, 1=Resources, 2=Logs, 3=Metadata)

  if (!service) return null;

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 transition-opacity duration-300 ease-in-out data-[closed]:opacity-0"
      />

      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
            <DialogPanel
              transition
              className="pointer-events-auto w-screen max-w-4xl transform transition duration-300 ease-in-out data-[closed]:translate-x-full"
            >
              <div className="flex h-full flex-col bg-norn-dark shadow-xl">
                {/* Header */}
                <div className="border-b border-gray-800 px-6 py-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <Heading>{service.name}</Heading>
                      <Badge color={getStatusBadgeColor(service.status)}>
                        {getStatusLabel(service.status)}
                      </Badge>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-md text-gray-400 hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-norn-green"
                    >
                      <span className="sr-only">Close panel</span>
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>
                </div>

                {/* Tabbed Content */}
                <div className="flex-1 overflow-y-auto">
                  <TabGroup selectedIndex={selectedTab} onChange={setSelectedTab}>
                    <div className="border-b border-gray-800 px-6">
                      <TabList className="-mb-px flex gap-6">
                        {['Overview', 'Resources', 'Logs', 'Metadata'].map((tab) => (
                          <Tab
                            key={tab}
                            className={({ selected }) =>
                              clsx(
                                'border-b-2 px-1 py-4 text-sm font-medium transition-colors focus:outline-none',
                                selected
                                  ? 'border-norn-green text-norn-green'
                                  : 'border-transparent text-gray-400 hover:border-gray-600 hover:text-gray-300'
                              )
                            }
                          >
                            {tab}
                          </Tab>
                        ))}
                      </TabList>
                    </div>

                    <TabPanels className="px-6 py-6">
                      {/* Overview Tab */}
                      <TabPanel className="focus:outline-none">
                        <div className="space-y-8">
                          {/* Basic Info */}
                          <div>
                            <Subheading>Service Information</Subheading>
                            <Divider className="my-4" />
                            <DescriptionList>
                              <DescriptionTerm>Type</DescriptionTerm>
                              <DescriptionDetails>
                                <Badge color="zinc">{service.type}</Badge>
                              </DescriptionDetails>

                              <DescriptionTerm>Address</DescriptionTerm>
                              <DescriptionDetails>
                                <Code>{service.address}</Code>
                              </DescriptionDetails>

                              {service.nodeName && (
                                <>
                                  <DescriptionTerm>Node</DescriptionTerm>
                                  <DescriptionDetails>{service.nodeName}</DescriptionDetails>
                                </>
                              )}
                            </DescriptionList>
                          </div>

                          {/* Upstreams */}
                          {service.upstreams.length > 0 && (
                            <div>
                              <Subheading>Upstream Dependencies</Subheading>
                              <Divider className="my-4" />
                              <div className="space-y-2">
                                {service.upstreams.map((upstream) => (
                                  <div
                                    key={upstream}
                                    className="flex items-center gap-3 rounded-lg border border-gray-700 bg-norn-darker px-4 py-3"
                                  >
                                    <svg
                                      className="h-5 w-5 text-norn-muted"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      strokeWidth={1.5}
                                      stroke="currentColor"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                                      />
                                    </svg>
                                    <Text className="font-medium">{upstream}</Text>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </TabPanel>

                      {/* Resources Tab */}
                      <TabPanel className="focus:outline-none">
                        <div>
                          <Subheading>Resources</Subheading>
                          <Divider className="my-4" />
                          {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                              <div className="flex items-center gap-3">
                                <svg
                                  className="h-5 w-5 animate-spin text-norn-green"
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  ></circle>
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                  ></path>
                                </svg>
                                <Text>Loading resources...</Text>
                              </div>
                            </div>
                          ) : error ? (
                            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-6 py-12 text-center">
                              <Text className="text-red-400">Failed to load resources: {error.message}</Text>
                            </div>
                          ) : resources && resources.length > 0 ? (
                            <div className="space-y-8">
                              {resources.map((resource) => {
                                const currentView = resourceViews[resource.name] || 'schema';
                                return (
                                <div key={resource.name}>
                                  <div className="mb-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <h3 className="text-lg font-semibold text-white">
                                        {resource.name}
                                      </h3>
                                      <Badge color="zinc">
                                        {resource.rowCount.toLocaleString()} rows
                                      </Badge>
                                    </div>

                                    {/* Schema/Data Toggle */}
                                    <div className="flex gap-1 rounded-lg bg-gray-800 p-1">
                                      <button
                                        onClick={() => setResourceViews(prev => ({ ...prev, [resource.name]: 'schema' }))}
                                        className={clsx(
                                          'rounded px-3 py-1 text-sm font-medium transition-colors',
                                          currentView === 'schema'
                                            ? 'bg-norn-green text-black'
                                            : 'text-gray-400 hover:text-white'
                                        )}
                                      >
                                        Schema
                                      </button>
                                      <button
                                        onClick={() => setResourceViews(prev => ({ ...prev, [resource.name]: 'data' }))}
                                        className={clsx(
                                          'rounded px-3 py-1 text-sm font-medium transition-colors',
                                          currentView === 'data'
                                            ? 'bg-norn-green text-black'
                                            : 'text-gray-400 hover:text-white'
                                        )}
                                      >
                                        Data
                                      </button>
                                    </div>
                                  </div>

                                  {currentView === 'schema' ? (
                                    <Table dense striped>
                                      <TableHead>
                                        <TableRow>
                                          <TableHeader>Field Name</TableHeader>
                                          <TableHeader>Type</TableHeader>
                                          <TableHeader>Constraints</TableHeader>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {resource.fields.map((field) => (
                                          <TableRow key={field.name}>
                                            <TableCell className="font-medium">
                                              <Code>{field.name}</Code>
                                            </TableCell>
                                            <TableCell>
                                              <Badge color="blue">{field.type}</Badge>
                                            </TableCell>
                                            <TableCell>
                                              {field.values && field.values.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                  {field.values.slice(0, 3).map((val) => (
                                                    <Badge key={val} color="zinc">
                                                      {val}
                                                    </Badge>
                                                  ))}
                                                  {field.values.length > 3 && (
                                                    <Badge color="zinc">
                                                      +{field.values.length - 3} more
                                                    </Badge>
                                                  )}
                                                </div>
                                              ) : field.min !== undefined || field.max !== undefined ? (
                                                <Text className="text-xs">
                                                  {field.min !== undefined && `min: ${field.min}`}
                                                  {field.min !== undefined && field.max !== undefined && ', '}
                                                  {field.max !== undefined && `max: ${field.max}`}
                                                </Text>
                                              ) : (
                                                <Text className="text-xs text-gray-500">—</Text>
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  ) : (
                                    <ResourceDataView
                                      serviceAddress={service.address}
                                      resourceName={resource.name}
                                      pluralName={resource.pluralName}
                                      fields={resource.fields}
                                    />
                                  )}
                                </div>
                              );})}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-gray-700 px-6 py-12 text-center">
                              <svg
                                className="mx-auto h-12 w-12 text-gray-600"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.5}
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
                                />
                              </svg>
                              <Text className="mt-4">No resources defined for this service</Text>
                              <Text className="mt-1 text-xs">
                                Resources will appear here when defined in the service configuration
                              </Text>
                            </div>
                          )}
                        </div>
                      </TabPanel>

                      {/* Logs Tab */}
                      <TabPanel className="focus:outline-none">
                        {selectedTab === 2 && <RequestLogsView serviceName={service.name} />}
                      </TabPanel>

                      {/* Metadata Tab */}
                      <TabPanel className="focus:outline-none">
                        <div>
                          <Subheading>Service Tags</Subheading>
                          <Divider className="my-4" />
                          {Object.keys(service.tags).length > 0 ? (
                            <DescriptionList>
                              {Object.entries(service.tags).map(([key, value]) => (
                                <>
                                  <DescriptionTerm key={`${key}-term`}>{key}</DescriptionTerm>
                                  <DescriptionDetails key={`${key}-details`}>
                                    <Code>{value}</Code>
                                  </DescriptionDetails>
                                </>
                              ))}
                            </DescriptionList>
                          ) : (
                            <div className="rounded-lg border border-dashed border-gray-700 px-6 py-12 text-center">
                              <Text>No metadata tags available</Text>
                            </div>
                          )}
                        </div>
                      </TabPanel>
                    </TabPanels>
                  </TabGroup>
                </div>
              </div>
            </DialogPanel>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
