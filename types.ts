import { Psd } from 'ag-psd';

export interface ContainerDefinition {
  id: string;
  name: string;
  bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  normalized: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface TemplateMetadata {
  canvas: {
    width: number;
    height: number;
  };
  containers: ContainerDefinition[];
}

export interface PSDNodeData {
  fileName: string | null;
  psd: Psd | null;
  template: TemplateMetadata | null;
  error?: string | null;
}

// Re-export Psd type for convenience in other files
export type { Psd };