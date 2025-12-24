import React, { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Handle, Position, NodeProps, useEdges, Node, useReactFlow, NodeResizer } from 'reactflow';
import { PSDNodeData, LayoutStrategy, SerializableLayer, MAX_BOUNDARY_VIOLATION_PERCENT, ChatMessage, TemplateMetadata } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { GoogleGenAI, Type } from "@google/genai";

// Define the exact union type for model keys to match PSDNodeData
type ModelKey = 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-3-pro-thinking';

interface ModelConfig {
  apiModel: string;
  label: string;
  badgeClass: string;
  headerClass: string;
  thinkingBudget?: number;
}

// Strictly typed model configuration
const MODELS: Record<ModelKey, ModelConfig> = {
  'gemini-3-flash': {
    apiModel: 'gemini-3-flash-preview',
    label: 'FLASH',
    badgeClass: 'bg-yellow-500 text-yellow-950 border-yellow-400',
    headerClass: 'border-yellow-500/50 bg-yellow-900/20'
  },
  'gemini-3-pro': {
    apiModel: 'gemini-3-pro-preview',
    label: 'PRO',
    badgeClass: 'bg-blue-600 text-white border-blue-500',
    headerClass: 'border-blue-500/50 bg-blue-900/20'
  },
  'gemini-3-pro-thinking': {
    apiModel: 'gemini-3-pro-preview',
    label: 'DEEP THINKING',
    badgeClass: 'bg-purple-600 text-white border-purple-500',
    headerClass: 'border-purple-500/50 bg-purple-900/20',
    thinkingBudget: 16384
  }
};

// --- Subcomponent: Strategy Card Renderer ---
const StrategyCard: React.FC<{ strategy: LayoutStrategy, modelConfig: ModelConfig }> = ({ strategy, modelConfig }) => {
    const overrideCount = strategy.overrides?.length || 0;
    
    return (
        <div className={`bg-slate-800/80 border-l-2 p-2 rounded text-[10px] space-y-2 w-full ${modelConfig.badgeClass.replace('bg-', 'border-').split(' ')[2]}`}>
             <div className="flex justify-between border-b border-slate-700 pb-1">
                <span className={`font-bold ${modelConfig.badgeClass.includes('yellow') ? 'text-yellow-400' : 'text-blue-300'}`}>SEMANTIC RECOMPOSITION</span>
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
                 <div className="bg-slate-950 p-2 rounded border border-slate-800 font-mono text-[10px] whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                    {strategy.generativePrompt}
                 </div>
             )}
        </div>
    );
};

export const DesignAnalystNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  
  const edges = useEdges();
  const { setNodes } = useReactFlow();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  const { resolvedRegistry, templateRegistry, registerResolved, registerTemplate, registerAnalysis, unregisterNode } = useProceduralStore();

  // Determine current model state (Persistent)
  const selectedModelKey: ModelKey = (data.selectedModel && MODELS[data.selectedModel]) 
    ? data.selectedModel 
    : 'gemini-3-flash';
    
  const activeModelConfig = MODELS[selectedModelKey];
  const chatHistory = data.chatHistory || [];

  // Scroll to bottom of chat on update
  useEffect(() => {
    if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory.length, isAnalyzing]);

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

  // Handle Model Change
  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value as ModelKey;
    setNodes((nds) => 
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              selectedModel: newModel
            }
          };
        }
        return node;
      })
    );
  }, [id, setNodes]);

  // --- AI Logic Helpers ---
  
  const generateSystemInstruction = (isRefining: boolean) => {
    if (!sourceData || !targetData) return "";

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
                width: l.coords.w,
                height: l.coords.h
            });
            if (l.children) {
                flat = flat.concat(flattenLayers(l.children, depth + 1));
            }
        });
        return flat;
    };

    const layerAnalysisData = flattenLayers(sourceData.layers as SerializableLayer[]);

    let prompt = `
        ROLE: Precision Drafting Engine & Senior PSD Compositor.
        GOAL: Perform "Geometry-First Semantic Recomposition" using a STRICT GRID SYSTEM.

        CONTEXT:
        - Source Container Dimensions: ${sourceW}px x ${sourceH}px (Ratio: ${(sourceW / sourceH).toFixed(2)})
        - Target Slot Dimensions: ${targetW}px x ${targetH}px (Ratio: ${(targetW / targetH).toFixed(2)})
        - Allowable Boundary Bleed: ${MAX_BOUNDARY_VIOLATION_PERCENT * 100}% (${(targetH * MAX_BOUNDARY_VIOLATION_PERCENT).toFixed(0)}px)
        
        LAYER HIERARCHY (JSON):
        ${JSON.stringify(layerAnalysisData.slice(0, 50))} ... (Truncated for token limit)

        CRITICAL INSTRUCTION - THE GRID SYSTEM:
        If the Target is significantly TALLER than the Source (e.g. 0.5 ratio vs 1.7 ratio):
        1. DIVIDE the Target Height (${targetH}px) by the number of primary visual elements to create virtual "slots" (e.g. if 4 items, slot height = ${Math.floor(targetH / 4)}px).
        2. ASSIGN each primary layer to a specific vertical slot (Quadrants 1, 2, 3, 4...).
        3. CENTER the layer within that quadrant.
        4. CALCULATE 'yOffset' as the integer distance from the Target Container TOP (0).
        
        ZERO-TOLERANCE MATH:
        - Any layer whose (yOffset + (height * suggestedScale)) > ${targetH * (1 + MAX_BOUNDARY_VIOLATION_PERCENT)} is a CRITICAL FAILURE.
        - You MUST validate your math. Do not guess.
        
        HIERARCHY AWARENESS:
        - Explicitly map key layers (Title, CTA, Images) to specific yOffsets (e.g. 0, 200, 400) based on the calculated grid.
      `;

      if (isRefining) {
          prompt += `\n\nYou are reviewing your previous layout suggestion. The user has provided feedback. Adjust the layerOverrides JSON while maintaining the established 3% safety margin. If the user's request contradicts a design rule, explain why in the 'reasoning' field but prioritize their art direction.`;
      }

      return prompt;
  };

  const performAnalysis = async (history: ChatMessage[]) => {
      setIsAnalyzing(true);
      setError(null);

      try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API_KEY not set in environment");

        const ai = new GoogleGenAI({ apiKey });
        const systemInstruction = generateSystemInstruction(history.length > 1);

        // Convert ChatMessage[] to Gemini Content[]
        const contents = history.map(msg => ({
            role: msg.role,
            parts: msg.parts
        }));

        // Configure Request
        const requestConfig: any = {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    suggestedScale: { type: Type.NUMBER, description: "Base scale factor." },
                    anchor: { type: Type.STRING, enum: ['TOP', 'CENTER', 'BOTTOM', 'STRETCH'] },
                    generativePrompt: { type: Type.STRING },
                    reasoning: { type: Type.STRING },
                    overrides: {
                        type: Type.ARRAY,
                        description: "Precise pixel coordinates for layer recomposition.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                layerId: { type: Type.STRING },
                                xOffset: { type: Type.NUMBER, description: "Distance in pixels from Target LEFT." },
                                yOffset: { type: Type.NUMBER, description: "Distance in pixels from Target TOP." },
                                individualScale: { type: Type.NUMBER, description: "Scale multiplier." }
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
        };

        if (activeModelConfig.thinkingBudget) {
            requestConfig.thinkingConfig = { thinkingBudget: activeModelConfig.thinkingBudget };
        }

        const response = await ai.models.generateContent({
            model: activeModelConfig.apiModel,
            contents,
            config: requestConfig
        });

        const json = JSON.parse(response.text || '{}');
        
        const newAiMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'model',
            parts: [{ text: response.text || '' }],
            strategySnapshot: json,
            timestamp: Date.now()
        };

        // Update Node Data
        setNodes((nds) => 
            nds.map((n) => {
            if (n.id === id) {
                // Ensure we append to the history that was passed in, which includes the pending user message if refining
                const finalHistory = [...history, newAiMessage];
                return { 
                    ...n, 
                    data: { 
                        ...n.data, 
                        layoutStrategy: json, 
                        chatHistory: finalHistory
                    } 
                };
            }
            return n;
            })
        );
        
        // Trigger downstream updates
        registerAnalysis(id, json);

      } catch (e: any) {
          console.error("Gemini Analysis Failed:", e);
          setError(e.message || "AI Analysis Failed");
          // Remove the optimistic user message if it failed? 
          // For now, we leave it but show error.
      } finally {
          setIsAnalyzing(false);
      }
  };

  // 3. Handlers
  const handleAnalyze = () => {
      if (!sourceData || !targetData) return;
      
      const initialUserMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          parts: [{ text: "Perform initial grid-based semantic analysis." }],
          timestamp: Date.now()
      };

      // Reset history for fresh analysis
      setNodes((nds) => nds.map(n => n.id === id ? { ...n, data: { ...n.data, chatHistory: [initialUserMsg] } } : n));
      
      performAnalysis([initialUserMsg]);
  };

  const handleRefine = () => {
      if (!inputText.trim()) return;

      const newUserMessage: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          parts: [{ text: inputText }],
          timestamp: Date.now()
      };

      // Optimistically update UI
      const updatedHistory = [...chatHistory, newUserMessage];
      setNodes((nds) => nds.map(n => n.id === id ? { ...n, data: { ...n.data, chatHistory: updatedHistory } } : n));
      
      setInputText('');
      performAnalysis(updatedHistory);
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

  return (
    <div className={`w-[450px] h-full min-h-[500px] rounded-lg shadow-2xl border overflow-hidden font-sans flex flex-col transition-colors duration-300 bg-slate-900 ${activeModelConfig.headerClass.replace('bg-', 'border-').split(' ')[0]}`}>
      <NodeResizer minWidth={450} minHeight={500} isVisible={true} handleClassName="bg-slate-500" />
      
      {/* Inputs */}
      <Handle type="target" position={Position.Top} id="source-in" className="!bg-indigo-500" style={{ left: '30%' }} title="Source Context" />
      <Handle type="target" position={Position.Top} id="target-in" className="!bg-emerald-500" style={{ left: '70%' }} title="Target Slot" />

      {/* Header */}
      <div className={`p-2 border-b flex items-center justify-between transition-colors duration-300 shrink-0 ${activeModelConfig.headerClass}`}>
         <div className="flex items-center space-x-2">
           <svg className={`w-4 h-4 ${activeModelConfig.badgeClass.includes('yellow') ? 'text-yellow-600' : 'text-slate-100'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <span className={`text-sm font-bold ${activeModelConfig.badgeClass.includes('yellow') ? 'text-yellow-800' : 'text-slate-100'}`}>Design Analyst</span>
         </div>
         
         {/* Model Selector Badge */}
         <div className="relative group">
             <select 
                value={selectedModelKey}
                onChange={handleModelChange}
                className={`appearance-none text-[9px] px-2 py-0.5 pr-4 rounded font-mono font-bold cursor-pointer outline-none border transition-colors duration-300 ${activeModelConfig.badgeClass}`}
             >
                 <option value="gemini-3-flash" className="text-black bg-white">FLASH</option>
                 <option value="gemini-3-pro" className="text-black bg-white">PRO</option>
                 <option value="gemini-3-pro-thinking" className="text-black bg-white">DEEP THINKING</option>
             </select>
             <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1">
                <svg className="h-2 w-2 fill-current opacity-75" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
             </div>
         </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900 overflow-hidden">
         {/* Context Bar (Ghost Preview) - Always Visible at Top */}
         <div className="shrink-0 flex items-center justify-around bg-slate-800/50 p-2 border-b border-slate-700">
             <div className="flex flex-col items-center space-y-1">
                 <span className="text-[9px] text-slate-400 uppercase">Source</span>
                 <div className="border-2 border-dashed flex items-center justify-center bg-indigo-500/10" 
                      style={sourceData ? getPreviewStyle(sourceData.container.bounds.w, sourceData.container.bounds.h, '#6366f1') : { width: 30, height: 30, borderColor: '#334155' }}>
                 </div>
             </div>
             <div className="text-slate-600">→</div>
             <div className="flex flex-col items-center space-y-1">
                 <span className="text-[9px] text-slate-400 uppercase">Target</span>
                 <div className="border-2 border-dashed flex items-center justify-center bg-emerald-500/10" 
                      style={targetData ? getPreviewStyle(targetData.bounds.w, targetData.bounds.h, '#10b981') : { width: 30, height: 30, borderColor: '#334155' }}>
                 </div>
             </div>
         </div>

         {/* Chat History Container */}
         <div 
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar"
            style={{ maxHeight: '300px' }} 
         >
             {chatHistory.length === 0 && (
                 <div className="h-full flex flex-col items-center justify-center text-slate-600 italic text-xs opacity-50 space-y-2">
                     <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                     <span>Ready for analysis</span>
                 </div>
             )}

             {chatHistory.map((msg, idx) => (
                 <div key={msg.id || idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                     <div className={`max-w-[95%] rounded-lg border p-2 text-xs 
                        ${msg.role === 'user' 
                             ? 'bg-slate-800 border-slate-600 text-slate-200' 
                             : `bg-slate-900/50 ${activeModelConfig.badgeClass.replace('bg-', 'border-').split(' ')[0]} text-slate-300`
                        }`}
                     >
                        {msg.role === 'model' && (
                             <div className="flex items-center space-x-1 mb-1 text-[9px] font-bold opacity-50 uppercase tracking-wider">
                                 <span>{activeModelConfig.label}</span>
                                 <span>•</span>
                                 <span>{new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                             </div>
                        )}

                        {/* Updated to use parts[0].text instead of content */}
                        {msg.parts?.[0]?.text && msg.role === 'user' && (
                            <div className="whitespace-pre-wrap">{msg.parts[0].text}</div>
                        )}
                        
                        {msg.strategySnapshot && (
                            <div className="mt-1">
                                <StrategyCard strategy={msg.strategySnapshot} modelConfig={activeModelConfig} />
                            </div>
                        )}
                     </div>
                 </div>
             ))}

             {isAnalyzing && (
                 <div className="flex flex-col items-start animate-pulse">
                      <div className={`max-w-[80%] rounded-lg border p-2 bg-slate-900/50 ${activeModelConfig.badgeClass.replace('bg-', 'border-').split(' ')[0]}`}>
                          <div className="flex items-center space-x-2 text-xs text-slate-400">
                             <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                             <span>Generating semantic layout...</span>
                          </div>
                      </div>
                 </div>
             )}

             {error && (
                 <div className="p-2 rounded bg-red-900/20 border border-red-800/50 text-red-300 text-xs">
                     Error: {error}
                 </div>
             )}
         </div>

         {/* Footer: Input Area */}
         <div className="p-3 border-t border-slate-800 bg-slate-800/30 space-y-2 shrink-0">
             <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isReady ? "Describe refinement (e.g., 'Make the headline bigger')..." : "Connect inputs to start..."}
                disabled={!isReady || isAnalyzing}
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 nodrag nopan resize-none h-16 custom-scrollbar"
             />
             
             <div className="flex space-x-2">
                 {/* Primary Action changes based on context */}
                 <button
                    onClick={handleAnalyze}
                    disabled={!isReady || isAnalyzing}
                    className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm
                        ${isReady && !isAnalyzing 
                            ? 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600'
                            : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
                        }`}
                 >
                    {chatHistory.length > 0 ? "Reset Analysis" : "Analyze Layout"}
                 </button>

                 <button
                    onClick={handleRefine}
                    disabled={!isReady || isAnalyzing || inputText.trim().length === 0}
                    className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm
                        ${inputText.trim().length > 0 && !isAnalyzing
                            ? 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400'
                            : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
                        }`}
                 >
                    Refine Selection
                 </button>
             </div>
         </div>
      </div>

      {/* Outputs (Proxies) */}
      <Handle type="source" position={Position.Bottom} id="source-out" className="!bg-indigo-500" style={{ left: '30%' }} title="Analyzed Source" />
      <Handle type="source" position={Position.Bottom} id="target-out" className="!bg-emerald-500" style={{ left: '70%' }} title="Target Reference" />
    </div>
  );
});