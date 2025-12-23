import React, { memo, useMemo, useCallback, useEffect } from 'react';
import { Handle, Position, NodeProps, useEdges, useNodes, Node, useReactFlow } from 'reactflow';
import { PSDNodeData, SerializableLayer, ContainerContext, TransformedPayload, TransformedLayer } from '../types';

export const RemapperNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const nodes = useNodes();

  // --------------------------------------------------------------------------
  // 1. Resolve Source Context (Content + Source Bounds)
  // --------------------------------------------------------------------------
  // We trace the connection from 'source-input' back through the ContainerResolver
  // to find the original TemplateSplitter (for bounds) and LoadPSD (for layers).
  const sourceContext = useMemo(() => {
    const sourceEdge = edges.find(e => e.target === id && e.targetHandle === 'source-input');
    if (!sourceEdge) return null;

    const resolverNode = nodes.find(n => n.id === sourceEdge.source) as Node<PSDNodeData>;
    if (!resolverNode || resolverNode.type !== 'containerResolver') return null;

    // Identify which channel of the resolver we are connected to (e.g., "source-0")
    const resolverOutputHandle = sourceEdge.sourceHandle; 
    if (!resolverOutputHandle) return null;

    const channelIndex = resolverOutputHandle.replace('source-', '');
    const resolverInputHandle = `target-${channelIndex}`;

    // Find the edge feeding INTO the Resolver at that specific channel
    const inputEdge = edges.find(e => e.target === resolverNode.id && e.targetHandle === resolverInputHandle);
    if (!inputEdge) return null;

    // The handle ID from the TemplateSplitter IS the container name
    const containerName = inputEdge.sourceHandle;
    if (!containerName) return null;

    // Locate Data Sources
    const splitterNode = nodes.find(n => n.id === inputEdge.source) as Node<PSDNodeData>;
    const template = splitterNode?.data?.template;
    const loadPsdNode = nodes.find(n => n.type === 'loadPsd') as Node<PSDNodeData>;
    const designLayers = loadPsdNode?.data?.designLayers;

    if (!template || !designLayers) return null;

    // Resolve Source Container Bounds
    const containerDef = template.containers.find(c => c.name === containerName);
    
    // Resolve Design Layers (Simulating the Resolver Logic here for local context)
    const cleanName = containerName.replace(/^!+/, '').trim();
    const sourceLayerGroup = designLayers.find(l => l.name === cleanName) || 
                             designLayers.find(l => l.name.toLowerCase() === cleanName.toLowerCase());

    if (!containerDef || !sourceLayerGroup) return null;

    return {
      container: containerDef,
      layers: sourceLayerGroup.children || []
    };
  }, [edges, nodes, id]);


  // --------------------------------------------------------------------------
  // 2. Resolve Target Context (Destination Bounds)
  // --------------------------------------------------------------------------
  // We accept a connection from a TargetTemplateNode (or potentially a Splitter)
  // and user selection to determine the specific target slot.
  const targetContext = useMemo(() => {
    const targetEdge = edges.find(e => e.target === id && e.targetHandle === 'target-input');
    if (!targetEdge) return null;

    const targetNode = nodes.find(n => n.id === targetEdge.source) as Node<PSDNodeData>;
    // Support TargetTemplateNode primarily
    const template = targetNode?.data?.template;

    if (!template) return null;

    return {
      nodeId: targetNode.id,
      containers: template.containers
    };
  }, [edges, nodes, id]);

  const selectedTargetName = data.remapperConfig?.targetContainerName;
  
  const activeTargetBounds = useMemo(() => {
    if (!targetContext || !selectedTargetName) return null;
    return targetContext.containers.find(c => c.name === selectedTargetName);
  }, [targetContext, selectedTargetName]);


  // --------------------------------------------------------------------------
  // 3. Transformation Logic (Math)
  // --------------------------------------------------------------------------
  // Only runs when both contexts are fully resolved.
  const transformationResult: TransformedPayload | null = useMemo(() => {
    if (!sourceContext || !activeTargetBounds) return null;

    const sourceRect = sourceContext.container.bounds;
    const targetRect = activeTargetBounds.bounds;

    // 1. Scale Factor (Uniform Fit)
    // Use Math.min to ensure the content fits entirely within the target box
    const ratioX = targetRect.w / sourceRect.w;
    const ratioY = targetRect.h / sourceRect.h;
    const scale = Math.min(ratioX, ratioY);

    // 2. Recursive Layer Transformation
    const transformLayers = (layers: SerializableLayer[]): TransformedLayer[] => {
      return layers.map(layer => {
        // Normalize Position (Relative to Source Container)
        const relX = (layer.coords.x - sourceRect.x) / sourceRect.w;
        const relY = (layer.coords.y - sourceRect.y) / sourceRect.h;

        // Project to Target (Target Origin + (Relative * Target Dimension))
        // Note: We use targetRect dimensions for position to place it correctly in the slot relative space
        const newX = targetRect.x + (relX * targetRect.w);
        const newY = targetRect.y + (relY * targetRect.h);

        // Apply Scale to Dimensions
        const newW = layer.coords.w * scale;
        const newH = layer.coords.h * scale;

        return {
          ...layer,
          coords: { x: newX, y: newY, w: newW, h: newH },
          transform: {
            scaleX: scale,
            scaleY: scale,
            offsetX: newX,
            offsetY: newY
          },
          children: layer.children ? transformLayers(layer.children) : undefined
        };
      });
    };

    const newLayers = transformLayers(sourceContext.layers);

    return {
      status: 'success',
      sourceContainer: sourceContext.container.name,
      targetContainer: activeTargetBounds.name,
      layers: newLayers,
      scaleFactor: scale,
      metrics: {
        source: { w: sourceRect.w, h: sourceRect.h },
        target: { w: targetRect.w, h: targetRect.h }
      }
    };
  }, [sourceContext, activeTargetBounds]);


  // --------------------------------------------------------------------------
  // 4. Update Node State (Side Effect)
  // --------------------------------------------------------------------------
  useEffect(() => {
    // Prevent infinite loops by comparing stringified payload
    if (JSON.stringify(data.transformedPayload) !== JSON.stringify(transformationResult)) {
        setNodes(nds => nds.map(n => {
            if (n.id === id) {
                return { ...n, data: { ...n.data, transformedPayload: transformationResult } };
            }
            return n;
        }));
    }
  }, [transformationResult, id, setNodes, data.transformedPayload]);


  // --------------------------------------------------------------------------
  // 5. Event Handlers
  // --------------------------------------------------------------------------
  const handleTargetSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === id) {
        return {
          ...node,
          data: {
            ...node.data,
            remapperConfig: { ...node.data.remapperConfig, targetContainerName: e.target.value }
          }
        };
      }
      return node;
    }));
  }, [id, setNodes]);


  // --------------------------------------------------------------------------
  // 6. Render
  // --------------------------------------------------------------------------
  const isSourceReady = !!sourceContext;
  const isTargetReady = !!targetContext;
  const isFullyReady = !!transformationResult;

  return (
    <div className="min-w-[280px] bg-slate-800 rounded-lg shadow-xl border border-indigo-500/50 overflow-hidden font-sans">
      
      {/* --- Handles --- */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="source-input" 
        className={`!top-12 !w-3 !h-3 !border-2 ${isSourceReady ? '!bg-indigo-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
        title="Source Content Input" 
      />
      
      <Handle 
        type="target" 
        position={Position.Left} 
        id="target-input" 
        className={`!top-24 !w-3 !h-3 !border-2 ${isTargetReady ? '!bg-emerald-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
        title="Target Slot Definition" 
      />

      <Handle 
        type="source" 
        position={Position.Right} 
        id="payload-output" 
        className={`!bg-indigo-500 !border-2 ${isFullyReady ? '!border-white' : '!border-indigo-800'}`} 
        title="Transformed Payload" 
      />

      {/* --- Header --- */}
      <div className="bg-indigo-900/80 p-2 border-b border-indigo-800 flex items-center justify-between">
         <div className="flex items-center space-x-2">
           <svg className="w-4 h-4 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <span className="text-sm font-semibold text-indigo-100">Procedural Remapper</span>
         </div>
      </div>

      {/* --- Body --- */}
      <div className="p-3 space-y-3">
        
        {/* Source Section */}
        <div className="flex flex-col space-y-1">
          <label className="text-[9px] uppercase text-slate-500 font-bold tracking-wider">Source Content</label>
          <div className={`text-xs px-2 py-1.5 rounded border transition-colors ${
            isSourceReady 
              ? 'bg-indigo-900/30 border-indigo-500/30 text-indigo-200' 
              : 'bg-slate-900 border-slate-700 text-slate-500 italic'
          }`}>
            {sourceContext ? sourceContext.container.name : 'Waiting for connection...'}
          </div>
        </div>

        {/* Target Section */}
        <div className="flex flex-col space-y-1">
          <label className="text-[9px] uppercase text-slate-500 font-bold tracking-wider">Target Slot</label>
          <select 
            disabled={!targetContext}
            value={selectedTargetName || ''}
            onChange={handleTargetSelect}
            className={`w-full text-xs rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed border ${
               isTargetReady ? 'bg-slate-900 border-slate-600 text-slate-200' : 'bg-slate-900 border-slate-700 text-slate-500'
            }`}
          >
            <option value="" disabled>{isTargetReady ? 'Select Destination...' : 'Waiting for connection...'}</option>
            {targetContext?.containers.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Status / Metrics Section */}
        <div className="pt-2 border-t border-slate-700/50">
           {!isSourceReady && (
             <div className="text-xs text-orange-400 flex items-center space-x-1">
               <span className="animate-pulse">●</span>
               <span>Waiting for Source Content...</span>
             </div>
           )}
           {isSourceReady && !isTargetReady && (
             <div className="text-xs text-orange-400 flex items-center space-x-1">
               <span className="animate-pulse">●</span>
               <span>Waiting for Target Slot...</span>
             </div>
           )}
           {isFullyReady && (
             <div className="bg-emerald-900/20 rounded p-2 border border-emerald-900/50 space-y-1">
               <div className="flex justify-between items-center">
                 <span className="text-[10px] text-slate-400 uppercase">Calculated Scale</span>
                 <span className="text-xs font-mono font-bold text-emerald-400">
                    {transformationResult.scaleFactor.toFixed(2)}x
                 </span>
               </div>
               <div className="flex justify-between items-center text-[10px] text-slate-500">
                 <span>{Math.round(transformationResult.metrics.source.w)}px</span>
                 <span className="text-slate-600">➔</span>
                 <span>{Math.round(transformationResult.metrics.target.w)}px</span>
               </div>
             </div>
           )}
        </div>

      </div>
    </div>
  );
});