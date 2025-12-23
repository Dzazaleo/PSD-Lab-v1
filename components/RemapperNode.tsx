import React, { memo, useMemo, useEffect } from 'react';
import { Handle, Position, NodeProps, useEdges, useNodes, Node, useReactFlow } from 'reactflow';
import { PSDNodeData, SerializableLayer, TransformedPayload, TransformedLayer, ContainerDefinition } from '../types';

export const RemapperNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const nodes = useNodes();

  // --------------------------------------------------------------------------
  // 1. Resolve Source Context (Content + Source Bounds)
  // --------------------------------------------------------------------------
  // Traces connection from 'source-input' back through ContainerResolver
  const sourceContext = useMemo(() => {
    const sourceEdge = edges.find(e => e.target === id && e.targetHandle === 'source-input');
    if (!sourceEdge) return null;

    const resolverNode = nodes.find(n => n.id === sourceEdge.source) as Node<PSDNodeData>;
    if (!resolverNode) return null;

    // Identify resolver channel
    const resolverOutputHandle = sourceEdge.sourceHandle; 
    if (!resolverOutputHandle) return null;

    const channelIndex = resolverOutputHandle.replace('source-', '');
    const resolverInputHandle = `target-${channelIndex}`;

    // Trace back to TemplateSplitter to find the container name
    const inputEdge = edges.find(e => e.target === resolverNode.id && e.targetHandle === resolverInputHandle);
    if (!inputEdge) return null;

    const containerName = inputEdge.sourceHandle;
    if (!containerName) return null;

    // Locate Data Sources
    const splitterNode = nodes.find(n => n.id === inputEdge.source) as Node<PSDNodeData>;
    const template = splitterNode?.data?.template;
    const loadPsdNode = nodes.find(n => n.type === 'loadPsd') as Node<PSDNodeData>;
    const designLayers = loadPsdNode?.data?.designLayers;

    if (!template || !designLayers) return null;

    // Resolve Source Container & Layers
    const containerDef = template.containers.find(c => c.name === containerName);
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
  // Checks 'target-input' for a specific slot connection from TargetSplitter
  const targetContext = useMemo(() => {
    const targetEdge = edges.find(e => e.target === id && e.targetHandle === 'target-input');
    if (!targetEdge) return null;

    const sourceNode = nodes.find(n => n.id === targetEdge.source) as Node<PSDNodeData>;
    const template = sourceNode?.data?.template;
    
    if (!sourceNode || !template) return null;

    const handleId = targetEdge.sourceHandle || '';

    // CASE A: Connected to a specific slot (e.g. "slot-bounds-!!SYMBOLS")
    if (handleId.startsWith('slot-bounds-')) {
        const containerName = handleId.replace('slot-bounds-', '');
        const specificContainer = template.containers.find(c => c.name === containerName);
        if (specificContainer) {
            return {
                mode: 'LOCKED',
                container: specificContainer
            };
        }
    }

    // CASE B: Fallback (Legacy or Direct Template connection)
    // We default to the first container or require selection if we supported it, 
    // but strict logic suggests we simply return null or the first found if ambiguous.
    // For this strict procedural engine, we expect specific wiring.
    return {
        mode: 'INVALID',
        container: null
    };

  }, [edges, nodes, id]);


  // --------------------------------------------------------------------------
  // 3. Transformation Logic
  // --------------------------------------------------------------------------
  const transformationResult: TransformedPayload | null = useMemo(() => {
    // Strict Check: Both inputs must be valid
    if (!sourceContext || !targetContext || !targetContext.container) return null;

    const sourceRect = sourceContext.container.bounds;
    const targetRect = targetContext.container.bounds;

    // Calculate Uniform Fit Scale
    const ratioX = targetRect.w / sourceRect.w;
    const ratioY = targetRect.h / sourceRect.h;
    const scale = Math.min(ratioX, ratioY);

    // Transform Layers
    const transformLayers = (layers: SerializableLayer[]): TransformedLayer[] => {
      return layers.map(layer => {
        // Normalize
        const relX = (layer.coords.x - sourceRect.x) / sourceRect.w;
        const relY = (layer.coords.y - sourceRect.y) / sourceRect.h;

        // Project
        const newX = targetRect.x + (relX * targetRect.w);
        const newY = targetRect.y + (relY * targetRect.h);

        // Scale
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
      targetContainer: targetContext.container.name,
      layers: newLayers,
      scaleFactor: scale,
      metrics: {
        source: { w: sourceRect.w, h: sourceRect.h },
        target: { w: targetRect.w, h: targetRect.h }
      }
    };
  }, [sourceContext, targetContext]);


  // --------------------------------------------------------------------------
  // 4. Update Node State
  // --------------------------------------------------------------------------
  useEffect(() => {
    // Only update if payload changed
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
  // 5. Render
  // --------------------------------------------------------------------------
  const isSourceReady = !!sourceContext;
  const isTargetReady = targetContext?.mode === 'LOCKED' && !!targetContext.container;
  const isReady = isSourceReady && isTargetReady && !!transformationResult;

  return (
    <div className="min-w-[280px] bg-slate-800 rounded-lg shadow-xl border border-indigo-500/50 overflow-hidden font-sans">
      
      {/* Inputs */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="source-input" 
        className={`!top-10 !w-3 !h-3 !border-2 ${isSourceReady ? '!bg-indigo-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
        title="Input: Source Content Layers" 
      />
      
      <Handle 
        type="target" 
        position={Position.Left} 
        id="target-input" 
        className={`!top-20 !w-3 !h-3 !border-2 ${isTargetReady ? '!bg-emerald-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
        title="Input: Target Slot Definition" 
      />

      {/* Output */}
      <Handle 
        type="source" 
        position={Position.Right} 
        id="payload-output" 
        className={`!bg-indigo-500 !border-2 ${isReady ? '!border-white' : '!border-indigo-800'}`} 
        title="Output: Transformed Payload" 
      />

      {/* Header */}
      <div className="bg-indigo-900/80 p-2 border-b border-indigo-800 flex items-center justify-between">
         <div className="flex items-center space-x-2">
           <svg className="w-4 h-4 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <span className="text-sm font-semibold text-indigo-100">Procedural Remapper</span>
         </div>
         {isReady && <span className="text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded font-bold">READY</span>}
      </div>

      {/* Body */}
      <div className="p-3 space-y-3">
        
        {/* Source Status */}
        <div className="flex flex-col space-y-1">
           <div className="flex justify-between items-center">
             <label className="text-[9px] uppercase text-slate-500 font-bold tracking-wider">Source Content</label>
           </div>
           <div className={`text-xs px-2 py-1.5 rounded border ${isSourceReady ? 'bg-indigo-900/30 border-indigo-500/30 text-indigo-200' : 'bg-slate-900 border-slate-700 text-slate-500 italic'}`}>
             {sourceContext ? sourceContext.container.name : 'Waiting for Layers...'}
           </div>
        </div>

        {/* Target Status */}
        <div className="flex flex-col space-y-1">
           <label className="text-[9px] uppercase text-slate-500 font-bold tracking-wider">Target Slot</label>
           <div className={`text-xs px-2 py-1.5 rounded border ${isTargetReady ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-700 text-slate-500 italic'}`}>
             {targetContext?.container ? `Slot: ${targetContext.container.name}` : 'Waiting for Slot...'}
           </div>
        </div>

        {/* Transformation Metrics */}
        {transformationResult ? (
          <div className="bg-slate-900/50 rounded p-2 border border-slate-700/50 space-y-1 mt-2">
            <div className="flex justify-between items-center text-[10px] mb-1">
               <span className="text-slate-400">Remapping Operation:</span>
               <span className="font-bold text-indigo-300">{transformationResult.sourceContainer} &rarr; {transformationResult.targetContainer}</span>
            </div>
            <div className="w-full bg-slate-800 h-1 rounded overflow-hidden">
               <div className="h-full bg-emerald-500" style={{ width: `${Math.min(transformationResult.scaleFactor * 100, 100)}%` }}></div>
            </div>
            <div className="flex justify-between items-center text-[9px] text-slate-500 pt-1">
               <span>Scale: {transformationResult.scaleFactor.toFixed(2)}x</span>
               <span>{Math.round(transformationResult.metrics.target.w)} x {Math.round(transformationResult.metrics.target.h)} px</span>
            </div>
          </div>
        ) : (
          (isSourceReady && isTargetReady) && (
            <div className="text-[10px] text-red-400 italic text-center pt-2">
              Error calculating transformation.
            </div>
          )
        )}

      </div>
    </div>
  );
});