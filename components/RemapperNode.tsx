import React, { memo, useMemo, useEffect } from 'react';
import { Handle, Position, NodeProps, useEdges, useReactFlow, useNodes } from 'reactflow';
import { PSDNodeData, SerializableLayer, TransformedPayload, TransformedLayer } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';

export const RemapperNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const nodes = useNodes();
  
  // Consume data from Store
  const { templateRegistry, resolvedRegistry, registerPayload, unregisterNode } = useProceduralStore();

  // Cleanup
  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // --------------------------------------------------------------------------
  // 1. Resolve Source Data (Content + Source Bounds)
  // --------------------------------------------------------------------------
  const sourceData = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'source-input');
    if (!edge || !edge.sourceHandle) return null;

    const sourceNodeId = edge.source;
    const sourceHandleId = edge.sourceHandle;

    const resolvedData = resolvedRegistry[sourceNodeId];
    if (!resolvedData) return null;

    const context = resolvedData[sourceHandleId];
    if (!context) return null;

    // Find the original LoadPSDNode to ensure the Export node can find the binary data
    const loadPsdNode = nodes.find(n => n.type === 'loadPsd');
    const binarySourceId = loadPsdNode ? loadPsdNode.id : sourceNodeId;

    return {
        sourceNodeId: binarySourceId, 
        containerName: context.container.containerName,
        layers: context.layers,
        originalBounds: context.container.bounds
    };
  }, [edges, id, resolvedRegistry, nodes]);


  // --------------------------------------------------------------------------
  // 2. Resolve Target Data (Destination Bounds)
  // --------------------------------------------------------------------------
  const targetData = useMemo(() => {
     const edge = edges.find(e => e.target === id && e.targetHandle === 'target-input');
     if (!edge || !edge.sourceHandle) return null;

     const sourceNodeId = edge.source;
     
     const template = templateRegistry[sourceNodeId];
     if (!template) return null;

     let containerName = edge.sourceHandle;
     if (containerName.startsWith('slot-bounds-')) {
         containerName = containerName.replace('slot-bounds-', '');
     }

     const container = template.containers.find(c => c.name === containerName);
     
     if (container) {
         return {
             containerName,
             bounds: container.bounds,
             containerDef: container
         };
     }

     return null;
  }, [edges, id, templateRegistry]);


  // --------------------------------------------------------------------------
  // 3. Transformation Math
  // --------------------------------------------------------------------------
  const transformationPayload: TransformedPayload | null = useMemo(() => {
    if (!sourceData || !targetData) return null;
    if (!sourceData.originalBounds || !targetData.bounds) return null;

    const sourceRect = sourceData.originalBounds;
    const targetRect = targetData.bounds;

    const ratioX = targetRect.w / sourceRect.w;
    const ratioY = targetRect.h / sourceRect.h;
    const scale = Math.min(ratioX, ratioY);

    const transformLayers = (layers: SerializableLayer[]): TransformedLayer[] => {
      return layers.map(layer => {
        const relX = (layer.coords.x - sourceRect.x) / sourceRect.w;
        const relY = (layer.coords.y - sourceRect.y) / sourceRect.h;

        const newX = targetRect.x + (relX * targetRect.w);
        const newY = targetRect.y + (relY * targetRect.h);

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

    const transformedLayers = transformLayers(sourceData.layers as SerializableLayer[]);

    return {
      status: 'success',
      sourceNodeId: sourceData.sourceNodeId,
      sourceContainer: sourceData.containerName,
      targetContainer: targetData.containerName,
      layers: transformedLayers,
      scaleFactor: scale,
      metrics: {
        source: { w: sourceRect.w, h: sourceRect.h },
        target: { w: targetRect.w, h: targetRect.h }
      }
    };
  }, [sourceData, targetData]);


  // --------------------------------------------------------------------------
  // 4. Update Node State & Register to Store
  // --------------------------------------------------------------------------
  useEffect(() => {
    // Sync with React Flow Node Data (for visual debugging on node itself if needed)
    let frameId: number;
    const updateNodeData = () => {
        const currentPayload = data.transformedPayload;
        const isDifferent = JSON.stringify(currentPayload) !== JSON.stringify(transformationPayload);

        if (isDifferent) {
            setNodes(nds => nds.map(n => {
                if (n.id === id) {
                    return { ...n, data: { ...n.data, transformedPayload: transformationPayload } };
                }
                return n;
            }));
        }
    };
    frameId = requestAnimationFrame(updateNodeData);

    // Sync with Procedural Store (for Export Node consumption)
    if (transformationPayload) {
        registerPayload(id, transformationPayload);
    }

    return () => {
        if (frameId) cancelAnimationFrame(frameId);
    };
  }, [transformationPayload, id, setNodes, data.transformedPayload, registerPayload]);


  // --------------------------------------------------------------------------
  // 5. Render
  // --------------------------------------------------------------------------
  const isSourceReady = !!sourceData;
  const isTargetReady = !!targetData;
  const isReady = !!transformationPayload;

  return (
    <div className="min-w-[280px] bg-slate-800 rounded-lg shadow-xl border border-indigo-500/50 overflow-hidden font-sans relative">
      
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
        
        {/* Connection Status: Source */}
        <div className="relative flex flex-col space-y-1">
           {/* Handle is offset to left of padding (-12px) minus half handle width (6px) = -18px */}
           <Handle 
            type="target" 
            position={Position.Left} 
            id="source-input" 
            className={`!w-3 !h-3 !border-2 ${isSourceReady ? '!bg-indigo-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
            style={{ top: '50%', left: '-19px', transform: 'translateY(-50%)' }}
            title="Input: Source Content (from Resolver)" 
           />
           <label className="text-[9px] uppercase text-slate-500 font-bold tracking-wider">Source Input</label>
           <div className={`text-xs px-2 py-1.5 rounded border transition-colors ${
             isSourceReady 
               ? 'bg-indigo-900/30 border-indigo-500/30 text-indigo-200' 
               : 'bg-slate-900 border-slate-700 text-slate-500 italic'
           }`}>
             {sourceData ? sourceData.containerName : 'Waiting for Source...'}
           </div>
        </div>

        {/* Connection Status: Target */}
        <div className="relative flex flex-col space-y-1">
           <Handle 
            type="target" 
            position={Position.Left} 
            id="target-input" 
            className={`!w-3 !h-3 !border-2 ${isTargetReady ? '!bg-emerald-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
            style={{ top: '50%', left: '-19px', transform: 'translateY(-50%)' }}
            title="Input: Target Slot (from Target Splitter)" 
           />
           <label className="text-[9px] uppercase text-slate-500 font-bold tracking-wider">Target Slot</label>
           <div className={`text-xs px-2 py-1.5 rounded border transition-colors ${
             isTargetReady 
               ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300' 
               : 'bg-slate-900 border-slate-700 text-slate-500 italic'
           }`}>
             {targetData ? targetData.containerName : 'Waiting for Target...'}
           </div>
        </div>

        {/* Status Message / Metrics */}
        <div className="relative pt-2 border-t border-slate-700/50 min-h-[40px] flex flex-col justify-center">
             <Handle 
                type="source" 
                position={Position.Right} 
                id="remap-output" 
                className={`!w-3 !h-3 !border-2 transition-colors duration-300 ${isReady ? '!bg-emerald-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
                style={{ top: '50%', right: '-19px', transform: 'translateY(-50%)' }}
                title="Output: Transformed Payload" 
            />

           {!isReady ? (
             <div className="flex items-center justify-center space-x-2 py-1">
                <div className="animate-pulse w-2 h-2 rounded-full bg-orange-500"></div>
                <span className="text-[10px] text-orange-300 italic">Waiting for connections...</span>
             </div>
           ) : (
             <div className="bg-emerald-900/20 rounded p-2 border border-emerald-900/50 space-y-1">
               <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-slate-400 font-bold">REMAP READY: {transformationPayload.targetContainer}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-[10px] text-slate-400">Scale Factor</span>
                 <span className="text-xs font-mono font-bold text-emerald-400">
                    {transformationPayload.scaleFactor.toFixed(3)}x
                 </span>
               </div>
               <div className="w-full bg-slate-800 h-1 rounded overflow-hidden mt-1">
                  <div className="h-full bg-indigo-500" style={{ width: `${Math.min(transformationPayload.scaleFactor * 100, 100)}%` }}></div>
               </div>
             </div>
           )}
        </div>

      </div>
    </div>
  );
});