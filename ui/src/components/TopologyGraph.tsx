import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  ConnectionLineType,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { ServiceNode, type ServiceNodeData } from './ServiceNode';
import { GroupNode, type GroupNodeData } from './GroupNode';
import type { Service } from '../gen/observer/v1/observer_pb';

const elk = new ELK();

// ELK layout options - layered algorithm optimized for hierarchical service graphs
const elkOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',

  // Generous spacing to prevent overlaps
  'elk.spacing.nodeNode': '100',  // Horizontal spacing between nodes in same layer
  'elk.layered.spacing.nodeNodeBetweenLayers': '200',  // Vertical spacing between layers
  'elk.spacing.edgeNode': '40',  // Space between edges and nodes

  // Center nodes horizontally
  'elk.alignment': 'CENTER',

  // Node placement - BRANDES_KOEPF works better with center alignment
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',

  // Better crossing minimization
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.considerModelOrder.strategy': 'NONE',

  // Layer assignment
  'elk.layered.layering.strategy': 'LONGEST_PATH',

  // Port constraints for cleaner edges
  'elk.layered.unnecessaryBendpoints': 'true',

  // Overall spacing
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
};

interface TopologyGraphProps {
  services: Service[];
  onServiceClick?: (service: Service) => void;
}

/**
 * Convert services to react-flow nodes and edges with grouping by node_name
 */
function servicesToGraph(services: Service[]): {
  nodes: Node[];
  edges: Edge[];
} {
  // Group services by node_name
  const servicesByNode = new Map<string, Service[]>();
  for (const service of services) {
    const nodeName = service.nodeName || 'unknown';
    if (!servicesByNode.has(nodeName)) {
      servicesByNode.set(nodeName, []);
    }
    servicesByNode.get(nodeName)!.push(service);
  }

  const nodes: Node[] = [];
  const groupNodes: Node[] = [];
  const serviceNodes: Node[] = [];

  // Create group nodes for each unique node_name
  for (const [nodeName, nodeServices] of servicesByNode.entries()) {
    // Only create a group if there are multiple services on the same node
    // OR if there are multiple different nodes (to show all groupings)
    if (servicesByNode.size > 1 || nodeServices.length > 1) {
      groupNodes.push({
        id: `group-${nodeName}`,
        type: 'group',
        data: {
          label: nodeName,
          serviceCount: nodeServices.length,
        } as GroupNodeData,
        position: { x: 0, y: 0 }, // Will be set by layout
        style: {
          width: 300,
          height: 200,
        },
      });
    }
  }

  // Create service nodes
  for (const service of services) {
    const nodeName = service.nodeName || 'unknown';
    const shouldGroup = servicesByNode.size > 1 || servicesByNode.get(nodeName)!.length > 1;

    serviceNodes.push({
      id: service.name,
      type: 'service',
      data: { service },
      position: { x: 0, y: 0 }, // Will be set by layout (relative to parent if grouped)
      parentId: shouldGroup ? `group-${nodeName}` : undefined, // Use parentId (parentNode is deprecated)
      extent: shouldGroup ? 'parent' : undefined,
    } as Node);
  }

  // IMPORTANT: Parent nodes must come before child nodes in the array
  nodes.push(...groupNodes, ...serviceNodes);

  // Create edges
  const edges: Edge[] = [];
  for (const service of services) {
    for (const upstream of service.upstreams) {
      edges.push({
        id: `${service.name}-${upstream}`,
        source: service.name,
        target: upstream,
        type: 'default',
        animated: false,
        style: {
          stroke: '#6B8F7A',
          strokeWidth: 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#6B8F7A',
          width: 20,
          height: 20,
        },
      });
    }
  }

  return { nodes, edges };
}

/**
 * Apply ELK automatic layout to nodes with support for hierarchical grouping
 */
async function applyAutoLayout(
  nodes: Node[],
  edges: Edge[]
): Promise<Node[]> {
  // Use flat layout - let react-flow handle parent-child grouping visually
  const serviceNodes = nodes.filter((n) => n.type === 'service');

  // All service nodes at same level for ELK (no hierarchy)
  const elkChildren: ElkNode[] = serviceNodes.map((node) => ({
    id: node.id,
    width: 250,
    height: 90,
  }));

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: elkOptions,
    children: elkChildren,
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  // Run layout algorithm on service nodes only
  const layoutedGraph = await elk.layout(elkGraph);

  // Apply positions from ELK
  const positionedNodes: Node[] = [];

  // First, position all service nodes from ELK layout
  const serviceNodePositions = new Map<string, { x: number; y: number }>();
  if (layoutedGraph.children) {
    for (const elkNode of layoutedGraph.children) {
      const node = nodes.find((n) => n.id === elkNode.id);
      if (node) {
        serviceNodePositions.set(node.id, {
          x: elkNode.x ?? 0,
          y: elkNode.y ?? 0,
        });
      }
    }
  }

  // Now create positioned nodes with parent-relative coordinates
  const groupNodes = nodes.filter((n) => n.type === 'group');
  const serviceNodesAll = nodes.filter((n) => n.type === 'service');

  // Calculate group bounds based on their children
  const groupBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const groupNode of groupNodes) {
    const children = serviceNodesAll.filter((n) => n.parentId === groupNode.id);
    if (children.length > 0) {
      // Find bounding box of all children
      const childPositions = children.map((c) => serviceNodePositions.get(c.id)!);
      const minX = Math.min(...childPositions.map((p) => p.x));
      const minY = Math.min(...childPositions.map((p) => p.y));
      const maxX = Math.max(...childPositions.map((p) => p.x + 250)); // 250 = node width
      const maxY = Math.max(...childPositions.map((p) => p.y + 90));  // 90 = node height

      const padding = { top: 120, left: 50, bottom: 50, right: 50 };
      groupBounds.set(groupNode.id, {
        x: minX - padding.left,
        y: minY - padding.top,
        width: (maxX - minX) + padding.left + padding.right,
        height: (maxY - minY) + padding.top + padding.bottom,
      });
    }
  }

  // Add positioned group nodes
  for (const groupNode of groupNodes) {
    const bounds = groupBounds.get(groupNode.id);
    if (bounds) {
      positionedNodes.push({
        ...groupNode,
        position: { x: bounds.x, y: bounds.y },
        style: {
          width: bounds.width,
          height: bounds.height,
        },
      });
    }
  }

  // Add positioned service nodes (with parent-relative coordinates)
  for (const serviceNode of serviceNodesAll) {
    const absolutePos = serviceNodePositions.get(serviceNode.id);
    if (absolutePos) {
      let position = absolutePos;

      // If it has a parent, make position relative to parent
      if (serviceNode.parentId) {
        const parentBounds = groupBounds.get(serviceNode.parentId);
        if (parentBounds) {
          position = {
            x: absolutePos.x - parentBounds.x,
            y: absolutePos.y - parentBounds.y,
          };
        }
      }

      positionedNodes.push({
        ...serviceNode,
        position,
      });
    }
  }

  // Center the graph horizontally
  if (positionedNodes.length > 0) {
    const topLevelNodes = positionedNodes.filter((n) => !n.parentId);
    if (topLevelNodes.length > 0) {
      const minX = Math.min(...topLevelNodes.map((n) => n.position.x));
      const centerOffset = -minX;

      return positionedNodes.map((node) => ({
        ...node,
        position: {
          x: node.parentId ? node.position.x : node.position.x + centerOffset,
          y: node.position.y,
        },
      }));
    }
  }

  return positionedNodes;
}

/**
 * Topology visualization component using react-flow
 */
export function TopologyGraph({ services, onServiceClick }: TopologyGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLayouting, setIsLayouting] = useState(false);

  // Custom node types
  const nodeTypes = useMemo(
    () => ({
      service: ServiceNode,
      group: GroupNode,
    }),
    []
  );

  // Update graph when services change
  useEffect(() => {
    if (services.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    async function updateGraph() {
      setIsLayouting(true);
      const { nodes: newNodes, edges: newEdges } = servicesToGraph(services);
      const layoutedNodes = await applyAutoLayout(newNodes, newEdges);
      setNodes(layoutedNodes);
      setEdges(newEdges);
      setIsLayouting(false);
    }

    updateGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);

  // Handle node clicks
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const nodeData = node.data as ServiceNodeData;
      if (onServiceClick && nodeData.service) {
        onServiceClick(nodeData.service);
      }
    },
    [onServiceClick]
  );

  if (services.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-semibold text-gray-300">No services</h3>
          <p className="mt-1 text-sm text-gray-500">
            Start Loki services to see them appear in the topology graph.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <style>
        {`
          .react-flow__node-group {
            border: none !important;
            border-radius: 0 !important;
            background: transparent !important;
            padding: 0 !important;
          }
          /* Keep group wrapper at normal z-index so it can be dragged */
          /* The inner div will have z-index: -1 to stay behind children */
        `}
      </style>
      {isLayouting && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg bg-norn-dark/90 px-4 py-2 text-sm text-gray-300 shadow-lg">
          Calculating layout...
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.Bezier}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 1.5 }}
        minZoom={0.1}
        maxZoom={2}
        panOnScroll
        selectionOnDrag
        elevateNodesOnSelect={false}
        className="bg-norn-darker"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1D5E3B" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
