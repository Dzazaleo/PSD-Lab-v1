import React, { memo, useState, useMemo } from 'react';
import { Handle, Position, NodeProps, useNodes, useEdges, Node } from 'reactflow';
import { PSDNodeData, TransformedLayer, TransformedPayload } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { findLayerByPath, writePsdFile } from '../services/psdService';
import { Layer, Psd } from 'ag-psd';

export const ExportPSDNode = memo(({ id }: NodeProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const edges = useEdges();
  const nodes = useNodes();
  
  // Access global registries for binary data
  const { psdRegistry, templateRegistry } = useProceduralStore();

  // 1. Resolve Connected Target Template
  const targetTemplateNode = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'template-input');
    if (!edge) return null;
    return nodes.find(n => n.id === edge.source) as Node<PSDNodeData>;
  }, [edges, nodes, id]);

  const templateMetadata = targetTemplateNode?.data?.template;

  // 2. Resolve Connected Remapper Payloads
  const activePayloads = useMemo(() => {
    const payloadEdges = edges.filter(e => e.target === id && e.targetHandle === 'assembly-input');
    const payloads: TransformedPayload[] = [];

    payloadEdges.forEach(edge => {
      const sourceNode = nodes.find(n => n.id === edge.source) as Node<PSDNodeData>;
      if (sourceNode?.data?.transformedPayload) {
        payloads.push(sourceNode.data.transformedPayload);
      }
    });

    return payloads;
  }, [edges, nodes, id]);

  // 3. Status Calculation
  const totalSlots = templateMetadata?.containers.length || 0;
  const filledSlots = activePayloads.length;
  const isReady = !!templateMetadata && filledSlots > 0;
  
  // 4. Export Logic
  const handleExport = async () => {
    if (!templateMetadata) return;
    
    setIsExporting(true);
    setExportError(null);

    try {
      // A. Initialize New PSD Structure
      const newPsd: Psd = {
        width: templateMetadata.canvas.width,
        height: templateMetadata.canvas.height,
        children: [],
        canvasState: undefined // Clear source canvas state if any
      };

      // B. Helper to recursively clone and transform layers
      const reconstructHierarchy = (
        transformedLayers: TransformedLayer[], 
        sourcePsd: Psd,
        sourceNodeId: string
      ): Layer[] => {
        const resultLayers: Layer[] = [];

        for (const metaLayer of transformedLayers) {
            // Find original heavy layer
            const originalLayer = findLayerByPath(sourcePsd, metaLayer.id);
            
            if (originalLayer) {
                // Deep Clone (simple JSON way for properties, but need to preserve buffers)
                // We create a new object spreading properties, but handling children recursively
                const newLayer: Layer = {
                    ...originalLayer,
                    top: metaLayer.coords.y,
                    left: metaLayer.coords.x,
                    bottom: metaLayer.coords.y + metaLayer.coords.h,
                    right: metaLayer.coords.x + metaLayer.coords.w,
                    hidden: !metaLayer.isVisible,
                    opacity: metaLayer.opacity * 255, // Convert back to 0-255
                    children: undefined // Will be repopulated if group
                };

                if (metaLayer.type === 'group' && metaLayer.children) {
                    newLayer.children = reconstructHierarchy(metaLayer.children, sourcePsd, sourceNodeId);
                }

                resultLayers.push(newLayer);
            }
        }
        return resultLayers;
      };

      // C. Process each Payload
      const finalChildren: Layer[] = [];

      // Create a Map to group content by container if needed, or just append root groups
      // Currently we just append all resolved groups to the root
      
      for (const payload of activePayloads) {
          const sourcePsd = psdRegistry[payload.sourceNodeId];
          if (!sourcePsd) {
              console.warn(`Source PSD binaries missing for node ${payload.sourceNodeId}`);
              continue;
          }

          const reconstructed = reconstructHierarchy(payload.layers, sourcePsd, payload.sourceNodeId);
          finalChildren.push(...reconstructed);
      }

      newPsd.children = finalChildren;

      // D. Write to File
      await writePsdFile(newPsd, `PROCEDURAL_EXPORT_${Date.now()}.psd`);

    } catch (e: any) {
        console.error("Export Failed:", e);
        setExportError(e.message || "Unknown export error");
    } finally {
        setIsExporting(false);
    }
  };

  return (
    <div className="min-w-[300px] bg-slate-900 rounded-lg shadow-2xl border border-indigo-500 overflow-hidden font-sans">
      
      {/* Inputs */}
      <div className="relative">
         {/* Template Input */}
         <Handle 
           type="target" 
           position={Position.Left} 
           id="template-input" 
           className="!top-4 !bg-emerald-500" 
           title="Target Template Definition"
         />
         {/* Assembly Input (Multi-connect) */}
         <Handle 
           type="target" 
           position={Position.Left} 
           id="assembly-input" 
           className="!top-10 !bg-indigo-500 !h-6 !w-1.5 !rounded-sm" 
           title="Transformed Payloads (Assembly)"
         />
      </div>

      <div className="p-4 flex flex-col items-center text-center space-y-4">
          <div className="flex flex-col items-center">
             <div className="p-3 bg-indigo-500/20 rounded-full mb-2 border border-indigo-500/50">
                 <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                 </svg>
             </div>
             <h3 className="text-sm font-bold text-slate-100">Export PSD</h3>
             <span className="text-[10px] text-slate-400">Synthesize & Download</span>
          </div>

          <div className="w-full space-y-2">
              <div className="flex justify-between text-xs text-slate-400 border-b border-slate-800 pb-1">
                  <span>Template Canvas</span>
                  <span className={templateMetadata ? "text-emerald-400" : "text-slate-600"}>
                      {templateMetadata ? `${templateMetadata.canvas.width}x${templateMetadata.canvas.height}` : "Waiting..."}
                  </span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 border-b border-slate-800 pb-1">
                  <span>Slots Filled</span>
                  <span className={filledSlots > 0 ? "text-emerald-400" : "text-slate-600"}>
                      {filledSlots} / {totalSlots}
                  </span>
              </div>
          </div>

          {exportError && (
              <div className="text-[10px] bg-red-900/40 text-red-200 p-2 rounded border border-red-800/50 w-full text-left">
                  ERROR: {exportError}
              </div>
          )}

          <button
            onClick={handleExport}
            disabled={!isReady || isExporting}
            className={`w-full py-2 px-4 rounded text-xs font-bold uppercase tracking-wider transition-all
                ${isReady && !isExporting
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg' 
                    : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'}
            `}
          >
             {isExporting ? (
                 <span className="flex items-center justify-center space-x-2">
                     <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                     <span>Processing...</span>
                 </span>
             ) : (
                 "Export File"
             )}
          </button>
      </div>
    </div>
  );
});