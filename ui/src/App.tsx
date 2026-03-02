import { useState } from 'react';
import { TopologyGraph } from './components/TopologyGraph';
import { ServicePanel } from './components/ServicePanel';
import { useTopology } from './hooks/useTopology';
import type { Service } from './gen/observer/v1/observer_pb';

function App() {
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const { services, isLoading, error } = useTopology();

  return (
    <div className="min-h-screen bg-norn-darker">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-800 bg-norn-dark px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-norn-green" />
          <h1 className="text-lg font-semibold text-white">Lattice</h1>
          <span className="text-gray-600">|</span>
          <span className="text-sm text-gray-400">Service Mesh Topology</span>
        </div>

        <div className="flex flex-1 items-center justify-end gap-x-4">
          {isLoading ? (
            <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-500 ring-1 ring-inset ring-yellow-500/20">
              Connecting...
            </span>
          ) : error ? (
            <span className="inline-flex items-center rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-500 ring-1 ring-inset ring-red-500/20">
              Disconnected
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-norn-green/10 px-3 py-1 text-xs font-medium text-norn-green ring-1 ring-inset ring-norn-green/20">
              Connected ({services.length} service{services.length !== 1 ? 's' : ''})
            </span>
          )}
        </div>
      </div>

      {/* Page content */}
      <main className="h-[calc(100vh-4rem)]">
          {error ? (
            <div className="flex h-full items-center justify-center px-4 sm:px-6 lg:px-8">
              <div className="text-center">
                <svg
                  className="mx-auto h-12 w-12 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <h3 className="mt-2 text-sm font-semibold text-gray-300">Connection Error</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Failed to connect to Lattice: {error.message}
                </p>
              </div>
            </div>
          ) : (
            <TopologyGraph services={services} onServiceClick={setSelectedService} />
          )}
        </main>

      {/* Service detail panel */}
      <ServicePanel
        service={selectedService}
        open={selectedService !== null}
        onClose={() => setSelectedService(null)}
      />
    </div>
  );
}

export default App;
