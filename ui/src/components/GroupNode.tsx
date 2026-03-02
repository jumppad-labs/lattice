import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';

export type GroupNodeData = {
  label: string;
  serviceCount: number;
  [key: string]: unknown;
};

/**
 * Custom react-flow group node for displaying server/host containers
 */
export const GroupNode = memo(({ data, selected }: NodeProps) => {
  const { label, serviceCount } = data as GroupNodeData;

  return (
    <div
      className="relative"
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      {/* Background layer - behind everything */}
      <div
        className={`
          absolute inset-0 rounded-2xl border-dashed transition-all pointer-events-none
          ${selected ? 'border-norn-green/50' : 'border-norn-green/30'}
        `}
        style={{
          zIndex: -1,  // Behind service nodes
          backgroundColor: 'rgba(0, 0, 0, 0.2)',  // 20% opacity black
          border: '1px dashed rgba(56, 186, 115, 0.3)',  // Thin green dashed border
        }}
      />

      {/* Simple header - just text on background */}
      <div
        className="absolute left-4 top-4 flex items-center gap-2"
        style={{ zIndex: 1 }}
      >
        <svg
          className="h-5 w-5 text-norn-green/60"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
          />
        </svg>
        <h3 className="text-base font-semibold text-norn-green/80">{label}</h3>
        <span className="text-sm text-norn-green/50">{serviceCount}</span>
      </div>
    </div>
  );
});

GroupNode.displayName = 'GroupNode';
