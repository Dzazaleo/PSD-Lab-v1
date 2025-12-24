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

export interface SerializableLayer {
  id: string;
  name: string;
  type: 'layer' | 'group';
  children?: SerializableLayer[];
  isVisible: boolean;
  opacity: number;
  coords: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export type RemapStrategy = 'STRETCH' | 'UNIFORM_FIT' | 'UNIFORM_FILL' | 'NONE';

export interface TransformedLayer extends SerializableLayer {
  transform: {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  };
  children?: TransformedLayer[];
}

export interface MappingContext {
  container: ContainerContext;
  layers: SerializableLayer[] | TransformedLayer[];
  status: 'resolved' | 'empty' | 'transformed';
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

export interface TransformedPayload {
  status: 'success' | 'error' | 'idle';
  sourceNodeId: string;
  sourceContainer: string;
  targetContainer: string;
  layers: TransformedLayer[];
  scaleFactor: number;
  metrics: {
    source: { w: number, h: number };
    target: { w: number, h: number };
  };
}

export interface RemapperConfig {
  targetContainerName: string | null;
  strategy?: RemapStrategy;
}

export interface PSDNodeData {
  fileName: string | null;
  template: TemplateMetadata | null;
  validation: DesignValidationReport | null;
  designLayers: SerializableLayer[] | null;
  containerContext?: ContainerContext | null;
  mappingContext?: MappingContext | null; // For downstream nodes consuming resolver output
  targetAssembly?: TargetAssembly | null; // For TargetSplitterNode output
  remapperConfig?: RemapperConfig | null; // For RemapperNode state
  transformedPayload?: TransformedPayload | null; // For RemapperNode output
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