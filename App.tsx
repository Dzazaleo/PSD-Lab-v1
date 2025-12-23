import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
  ReactFlowProvider,
} from 'reactflow';

import { LoadPSDNode } from './components/LoadPSDNode';
import { TargetTemplateNode } from './components/TargetTemplateNode';
import { TargetSplitterNode } from './components/TargetSplitterNode';
import { DesignInfoNode } from './components/DesignInfoNode';
import { TemplateSplitterNode } from './components/TemplateSplitterNode';
import { ContainerResolverNode } from './components/ContainerResolverNode';
import { PSDNodeData } from './types';

const initialNodes: Node<PSDNodeData>[] = [
  {
    id: 'node-1',
    type: 'loadPsd',
    position: { x: 100, y: 100 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-target-1',
    type: 'targetTemplate',
    position: { x: 100, y: 400 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-2',
    type: 'designInfo',
    position: { x: 500, y: 100 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-3',
    type: 'templateSplitter',
    position: { x: 500, y: 550 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-4',
    type: 'containerResolver',
    position: { x: 900, y: 550 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-5',
    type: 'targetSplitter',
    position: { x: 1300, y: 550 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
];

const initialEdges: Edge[] = [
    { id: 'e1-2', source: 'node-1', target: 'node-2' },
    { id: 'e1-3', source: 'node-1', target: 'node-3' }
];

const App: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => {
      // 1. Validation Logic
      // Resolve source and target nodes to check their types
      const sourceNode = nodes.find((n) => n.id === params.source);
      const targetNode = nodes.find((n) => n.id === params.target);

      if (sourceNode && targetNode) {
        // Target Splitter Validation Rules
        if (targetNode.type === 'targetSplitter') {
          // Check if connecting to the Template Input handle
          if (params.targetHandle === 'template-input') {
             // Constraint: Template Input expects a TargetTemplateNode
             if (sourceNode.type !== 'targetTemplate') {
               console.warn("Invalid Connection: Target Splitter 'Template Input' requires a Target Template source.");
               return;
             }
          } else {
             // Constraint: Dynamic slots expect a ContainerResolverNode (Resolved Content)
             // This prevents raw TemplateMetadata or other types from connecting to slots
             if (sourceNode.type !== 'containerResolver') {
               console.warn("Invalid Connection: Target Splitter 'Content Slots' require a Container Resolver source.");
               return;
             }
          }
        }
      }

      // 2. Apply Connection
      setEdges((eds) => {
        // Logic: Ensure only one edge connects to any given target handle.
        // Intercept connection and remove any existing edge on the specific target handle.
        const targetHandle = params.targetHandle || null;
        
        const cleanEdges = eds.filter((edge) => {
          const edgeTargetHandle = edge.targetHandle || null;
          // Keep the edge if it targets a different node OR a different handle on the same node
          return edge.target !== params.target || edgeTargetHandle !== targetHandle;
        });
        
        return addEdge(params, cleanEdges);
      });
    },
    [nodes, setEdges]
  );

  // Register custom node types
  const nodeTypes = useMemo(() => ({
    loadPsd: LoadPSDNode,
    targetTemplate: TargetTemplateNode,
    targetSplitter: TargetSplitterNode,
    designInfo: DesignInfoNode,
    templateSplitter: TemplateSplitterNode,
    containerResolver: ContainerResolverNode,
  }), []);

  return (
    <div className="w-screen h-screen bg-slate-900">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-slate-900"
        >
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="#334155" />
          <Controls className="bg-slate-800 border-slate-700 fill-slate-200" />
          <MiniMap 
            className="bg-slate-800 border-slate-700" 
            nodeColor="#475569" 
            maskColor="rgba(15, 23, 42, 0.6)"
          />
          
          <div className="absolute top-4 left-4 z-10 pointer-events-none">
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
              PSD Procedural Logic Engine
            </h1>
            <p className="text-slate-400 text-sm">
              Procedural generation graph for Adobe Photoshop files
            </p>
          </div>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
};

export default App;