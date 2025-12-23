import React, { memo, useCallback, useState, useRef } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { parsePsdFile } from '../services/psdService';
import { PSDNodeData } from '../types';

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
    <div className="w-64 bg-slate-800 rounded-lg shadow-xl border border-slate-600 overflow-hidden font-sans">
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
            className="group cursor-pointer border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-md p-4 flex flex-col items-center justify-center transition-colors bg-slate-800/50 hover:bg-slate-700/50"
          >
            <svg className="w-8 h-8 text-slate-500 group-hover:text-blue-400 mb-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-xs text-slate-400 group-hover:text-slate-300 text-center">
              Click to select .psd
            </span>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-4 space-y-2">
            <svg className="animate-spin h-6 w-6 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-xs text-slate-400">Parsing structure...</span>
          </div>
        )}

        {data.psd && !isLoading && (
          <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
            <div className="flex items-center space-x-2 mb-2">
              <div className="bg-green-500/20 text-green-400 p-1 rounded-full">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-200 truncate max-w-[140px]" title={data.fileName || 'file.psd'}>
                {data.fileName}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
              <div className="flex flex-col">
                <span className="uppercase tracking-wider opacity-60">Width</span>
                <span className="text-slate-200">{data.psd.width}px</span>
              </div>
              <div className="flex flex-col">
                <span className="uppercase tracking-wider opacity-60">Height</span>
                <span className="text-slate-200">{data.psd.height}px</span>
              </div>
              <div className="flex flex-col col-span-2">
                <span className="uppercase tracking-wider opacity-60">Layers</span>
                <span className="text-slate-200">{data.psd.children?.length || 0} top-level</span>
              </div>
            </div>

            <button 
              onClick={handleBoxClick}
              className="mt-3 w-full py-1 px-2 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded transition-colors"
            >
              Replace File
            </button>
          </div>
        )}

        {(localError || data.error) && !isLoading && (
          <div className="mt-2 p-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-300 break-words">
            Error: {localError || data.error}
            <button 
              onClick={handleBoxClick} 
              className="block mt-1 underline text-red-200 hover:text-white"
            >
              Try Again
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