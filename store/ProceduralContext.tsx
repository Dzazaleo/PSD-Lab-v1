import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Psd } from 'ag-psd';
import { TemplateMetadata, MappingContext } from '../types';

interface ProceduralState {
  // Maps NodeID -> Raw PSD Object (Binary/Structure)
  psdRegistry: Record<string, Psd>;
  
  // Maps NodeID -> Lightweight Template Metadata
  templateRegistry: Record<string, TemplateMetadata>;
  
  // Maps NodeID -> HandleID -> Resolved Context (Layers + Bounds)
  resolvedRegistry: Record<string, Record<string, MappingContext>>;
}

interface ProceduralContextType extends ProceduralState {
  registerPsd: (nodeId: string, psd: Psd) => void;
  registerTemplate: (nodeId: string, template: TemplateMetadata) => void;
  registerResolved: (nodeId: string, handleId: string, context: MappingContext) => void;
  unregisterNode: (nodeId: string) => void;
}

const ProceduralContext = createContext<ProceduralContextType | null>(null);

export const ProceduralStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [psdRegistry, setPsdRegistry] = useState<Record<string, Psd>>({});
  const [templateRegistry, setTemplateRegistry] = useState<Record<string, TemplateMetadata>>({});
  const [resolvedRegistry, setResolvedRegistry] = useState<Record<string, Record<string, MappingContext>>>({});

  const registerPsd = useCallback((nodeId: string, psd: Psd) => {
    setPsdRegistry(prev => ({ ...prev, [nodeId]: psd }));
  }, []);

  const registerTemplate = useCallback((nodeId: string, template: TemplateMetadata) => {
    setTemplateRegistry(prev => {
      // Prevent unnecessary updates if template is identical
      if (prev[nodeId] === template) return prev;
      if (JSON.stringify(prev[nodeId]) === JSON.stringify(template)) return prev;
      
      return { ...prev, [nodeId]: template };
    });
  }, []);

  const registerResolved = useCallback((nodeId: string, handleId: string, context: MappingContext) => {
    setResolvedRegistry(prev => {
      const nodeRecord = prev[nodeId] || {};
      const currentContext = nodeRecord[handleId];

      // Deep equality check to prevent infinite loops from creating new object references
      if (currentContext === context) return prev;
      if (currentContext && JSON.stringify(currentContext) === JSON.stringify(context)) return prev;
      
      return {
        ...prev,
        [nodeId]: {
          ...nodeRecord,
          [handleId]: context
        }
      };
    });
  }, []);

  const unregisterNode = useCallback((nodeId: string) => {
    setPsdRegistry(prev => {
      const { [nodeId]: _, ...rest } = prev;
      return rest;
    });
    setTemplateRegistry(prev => {
      const { [nodeId]: _, ...rest } = prev;
      return rest;
    });
    setResolvedRegistry(prev => {
      const { [nodeId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const value = useMemo(() => ({
    psdRegistry,
    templateRegistry,
    resolvedRegistry,
    registerPsd,
    registerTemplate,
    registerResolved,
    unregisterNode
  }), [psdRegistry, templateRegistry, resolvedRegistry, registerPsd, registerTemplate, registerResolved, unregisterNode]);

  return (
    <ProceduralContext.Provider value={value}>
      {children}
    </ProceduralContext.Provider>
  );
};

export const useProceduralStore = () => {
  const context = useContext(ProceduralContext);
  if (!context) {
    throw new Error('useProceduralStore must be used within a ProceduralStoreProvider');
  }
  return context;
};