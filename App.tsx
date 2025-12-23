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
import { PSDNodeData } from './types';

const initialNodes: Node<PSDNodeData>[] = [
  {
    id: 'node-1',
    type: 'loadPsd',
    position: { x: 100, y: 100 },
    data: { fileName: null, psd: null },
  },
];

const App: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // Register custom node types
  const nodeTypes = useMemo(() => ({
    loadPsd: LoadPSDNode,
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