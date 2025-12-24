import React, { memo, useState, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps, useEdges, useNodes, Node } from 'reactflow';
import { PSDNodeData, MappingContext, TemplateMetadata, LayoutStrategy, SerializableLayer, MAX_BOUNDARY_VIOLATION_PERCENT } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { GoogleGenAI, Type, SchemaType } from "@google/genai";

export const DesignAnalystNode = memo(({ id }: NodeProps<PSDNodeData>) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [strategy, setStrategy] = useState<LayoutStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const edges = useEdges();
  const nodes = useNodes();
  
  const { resolvedRegistry, templateRegistry, registerResolved, registerTemplate, registerAnalysis, unregisterNode } = useProceduralStore();

  // 1. Upstream Data Retrieval
  const sourceData = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'source-in');
    if (!edge || !edge.sourceHandle) return null;
    const registry = resolvedRegistry[edge.source];
    return registry ? registry[edge.sourceHandle] : null;
  }, [edges, id, resolvedRegistry]);

  const targetData = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'target-in');
    if (!edge) return null;
    
    const template = templateRegistry[edge.source];
    if (!template) return null;

    let containerName = edge.sourceHandle;
    if (containerName?.startsWith('slot-bounds-')) {
        containerName = containerName.replace('slot-bounds-', '');
    }

    return template.containers.find(c => c.name === containerName);
  }, [edges, id, templateRegistry]);

  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // 2. Pass-Through Data Registration
  useEffect(() => {
    if (sourceData) {
        registerResolved(id, 'source-out', sourceData);
    }
    if (targetData) {
        const syntheticTemplate: TemplateMetadata = {
            canvas: { width: 1000, height: 1000 },
            containers: [targetData]
        };
        registerTemplate(id, syntheticTemplate);
    }
  }, [id, sourceData, targetData, registerResolved, registerTemplate]);

  // 3. AI Analysis Logic
  const handleAnalyze = async () => {
    if (!sourceData || !targetData) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("API_KEY not set");

      const ai = new GoogleGenAI({ apiKey });

      const sourceW = sourceData.container.bounds.w;
      const sourceH = sourceData.container.bounds.h;
      const targetW = targetData.bounds.w;
      const targetH = targetData.bounds.h;

      // Deep recursion to flatten hierarchy for the AI to see all movable parts
      const flattenLayers = (layers: SerializableLayer[], depth = 0): any[] => {
          let flat: any[] = [];
          layers.forEach(l => {
              flat.push({
                  id: l.id,
                  name: l.name,
                  type: l.type,
                  depth: depth,
                  // Relative dimensions to the source container
                  relX: (l.coords.x - sourceData.container.bounds.x) / sourceW,
                  relY: (l.coords.y - sourceData.container.bounds.y) / sourceH,
                  relW: l.coords.w / sourceW,
                  relH: l.coords.h / sourceH
              });
              if (l.children) {
                  flat = flat.concat(flattenLayers(l.children, depth + 1));
              }
          });
          return flat;
      };

      const layerAnalysisData = flattenLayers(sourceData.layers as SerializableLayer[]);

      const prompt = `
        ROLE: Senior PSD Compositor & Layout Automation Engine.
        GOAL: Perform "Geometry-First Semantic Recomposition". Map source layers into the target slot.

        CONTEXT:
        - Source Container Aspect Ratio: ${(sourceW / sourceH).toFixed(2)}
        - Target Slot Aspect Ratio: ${(targetW / targetH).toFixed(2)}
        - Allowable Boundary Bleed: ${MAX_BOUNDARY_VIOLATION_PERCENT * 100}%
        
        LAYER HIERARCHY (JSON):
        ${JSON.stringify(layerAnalysisData.slice(0, 15))} ... (truncated if long)

        INSTRUCTIONS:
        1. INTELLIGENCE PRIORITY:
           - Analyze Internal Hierarchy: Do not just scale the parent group. Look at the sub-layers.
           - Recomposition: If Target is TALLER than Source, identify "floating" elements (Logos, Titles, Buttons) that can be moved vertically to fill space.
           - Fidelity Preservation: Do NOT suggest generative fill if moving existing layers solves the layout.
        
        2. LOGIC:
           - "Background" layers (large area, low depth) should usually scale to fill (COVER).
           - "UI/Text" layers should be anchored (Top-Left, Bottom-Center, etc.) and receive 'individualScale' adjustments if needed.
           - Calculate 'xOffset' and 'yOffset' in PIXELS relative to the new scaled position.
        
        3. OUTPUT SCHEMA:
           - suggestedScale: Global scale for the root group.
           - anchor: Global anchor.
           - overrides: Array of adjustments for specific layer IDs to break them out of the global transform.
           - safetyReport: Verify if your suggestions keep critical content within bounds.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    suggestedScale: { type: Type.NUMBER, description: "Base scale factor for the entire group." },
                    anchor: { type: Type.STRING, enum: ['TOP', 'CENTER', 'BOTTOM', 'STRETCH'] },
                    generativePrompt: { type: Type.STRING },
                    reasoning: { type: Type.STRING },
                    overrides: {
                        type: Type.ARRAY,
                        description: "Specific adjustments for sub-layers to recompose the layout.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                layerId: { type: Type.STRING },
                                xOffset: { type: Type.NUMBER, description: "Horizontal shift in pixels" },
                                yOffset: { type: Type.NUMBER, description: "Vertical shift in pixels" },
                                individualScale: { type: Type.NUMBER, description: "Layer specific scale multiplier (usually 1.0)" }
                            },
                            required: ['layerId', 'xOffset', 'yOffset', 'individualScale']
                        }
                    },
                    safetyReport: {
                        type: Type.OBJECT,
                        properties: {
                            allowedBleed: { type: Type.BOOLEAN },
                            violationCount: { type: Type.INTEGER }
                        },
                        required: ['allowedBleed', 'violationCount']
                    }
                },
                required: ['suggestedScale', 'anchor', 'generativePrompt', 'reasoning', 'overrides', 'safetyReport']
            }
        }
      });

      const json = JSON.parse(response.text || '{}');
      setStrategy(json);
      registerAnalysis(id, json);

    } catch (e: any) {
        console.error("Gemini Analysis Failed:", e);
        setError(e.message || "AI Analysis Failed");
    } finally {
        setIsAnalyzing(false);
    }
  };

  const getPreviewStyle = (w: number, h: number, color: string) => {
     const maxDim = 60;
     const ratio = w / h;
     let styleW = maxDim;
     let styleH = maxDim;
     
     if (ratio > 1) { styleH = maxDim / ratio; }
     else { styleW = maxDim * ratio; }

     return {
         width: `${styleW}px`,
         height: `${styleH}px`,
         borderColor: color
     };
  };

  const isReady = !!sourceData && !!targetData;
  const overrideCount = strategy?.overrides?.length || 0;

  return (
    <div className="w-80 bg-slate-900 rounded-lg shadow-2xl border border-pink-500/50 overflow-hidden font-sans flex flex-col">
      {/* Inputs */}
      <Handle type="target" position={Position.Top} id="source-in" className="!bg-indigo-500" style={{ left: '30%' }} title="Source Context" />
      <Handle type="target" position={Position.Top} id="target-in" className="!bg-emerald-500" style={{ left: '70%' }} title="Target Slot" />

      {/* Header */}
      <div className="bg-pink-900/30 p-2 border-b border-pink-800/50 flex items-center justify-between">
         <div className="flex items-center space-x-2">
           <svg className="w-4 h-4 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <span className="text-sm font-bold text-pink-100">Design Analyst</span>
         </div>
         <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-500 text-white font-mono">GEMINI</span>
      </div>

      <div className="p-3 space-y-3">
         {/* Ghost Preview */}
         <div className="flex items-center justify-around bg-slate-800/50 p-2 rounded border border-slate-700">
             <div className="flex flex-col items-center space-y-1">
                 <span className="text-[9px] text-slate-400 uppercase">Source</span>
                 <div className="border-2 border-dashed flex items-center justify-center bg-indigo-500/10" 
                      style={sourceData ? getPreviewStyle(sourceData.container.bounds.w, sourceData.container.bounds.h, '#6366f1') : { width: 40, height: 40, borderColor: '#334155' }}>
                 </div>
             </div>
             <div className="text-slate-600">→</div>
             <div className="flex flex-col items-center space-y-1">
                 <span className="text-[9px] text-slate-400 uppercase">Target</span>
                 <div className="border-2 border-dashed flex items-center justify-center bg-emerald-500/10" 
                      style={targetData ? getPreviewStyle(targetData.bounds.w, targetData.bounds.h, '#10b981') : { width: 40, height: 40, borderColor: '#334155' }}>
                 </div>
             </div>
         </div>

         {/* Strategy Card */}
         {strategy && (
             <div className="bg-slate-800 border-l-2 border-pink-500 p-2 rounded text-[10px] space-y-2 animate-fadeIn">
                 <div className="flex justify-between border-b border-slate-700 pb-1">
                    <span className="text-pink-300 font-bold">SEMANTIC RECOMPOSITION</span>
                    <span className="text-slate-400">{strategy.anchor}</span>
                 </div>
                 
                 <div className="grid grid-cols-2 gap-2 mt-1">
                    <div>
                        <span className="block text-slate-500">Global Scale</span>
                        <span className="text-slate-200 font-mono">{strategy.suggestedScale.toFixed(3)}x</span>
                    </div>
                    <div>
                        <span className="block text-slate-500">Overrides</span>
                        <span className={`${overrideCount > 0 ? 'text-pink-400 font-bold' : 'text-slate-400'}`}>
                            {overrideCount} Layers
                        </span>
                    </div>
                 </div>

                 <div className="italic text-slate-400 leading-tight border-l-2 border-slate-600 pl-2 my-1">
                    "{strategy.reasoning}"
                 </div>

                 {strategy.safetyReport && strategy.safetyReport.violationCount > 0 && (
                     <div className="bg-orange-900/30 text-orange-200 p-1 rounded flex items-center space-x-1">
                         <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                         <span>{strategy.safetyReport.violationCount} Boundary Warnings</span>
                     </div>
                 )}

                 {strategy.generativePrompt && (
                     <div className="bg-black/30 p-1.5 rounded text-pink-200/80 font-mono text-[9px] border border-pink-900/30 truncate">
                        GEN: {strategy.generativePrompt}
                     </div>
                 )}
             </div>
         )}
         
         {error && (
             <div className="text-[10px] text-red-300 bg-red-900/20 p-2 rounded border border-red-900/50">
                {error}
             </div>
         )}

         <button 
            onClick={handleAnalyze}
            disabled={!isReady || isAnalyzing}
            className={`w-full py-2 rounded text-xs font-bold uppercase tracking-wider transition-all
               ${isReady && !isAnalyzing 
                  ? 'bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg' 
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
               }`}
         >
            {isAnalyzing ? (
                <div className="flex items-center justify-center space-x-2">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Analyst Thinking...</span>
                </div>
            ) : "Analyze Layout"}
         </button>
      </div>

      {/* Outputs (Proxies) */}
      <Handle type="source" position={Position.Bottom} id="source-out" className="!bg-indigo-500" style={{ left: '30%' }} title="Analyzed Source" />
      <Handle type="source" position={Position.Bottom} id="target-out" className="!bg-emerald-500" style={{ left: '70%' }} title="Target Reference" />
    </div>
  );
});