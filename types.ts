import { Psd } from 'ag-psd';

export interface ContainerDefinition {
  id: string;
  name: string;
  originalName: string;
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

export interface ContainerContext {
  containerName: string;
  bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  canvasDimensions: {
    w: number;
    h: number;
  };
}

export interface MappingContext {
  container: ContainerContext;
  layers: SerializableLayer[];
  status: 'resolved' | 'empty';
  message?: string;
}

export interface ValidationIssue {
  layerName: string;
  containerName: string;
  type: 'PROCEDURAL_VIOLATION';
  message: string;
}

export interface DesignValidationReport {
  isValid: boolean;
  issues: ValidationIssue[];
}

export interface SerializableLayer {
  id: string;
  name: string;
  type: 'layer' | 'group';
  children?: SerializableLayer[];
  isVisible: boolean;
  opacity: number;
}

export interface TargetAssembly {
  targetDimensions: {
    width: number;
    height: number;
  };
  slots: {
    containerName: string;
    isFilled: boolean;
    assignedLayerCount: number;
  }[];
}

export interface PSDNodeData {
  fileName: string | null;
  template: TemplateMetadata | null;
  validation: DesignValidationReport | null;
  designLayers: SerializableLayer[] | null;
  containerContext?: ContainerContext | null;
  mappingContext?: MappingContext | null; // For downstream nodes consuming resolver output
  targetAssembly?: TargetAssembly | null; // For TargetSplitterNode output
  error?: string | null;
}

export interface TargetTemplateData {
  fileName: string | null;
  template: TemplateMetadata | null;
  // Targets act as skeletons, so they don't have design layers or self-validation reports
  validation: null;
  designLayers: null;
  containerContext: null;
  mappingContext: null;
  error?: string | null;
}

// Re-export Psd type for convenience in other files
export type { Psd };