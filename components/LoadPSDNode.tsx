import React, { memo, useCallback, useState, useRef } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { parsePsdFile, extractTemplateMetadata } from '../services/psdService';
import { PSDNodeData, TemplateMetadata } from '../types';

// Sub-component for visualizing the template structure
const TemplatePreview: React.FC<{ metadata: TemplateMetadata }> = ({ metadata }) => {
  const { canvas, containers } = metadata;
  
  // Calculate aspect ratio for the container div
  const aspectRatio = canvas.height / canvas.width;
  
  const getContainerStyle = (name: string) => {
    // Check name for prefixes to determine color coding
    if (name.includes('BG')) {
      return 'border-purple-500 bg-purple-500/20 text-purple-200';
    } else if (name.includes('SYMBOLS')) {
      return 'border-orange-500 bg-orange-500/20 text-orange-200';
    } else if (name.includes('COUNTERS')) {
      return 'border-blue-500 bg-blue-500/20 text-blue-200';
    }
    return 'border-slate-500 bg-slate-500/10 text-slate-300';
  };

  return (
    <div className="w-full mt-2">
      <div className="flex justify-between items-end mb-1">
        <span className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider">Template Preview</span>
        <span className="text-[9px] text-slate-600">{canvas.width} x {canvas.height}</span>
      </div>
      
      {/* Canvas container */}
      <div 
        className="relative w-full bg-black/40 border border-slate-700 rounded overflow-hidden"
        style={{ paddingBottom: `${aspectRatio * 100}%` }}
      >
        <div className="absolute inset-0">
          {containers.length === 0 && (
            <div className="flex items-center justify-center h-full w-full text-slate-600 text-[10px]">
              No !!TEMPLATE group found
            </div>
          )}
          
          {containers.map((container) => (
            <div
              key={container.id}
              className={`absolute border flex flex-col justify-start items-start overflow-hidden transition-opacity hover:opacity-100 opacity-80 ${getContainerStyle(container.name)}`}
              style={{
                top: `${container.normalized.y * 100}%`,
                left: `${container.normalized.x * 100}%`,
                width: `${container.normalized.w * 100}%`,
                height: `${container.normalized.h * 100}%`,
              }}
              title={`${container.name} (${container.bounds.w}x${container.bounds.h})`}
            >
              <div className="px-1 py-0.5 bg-black/50 text-[8px] whitespace-nowrap truncate w-full">
                {container.name.replace(/^!!/, '')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const LoadPSDNode = memo(({ data, id }: NodeProps<PSDNodeData>) => {
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setNodes } = useReactFlow();

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state
    setIsLoading(true);
    setLocalError(null);

    try {
      console.log(`Parsing file: ${file.name}...`);
      const parsedPsd = await parsePsdFile(file);
      
      console.log('Parsed PSD Structure:', parsedPsd);

      // Extract template metadata
      const templateData = extractTemplateMetadata(parsedPsd);

      // Update the node data in the global graph state
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                fileName: file.name,
                psd: parsedPsd,
                template: templateData,
                error: null,
              },
            };
          }
          return node;
        })
      );
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to parse PSD';
      setLocalError(errorMessage);
      console.error(err);
      
      // Update node with error state
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                fileName: file.name,
                psd: null,
                template: null,
                error: errorMessage,
              },
            };
          }
          return node;
        })
      );
    } finally {
      setIsLoading(false);
    }
  }, [id, setNodes]);

  const handleBoxClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-72 bg-slate-800 rounded-lg shadow-xl border border-slate-600 overflow-hidden font-sans">
      {/* Title Header */}
      <div className="bg-slate-900 p-2 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span className="text-sm font-semibold text-slate-200">Load PSD</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        <input
          type="file"
          accept=".psd"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />

        {!data.psd && !isLoading && (
          <div 
            onClick={handleBoxClick}
            className="group cursor-pointer border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-md p-6 flex flex-col items-center justify-center transition-colors bg-slate-800/50 hover:bg-slate-700/50"
          >
            <svg className="w-10 h-10 text-slate-500 group-hover:text-blue-400 mb-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-xs text-slate-400 group-hover:text-slate-300 text-center font-medium">
              Click to select .psd file
            </span>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm text-slate-300">Parsing structure...</span>
          </div>
        )}

        {data.psd && !isLoading && (
          <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
            <div className="flex items-center space-x-2 mb-3">
              <div className="bg-green-500/20 text-green-400 p-1 rounded-full shrink-0">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-200 truncate" title={data.fileName || 'file.psd'}>
                {data.fileName}
              </span>
            </div>
            
            {data.template && <TemplatePreview metadata={data.template} />}
            
            <div className="flex justify-end mt-2">
                <button 
                onClick={handleBoxClick}
                className="py-1 px-3 bg-slate-700 hover:bg-slate-600 text-[10px] text-slate-300 rounded transition-colors uppercase font-medium tracking-wide"
                >
                Replace
                </button>
            </div>
          </div>
        )}

        {(localError || data.error) && !isLoading && (
          <div className="mt-2 p-3 bg-red-900/30 border border-red-800 rounded text-xs text-red-200 break-words">
            <span className="font-semibold block mb-1 text-red-100">Error Parsing File</span>
            {localError || data.error}
            <button 
              onClick={handleBoxClick} 
              className="block mt-2 underline text-red-300 hover:text-white"
            >
              Try Another File
            </button>
          </div>
        )}
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="psd-output"
        isConnectable={!!data.psd}
        className={`w-3 h-3 border-2 ${!!data.psd ? 'bg-blue-500 border-white' : 'bg-slate-600 border-slate-400'}`}
      />
    </div>
  );
});