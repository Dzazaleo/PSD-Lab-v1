import React, { memo, useState, useMemo } from 'react';
import { Handle, Position, NodeProps, useNodes, useEdges, Node } from 'reactflow';
import { PSDNodeData } from '../types';
import { createContainerContext } from '../services/psdService';
import { usePsdResolver, ResolverStatus } from '../hooks/usePsdResolver';

interface ChannelState {
  index: number;
  status: 'idle' | 'resolved' | 'warning' | 'error';
  containerName?: string;
  layerCount: number;
  message?: string;
  debugCode?: ResolverStatus;
}

export const ContainerResolverNode = memo(({ id }: NodeProps) => {
  // State for number of channels (start with 10)
  const [channelCount, setChannelCount] = useState(10);
  
  const nodes = useNodes();
  const edges = useEdges();
  
  // Use specialized hook for resolution logic
  const { resolveLayer } = usePsdResolver();

  // 1. Retrieve Global Data Source (LoadPSDNode)
  // Fix: We access the LoadPSDNode directly to get the template, 
  // ensuring we have the source of truth even if intermediate nodes don't persist data.
  const loadPsdNode = nodes.find(n => n.type === 'loadPsd') as Node<PSDNodeData>;
  const designLayers = loadPsdNode?.data?.designLayers || null;
  const globalTemplate = loadPsdNode?.data?.template || null;

  // 2. Compute Channel Data
  const channels: ChannelState[] = useMemo(() => {
    return Array.from({ length: channelCount }).map((_, index) => {
      const targetHandleId = `target-${index}`;
      
      // Find connection to this handle
      const edge = edges.find(e => e.target === id && e.targetHandle === targetHandleId);

      if (!edge) {
        return { index, status: 'idle', layerCount: 0 };
      }

      // If we are connected but have no template data yet (e.g. file not loaded)
      if (!globalTemplate) {
         return { 
             index, 
             status: 'error', 
             layerCount: 0, 
             message: 'Source Data Locked', 
             debugCode: 'DATA_LOCKED' 
         };
      }

      // Identify container from the edge source handle (which carries the container name)
      const containerName = edge.sourceHandle || '';
      
      // Create Context to verify valid container reference
      const containerContext = createContainerContext(globalTemplate, containerName);
      
      if (!containerContext) {
        // This usually implies a stale connection or mismatched template
        return { 
            index, 
            status: 'error', 
            layerCount: 0, 
            message: 'Invalid Container Ref',
            debugCode: 'UNKNOWN_ERROR'
        };
      }

      // RESOLUTION LOGIC
      // Uses the enhanced diagnostic hook
      const result = resolveLayer(containerContext.containerName, designLayers);

      // Map ResolverStatus to UI Status
      let uiStatus: ChannelState['status'] = 'idle';
      
      switch (result.status) {
        case 'RESOLVED':
          uiStatus = 'resolved';
          break;
        case 'CASE_MISMATCH':
        case 'EMPTY_GROUP':
          uiStatus = 'warning';
          break;
        case 'MISSING_DESIGN_GROUP':
        case 'DATA_LOCKED':
        case 'NO_NAME':
        default:
          uiStatus = 'error';
          break;
      }

      const childCount = result.layer?.children?.length || 0;

      return {
        index,
        status: uiStatus,
        containerName: containerContext.containerName,
        layerCount: childCount,
        message: result.message,
        debugCode: result.status
      };
    });
  }, [channelCount, edges, nodes, designLayers, globalTemplate, id, resolveLayer]);

  const addChannel = () => {
    setChannelCount(prev => prev + 1);
  };

  return (
    <div className="min-w-[320px] bg-slate-800 rounded-lg shadow-xl border border-slate-600 overflow-hidden font-sans flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 p-2 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span className="text-sm font-semibold text-slate-200">Container Resolver</span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">MULTI-MAPPER</span>
      </div>

      {/* Warning if no design layers */}
      {!loadPsdNode && (
        <div className="bg-red-900/20 text-red-300 text-[10px] p-1 text-center border-b border-red-900/30">
          Waiting for PSD Source...
        </div>
      )}

      {/* Channels List */}
      <div className="flex flex-col">
        {channels.map((channel) => (
          <div 
            key={channel.index} 
            className={`relative flex items-center h-10 border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
              channel.status === 'resolved' ? 'bg-emerald-900/10' : 
              channel.status === 'warning' ? 'bg-orange-900/10' : ''
            }`}
          >
            {/* Left Index Label */}
            <span 
              className="absolute left-1.5 text-[9px] font-mono text-slate-500 pointer-events-none select-none z-10" 
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            >
              {channel.index}
            </span>

            {/* Input Handle (Target) */}
            <Handle
              type="target"
              position={Position.Left}
              id={`target-${channel.index}`}
              className={`!w-3 !h-3 !-left-1.5 transition-colors duration-200 ${
                channel.status === 'resolved' ? '!bg-emerald-500 !border-emerald-200' :
                channel.status === 'warning' ? '!bg-orange-500 !border-orange-200' :
                channel.status === 'error' ? '!bg-red-500 !border-red-200' :
                '!bg-slate-600 !border-slate-800'
              }`}
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            />

            {/* Channel UI */}
            <div className="flex-1 flex items-center justify-between px-6">
              <div className="flex items-center space-x-2 overflow-hidden">
                {channel.status === 'idle' ? (
                  <span className="text-xs text-slate-500 italic">Unconnected</span>
                ) : (
                  <div className="flex flex-col leading-tight min-w-0">
                    <span className="text-xs font-semibold text-slate-200 truncate">{channel.containerName}</span>
                    <span className="text-[9px] text-slate-500 truncate">{channel.debugCode}</span>
                  </div>
                )}
              </div>

              {channel.status !== 'idle' && (
                <div className={`text-[10px] px-1.5 py-0.5 rounded border ml-2 whitespace-nowrap ${
                    channel.status === 'resolved' ? 'border-emerald-800 bg-emerald-900/40 text-emerald-300' :
                    channel.status === 'warning' ? 'border-orange-800 bg-orange-900/40 text-orange-300' :
                    'border-red-800 bg-red-900/40 text-red-300'
                }`}>
                  {channel.message}
                </div>
              )}
            </div>

            {/* Right Index Label */}
            <span 
              className="absolute right-2 text-[9px] font-mono text-slate-500 pointer-events-none select-none z-10" 
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            >
              {channel.index}
            </span>

            {/* Output Handle (Source) */}
            <Handle
              type="source"
              position={Position.Right}
              id={`source-${channel.index}`}
              className={`!w-3 !h-3 !-right-1.5 transition-colors duration-200 ${
                channel.status === 'resolved' ? '!bg-emerald-500 !border-white' : '!bg-slate-700 !border-slate-500'
              }`}
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            />
          </div>
        ))}
      </div>

      {/* Footer / Add Button */}
      <button 
        onClick={addChannel}
        className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 border-t border-slate-700 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center space-x-1"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-[10px] font-medium uppercase tracking-wider">Add Channel</span>
      </button>
    </div>
  );
});