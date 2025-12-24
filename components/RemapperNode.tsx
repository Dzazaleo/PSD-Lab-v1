import React, { memo, useState, useMemo, useEffect } from 'react';
import { Handle, Position, NodeProps, useEdges, useReactFlow, useNodes } from 'reactflow';
import { PSDNodeData, SerializableLayer, TransformedPayload, TransformedLayer } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';

interface InstanceData {
  index: number;
  source: {
    ready: boolean;
    name?: string;
    nodeId?: string;
    originalBounds?: any;
    layers?: any[];
  };
  target: {
    ready: boolean;
    name?: string;
    bounds?: any;
  };
  payload: TransformedPayload | null;
}

export const RemapperNode = memo(({ id }: NodeProps<PSDNodeData>) => {
  const [instanceCount, setInstanceCount] = useState<number>(1);
  
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const nodes = useNodes();
  
  // Consume data from Store
  const { templateRegistry, resolvedRegistry, registerPayload, unregisterNode } = useProceduralStore();

  // Cleanup
  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // Compute Data for ALL Instances
  const instances: InstanceData[] = useMemo(() => {
    const result: InstanceData[] = [];

    // Find original LoadPSDNode to ensure the Export node can find the binary data
    const loadPsdNode = nodes.find(n => n.type === 'loadPsd');

    for (let i = 0; i < instanceCount; i++) {
        const sourceHandleId = `source-in-${i}`;
        const targetHandleId = `target-in-${i}`;

        // 1. Resolve Source
        let sourceData: any = { ready: false };
        const sourceEdge = edges.find(e => e.target === id && e.targetHandle === sourceHandleId);
        
        if (sourceEdge && sourceEdge.sourceHandle) {
             const resolvedData = resolvedRegistry[sourceEdge.source];
             if (resolvedData) {
                 const context = resolvedData[sourceEdge.sourceHandle];
                 if (context) {
                    const binarySourceId = loadPsdNode ? loadPsdNode.id : sourceEdge.source;
                    sourceData = {
                        ready: true,
                        name: context.container.containerName,
                        nodeId: binarySourceId,
                        layers: context.layers,
                        originalBounds: context.container.bounds
                    };
                 }
             }
        }

        // 2. Resolve Target
        let targetData: any = { ready: false };
        const targetEdge = edges.find(e => e.target === id && e.targetHandle === targetHandleId);

        if (targetEdge && targetEdge.sourceHandle) {
             const template = templateRegistry[targetEdge.source];
             if (template) {
                 let containerName = targetEdge.sourceHandle;
                 if (containerName.startsWith('slot-bounds-')) {
                     containerName = containerName.replace('slot-bounds-', '');
                 }

                 const container = template.containers.find(c => c.name === containerName);
                 if (container) {
                     targetData = {
                         ready: true,
                         name: containerName,
                         bounds: container.bounds
                     };
                 }
             }
        }

        // 3. Compute Payload
        let payload: TransformedPayload | null = null;
        if (sourceData.ready && targetData.ready) {
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
            
            payload = {
              status: 'success',
              sourceNodeId: sourceData.nodeId,
              sourceContainer: sourceData.name,
              targetContainer: targetData.name,
              layers: transformedLayers,
              scaleFactor: scale,
              metrics: {
                source: { w: sourceRect.w, h: sourceRect.h },
                target: { w: targetRect.w, h: targetRect.h }
              }
            };
        }

        result.push({
            index: i,
            source: sourceData,
            target: targetData,
            payload
        });
    }

    return result;
  }, [instanceCount, edges, id, resolvedRegistry, templateRegistry, nodes]);


  // Sync Payloads to Store
  useEffect(() => {
    instances.forEach(instance => {
        if (instance.payload) {
            registerPayload(id, `result-out-${instance.index}`, instance.payload);
        }
    });
  }, [instances, id, registerPayload]);

  const addInstance = () => setInstanceCount(prev => prev + 1);

  return (
    <div className="min-w-[280px] bg-slate-800 rounded-lg shadow-xl border border-indigo-500/50 overflow-hidden font-sans relative flex flex-col">
      
      {/* Header */}
      <div className="bg-indigo-900/80 p-2 border-b border-indigo-800 flex items-center justify-between shrink-0">
         <div className="flex items-center space-x-2">
           <svg className="w-4 h-4 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <span className="text-sm font-semibold text-indigo-100">Procedural Remapper</span>
         </div>
      </div>

      {/* Instances List */}
      <div className="flex flex-col">
          {instances.map((instance) => (
             <div key={instance.index} className="relative p-3 border-b border-slate-700/50 bg-slate-800 space-y-3 hover:bg-slate-700/20 transition-colors">
                
                {/* Inputs Row */}
                <div className="grid grid-cols-1 gap-3">
                   {/* Source */}
                   <div className="relative flex items-center justify-between">
                      <div className="flex flex-col">
                          <label className="text-[8px] uppercase text-slate-500 font-bold tracking-wider mb-0.5 ml-1">Source Input</label>
                          <div className={`text-xs px-2 py-1 rounded border min-w-[120px] transition-colors ${
                             instance.source.ready 
                               ? 'bg-indigo-900/30 border-indigo-500/30 text-indigo-200' 
                               : 'bg-slate-900 border-slate-700 text-slate-500 italic'
                           }`}>
                             {instance.source.ready ? instance.source.name : 'Waiting...'}
                          </div>
                      </div>
                      <Handle 
                        type="target" 
                        position={Position.Left} 
                        id={`source-in-${instance.index}`} 
                        className={`!w-3 !h-3 !border-2 ${instance.source.ready ? '!bg-indigo-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
                        style={{ top: '65%', left: '-13px' }}
                        title={`Source for Instance ${instance.index}`}
                      />
                   </div>

                   {/* Target */}
                   <div className="relative flex items-center justify-between">
                      <div className="flex flex-col">
                          <label className="text-[8px] uppercase text-slate-500 font-bold tracking-wider mb-0.5 ml-1">Target Slot</label>
                          <div className={`text-xs px-2 py-1 rounded border min-w-[120px] transition-colors ${
                             instance.target.ready 
                               ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300' 
                               : 'bg-slate-900 border-slate-700 text-slate-500 italic'
                           }`}>
                             {instance.target.ready ? instance.target.name : 'Waiting...'}
                          </div>
                      </div>
                      <Handle 
                        type="target" 
                        position={Position.Left} 
                        id={`target-in-${instance.index}`} 
                        className={`!w-3 !h-3 !border-2 ${instance.target.ready ? '!bg-emerald-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
                        style={{ top: '65%', left: '-13px' }}
                        title={`Target for Instance ${instance.index}`}
                      />
                   </div>
                </div>

                {/* Status Bar / Output */}
                <div className="relative mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between">
                   {instance.payload ? (
                       <div className="flex flex-col w-full">
                           <div className="flex justify-between items-center">
                               <span className="text-[10px] text-emerald-400 font-bold tracking-wide">READY</span>
                               <span className="text-[10px] text-slate-400 font-mono">{instance.payload.scaleFactor.toFixed(2)}x Scale</span>
                           </div>
                           <div className="w-full bg-slate-900 h-1 rounded overflow-hidden mt-1">
                              <div className="h-full bg-emerald-500" style={{ width: '100%' }}></div>
                           </div>
                       </div>
                   ) : (
                       <span className="text-[10px] text-slate-500 italic">Waiting for connection...</span>
                   )}
                   
                   <Handle 
                      type="source" 
                      position={Position.Right} 
                      id={`result-out-${instance.index}`} 
                      className={`!w-3 !h-3 !border-2 transition-colors duration-300 ${instance.payload ? '!bg-emerald-500 !border-white' : '!bg-slate-700 !border-slate-500'}`} 
                      style={{ right: '-13px' }}
                      title={`Output Payload ${instance.index}`} 
                   />
                </div>
             </div>
          ))}
      </div>

      <button 
        onClick={addInstance}
        className="w-full py-2 bg-slate-800 hover:bg-slate-700 border-t border-slate-700 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center space-x-1"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-[10px] font-medium uppercase tracking-wider">Add Remap Instance</span>
      </button>

    </div>
  );
});