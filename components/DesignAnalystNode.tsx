import React, { memo, useState, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps, useEdges, useNodes, Node } from 'reactflow';
import { PSDNodeData, MappingContext, TemplateMetadata, LayoutStrategy, SerializableLayer } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { GoogleGenAI, Type } from "@google/genai";

export const DesignAnalystNode = memo(({ id }: NodeProps<PSDNodeData>) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [strategy, setStrategy] = useState<LayoutStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const edges = useEdges();
  const nodes = useNodes();
  
  const { resolvedRegistry, templateRegistry, registerResolved, registerTemplate, registerAnalysis, unregisterNode } = useProceduralStore();

  // 1. Upstream Data Retrieval
  // Source: Connected via 'source-in' (Expects MappingContext from Resolver)
  const sourceData = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'source-in');
    if (!edge || !edge.sourceHandle) return null;
    const registry = resolvedRegistry[edge.source];
    return registry ? registry[edge.sourceHandle] : null;
  }, [edges, id, resolvedRegistry]);

  // Target: Connected via 'target-in' (Expects ContainerDefinition via TemplateSplitter or direct connection)
  const targetData = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'target-in');
    if (!edge) return null;
    
    // We expect the source to be a TemplateSplitter or TargetTemplate
    const template = templateRegistry[edge.source];
    if (!template) return null;

    let containerName = edge.sourceHandle;
    // Clean handle names from Splitter
    if (containerName?.startsWith('slot-bounds-')) {
        containerName = containerName.replace('slot-bounds-', '');
    }

    return template.containers.find(c => c.name === containerName);
  }, [edges, id, templateRegistry]);

  // Cleanup
  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // 2. Pass-Through Data Registration
  // The Analyst acts as a proxy, registering upstream data under its own ID so the Remapper can read it.
  useEffect(() => {
    if (sourceData) {
        registerResolved(id, 'source-out', sourceData);
    }
    if (targetData) {
        // Create a synthetic template for the single container to satisfy Remapper's expectation
        const syntheticTemplate: TemplateMetadata = {
            canvas: { width: 1000, height: 1000 }, // Dummy canvas, we only care about the container
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

      const sourceAspect = sourceW / sourceH;
      const targetAspect = targetW / targetH;

      // Summarize Layer Hierarchy for the AI (Simulating Vision via Geometry)
      const layerSummary = (sourceData.layers as SerializableLayer[]).map(l => ({
         name: l.name,
         type: l.type,
         relativeArea: (l.coords.w * l.coords.h) / (sourceW * sourceH),
         position: {
             x: (l.coords.x - sourceData.container.bounds.x) / sourceW,
             y: (l.coords.y - sourceData.container.bounds.y) / sourceH
         }
      }));

      const prompt = `
        Act as a senior Graphic Designer / UI Layout Specialist.
        Analyze the transformation of a visual asset group into a new container slot.
        
        Source Container: ${sourceW}x${sourceH} (Aspect: ${sourceAspect.toFixed(2)})
        Target Slot: ${targetW}x${targetH} (Aspect: ${targetAspect.toFixed(2)})
        
        Key Layers in Source:
        ${JSON.stringify(layerSummary.slice(0, 5))}
        
        Task:
        1. Compare aspect ratios.
        2. Determine the best Scale Factor to fit the content aesthetically. 
           - If source is square and target is tall, should we "STRETCH" or Fit Width?
           - Standard Math would effectively use min(scaleX, scaleY). Does that leave too much whitespace?
        3. Suggest an Anchor Point (TOP, CENTER, BOTTOM) based on layer distribution (e.g. if content is at the bottom, anchor BOTTOM).
        4. If there is significant empty space (>30%), write a "generativePrompt" for an outpainting AI to extend the background style.
        
        Return JSON.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    suggestedScale: { type: Type.NUMBER },
                    anchor: { type: Type.STRING, enum: ['TOP', 'CENTER', 'BOTTOM', 'STRETCH'] },
                    generativePrompt: { type: Type.STRING },
                    reasoning: { type: Type.STRING }
                },
                required: ['suggestedScale', 'anchor', 'generativePrompt', 'reasoning']
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

  // Helper for Ghost Preview
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
                    <span className="text-pink-300 font-bold">SUGGESTED STRATEGY</span>
                    <span className="text-slate-400">{strategy.anchor}</span>
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                    <div>
                        <span className="block text-slate-500">Scale</span>
                        <span className="text-slate-200 font-mono">{strategy.suggestedScale.toFixed(3)}x</span>
                    </div>
                 </div>
                 <div className="italic text-slate-400 leading-tight">
                    "{strategy.reasoning}"
                 </div>
                 {strategy.generativePrompt && (
                     <div className="bg-black/30 p-1.5 rounded text-pink-200/80 font-mono text-[9px] border border-pink-900/30">
                        PROMPT: {strategy.generativePrompt}
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
            {isAnalyzing ? "Reasoning..." : "Analyze Layout"}
         </button>
      </div>

      {/* Outputs (Proxies) */}
      <Handle type="source" position={Position.Bottom} id="source-out" className="!bg-indigo-500" style={{ left: '30%' }} title="Analyzed Source" />
      <Handle type="source" position={Position.Bottom} id="target-out" className="!bg-emerald-500" style={{ left: '70%' }} title="Target Reference" />
    </div>
  );
});