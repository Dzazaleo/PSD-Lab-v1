import React, { memo, useMemo, useCallback } from 'react';
import { Handle, Position, NodeProps, useEdges, useNodes, Node, useReactFlow } from 'reactflow';
import { PSDNodeData, SerializableLayer, ContainerContext, TransformedPayload, TransformedLayer } from '../types';

export const RemapperNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const nodes = useNodes();

  // 1. Get Source Data (Container Context & Layers) from Resolver
  const sourceEdge = edges.find(e => e.target === id && e.targetHandle === 'source-input');
  const sourceNode = nodes.find(n => n.id === sourceEdge?.source) as Node<PSDNodeData>;
  
  // Infer source context from the edge and upstream nodes
  const derivedSourceContext = useMemo(() => {
    if (!sourceEdge || !sourceNode) return null;
    
    // Find which input handle on the Resolver corresponds to the output handle connected to us.
    const resolverOutputHandle = sourceEdge.sourceHandle; // e.g., "source-0"
    if (!resolverOutputHandle) return null;
    
    const index = resolverOutputHandle.replace('source-', '');
    const resolverInputHandle = `target-${index}`;
    
    // Find edge feeding INTO the Resolver at that index
    const inputEdge = edges.find(e => e.target === sourceNode.id && e.targetHandle === resolverInputHandle);
    if (!inputEdge) return null;
    
    // The source handle of that edge IS the container name (from TemplateSplitter)
    const containerName = inputEdge.sourceHandle;
    if (!containerName) return null;

    // Now find the TemplateSplitter to get the Template Metadata
    const splitterNode = nodes.find(n => n.id === inputEdge.source) as Node<PSDNodeData>;
    const template = splitterNode?.data?.template;
    
    // And the LoadPSDNode for Design Layers
    const loadPsdNode = nodes.find(n => n.type === 'loadPsd') as Node<PSDNodeData>;
    const designLayers = loadPsdNode?.data?.designLayers;
    
    if (!template || !designLayers) return null;

    // Re-resolve the specific group
    const cleanName = containerName.replace(/^!+/, '').trim();
    // Simple strict match for now, mimicking Resolver
    const sourceLayerGroup = designLayers.find(l => l.name === cleanName) || 
                             designLayers.find(l => l.name.toLowerCase() === cleanName.toLowerCase());

    const containerDef = template.containers.find(c => c.name === containerName);

    if (!containerDef || !sourceLayerGroup) return null;

    return {
      container: containerDef,
      layers: sourceLayerGroup.children || []
    };
  }, [edges, nodes, sourceEdge, sourceNode]);


  // 2. Get Target Template
  const templateEdge = edges.find(e => e.target === id && e.targetHandle === 'template-input');
  const templateNode = nodes.find(n => n.id === templateEdge?.source) as Node<PSDNodeData>;
  const targetTemplate = templateNode?.data?.template;

  // 3. Handle Target Selection
  const selectedTargetId = data.remapperConfig?.targetContainerName;
  
  const handleContainerSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
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


  // 4. Perform Transformation Logic
  const transformationResult: TransformedPayload | null = useMemo(() => {
    if (!derivedSourceContext || !targetTemplate || !selectedTargetId) {
      return null;
    }

    const sourceContainer = derivedSourceContext.container.bounds;
    const targetContainerDef = targetTemplate.containers.find(c => c.name === selectedTargetId);

    if (!targetContainerDef) return null;
    const targetContainer = targetContainerDef.bounds;

    // Calculate Ratios
    // ratioX = target.width / source.width
    const ratioX = targetContainer.w / sourceContainer.w;
    const ratioY = targetContainer.h / sourceContainer.h;
    
    // Uniform Fit
    const scale = Math.min(ratioX, ratioY);

    // Recursive transformation function
    const transformLayers = (layers: SerializableLayer[]): TransformedLayer[] => {
      return layers.map(layer => {
        // Coordinate Normalization & Transformation
        // relX = (layer.left - source.left) / source.width
        const relX = (layer.coords.x - sourceContainer.x) / sourceContainer.w;
        const relY = (layer.coords.y - sourceContainer.y) / sourceContainer.h;

        // Target Translation (Relative Position + Stretch)
        // newLeft = target.left + (relX * target.width)
        const newX = targetContainer.x + (relX * targetContainer.w);
        const newY = targetContainer.y + (relY * targetContainer.h);

        // Dimensions (Uniform Scale)
        const newW = layer.coords.w * scale;
        const newH = layer.coords.h * scale;

        const transformedLayer: TransformedLayer = {
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

        return transformedLayer;
      });
    };

    const newLayers = transformLayers(derivedSourceContext.layers);

    return {
      status: 'success',
      sourceContainer: derivedSourceContext.container.name,
      targetContainer: targetContainerDef.name,
      layers: newLayers,
      scaleFactor: scale,
      metrics: {
        source: { w: sourceContainer.w, h: sourceContainer.h },
        target: { w: targetContainer.w, h: targetContainer.h }
      }
    };
  }, [derivedSourceContext, targetTemplate, selectedTargetId]);


  // 5. Update Output Data (Effect)
  React.useEffect(() => {
    // Basic check to prevent infinite loop (JSON stringify is cheap for this size usually)
    if (JSON.stringify(data.transformedPayload) !== JSON.stringify(transformationResult)) {
        setNodes(nds => nds.map(n => {
            if (n.id === id) {
                return { ...n, data: { ...n.data, transformedPayload: transformationResult } };
            }
            return n;
        }));
    }
  }, [transformationResult, id, setNodes, data.transformedPayload]);


  return (
    <div className="min-w-[260px] bg-slate-800 rounded-lg shadow-xl border border-indigo-500/50 overflow-hidden font-sans">
      {/* Inputs */}
      <Handle type="target" position={Position.Left} id="source-input" className="!top-10 !bg-indigo-500 !border-2 !border-slate-800" title="Source Layer Context" />
      <Handle type="target" position={Position.Left} id="template-input" className="!top-24 !bg-emerald-500 !border-2 !border-slate-800" title="Target Template" />

      {/* Header */}
      <div className="bg-indigo-900/80 p-2 border-b border-indigo-800 flex items-center justify-between">
         <div className="flex items-center space-x-2">
           <svg className="w-4 h-4 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <span className="text-sm font-semibold text-indigo-100">Procedural Remapper</span>
         </div>
         <span className="text-[9px] bg-indigo-950 text-indigo-300 px-1 rounded">MATH</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Source Status */}
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] uppercase text-slate-500 font-bold">Source Context</label>
          <div className={`text-xs px-2 py-1.5 rounded border ${derivedSourceContext ? 'bg-slate-900 border-slate-700 text-indigo-300' : 'bg-red-900/20 border-red-900/50 text-red-400 italic'}`}>
            {derivedSourceContext ? derivedSourceContext.container.name : 'Waiting for Resolver...'}
          </div>
        </div>

        {/* Target Selector */}
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] uppercase text-slate-500 font-bold">Target Mapping</label>
          <select 
            disabled={!targetTemplate}
            value={selectedTargetId || ''}
            onChange={handleContainerSelect}
            className="w-full bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          >
            <option value="" disabled>Select Slot...</option>
            {targetTemplate?.containers.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          {!targetTemplate && <span className="text-[9px] text-orange-400/80 italic px-1">Connect Target Template</span>}
        </div>

        {/* Transformation Metrics */}
        {transformationResult && (
          <div className="bg-slate-900/50 rounded p-2 border border-slate-700/50 space-y-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-slate-400">Scale Factor:</span>
              <span className="font-mono text-emerald-400">{(transformationResult.scaleFactor * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-slate-400">Resolution:</span>
              <span className="font-mono text-slate-300">
                {Math.round(transformationResult.metrics.source.w)}px &rarr; {Math.round(transformationResult.metrics.target.w)}px
              </span>
            </div>
            <div className="w-full bg-slate-800 h-1 rounded overflow-hidden mt-1">
              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(transformationResult.scaleFactor * 100, 100)}%` }}></div>
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="payload-output" className="!bg-indigo-500 !border-2 !border-white" title="Transformed Payload" />
    </div>
  );
});