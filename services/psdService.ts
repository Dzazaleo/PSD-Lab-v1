import { readPsd, writePsd, Psd, ReadOptions, WriteOptions, Layer } from 'ag-psd';
import { TemplateMetadata, ContainerDefinition, DesignValidationReport, ValidationIssue, SerializableLayer, ContainerContext } from '../types';

export interface PSDParseOptions {
  /**
   * Whether to skip parsing layer image data.
   * Defaults to false (we need image data for procedural generation).
   */
  skipLayerImageData?: boolean;
  /**
   * Whether to skip parsing the thumbnail.
   * Defaults to true to save resources.
   */
  skipThumbnail?: boolean;
}

/**
 * Parses a PSD file using ag-psd with enhanced error handling and configuration.
 * @param file The File object to parse.
 * @param options Configuration options for parsing.
 * @returns A Promise resolving to the parsed Psd object.
 */
export const parsePsdFile = async (file: File, options: PSDParseOptions = {}): Promise<Psd> => {
  return new Promise((resolve, reject) => {
    // Input validation
    if (!file) {
      reject(new Error('No file provided for parsing.'));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const arrayBuffer = reader.result;

      // Ensure we have a valid ArrayBuffer
      if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
        reject(new Error('FileReader failed to produce a valid ArrayBuffer.'));
        return;
      }

      if (arrayBuffer.byteLength === 0) {
        reject(new Error('The provided file is empty.'));
        return;
      }

      try {
        // Configure parsing options
        const readOptions: ReadOptions = {
          skipLayerImageData: options.skipLayerImageData ?? false,
          skipThumbnail: options.skipThumbnail ?? true,
        };

        // Attempt to parse the PSD
        const psd = readPsd(arrayBuffer, readOptions);
        resolve(psd);

      } catch (error: any) {
        console.error("PSD Parsing Logic Error:", error);

        // Distinguish between different types of errors
        let errorMessage = 'Failed to parse PSD structure.';
        
        if (error instanceof Error) {
          // Check for common ag-psd or format errors
          if (error.message.includes('Invalid signature') || error.message.includes('Signature not found')) {
            errorMessage = 'Invalid file format. The file does not appear to be a valid Adobe Photoshop file.';
          } else if (error.message.includes('RangeError') || error.message.includes('Out of bounds')) {
             errorMessage = 'The PSD file appears to be corrupted or truncated (Buffer out of bounds).';
          } else {
             errorMessage = `PSD Parsing Error: ${error.message}`;
          }
        }

        reject(new Error(errorMessage));
      }
    };

    reader.onerror = () => {
      const msg = reader.error ? reader.error.message : 'Unknown IO error';
      console.error("FileReader Error:", reader.error);
      reject(new Error(`Failed to read file from disk: ${msg}`));
    };

    // Start reading
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Extracts metadata for the procedural logic engine from the parsed PSD.
 * Looks for a top-level group named '!!TEMPLATE' and extracts its children as containers.
 */
export const extractTemplateMetadata = (psd: Psd): TemplateMetadata => {
  // Default to 1 to avoid division by zero if undefined, though PSDs usually have dims.
  const canvasWidth = psd.width || 1;
  const canvasHeight = psd.height || 1;

  const containers: ContainerDefinition[] = [];

  // Find the !!TEMPLATE group
  const templateGroup = psd.children?.find(child => child.name === '!!TEMPLATE');

  if (templateGroup && templateGroup.children) {
    templateGroup.children.forEach((child, index) => {
      // Skip invisible layers if needed, but for now we include all structure
      
      const top = child.top ?? 0;
      const left = child.left ?? 0;
      const bottom = child.bottom ?? 0;
      const right = child.right ?? 0;
      
      const width = right - left;
      const height = bottom - top;
      
      const rawName = child.name || 'Untitled';
      const cleanName = rawName.replace(/^!!/, '');

      containers.push({
        id: `container-${index}-${cleanName.replace(/\s+/g, '_')}`,
        name: cleanName,
        originalName: rawName,
        bounds: {
          x: left,
          y: top,
          w: width,
          h: height
        },
        normalized: {
          x: left / canvasWidth,
          y: top / canvasHeight,
          w: width / canvasWidth,
          h: height / canvasHeight,
        }
      });
    });
  }

  return {
    canvas: {
      width: canvasWidth,
      height: canvasHeight
    },
    containers
  };
};

/**
 * Creates a scoped ContainerContext object for a specific container.
 * Used by downstream nodes to get context from the TemplateSplitterNode.
 */
export const createContainerContext = (template: TemplateMetadata, containerName: string): ContainerContext | null => {
  const container = template.containers.find(c => c.name === containerName);
  
  if (!container) {
    return null;
  }

  return {
    containerName: container.name,
    bounds: container.bounds,
    canvasDimensions: {
      w: template.canvas.width,
      h: template.canvas.height
    }
  };
};

/**
 * Validates 'Design' layers against the 'Template' containers.
 * Design groups (e.g. SYMBOLS) are checked against containers of the same name (e.g. !!SYMBOLS).
 * Any layer within a design group must be fully contained within the container bounds.
 */
export const mapLayersToContainers = (psd: Psd, template: TemplateMetadata): DesignValidationReport => {
  const issues: ValidationIssue[] = [];
  const containerMap = new Map<string, ContainerDefinition>();
  
  // Index containers by name (e.g. "SYMBOLS" derived from "!!SYMBOLS")
  template.containers.forEach(c => {
    containerMap.set(c.name, c);
  });

  psd.children?.forEach(group => {
    // Skip the template group itself
    if (group.name === '!!TEMPLATE') return;
    
    // Check if this group name matches a known container
    if (group.name && containerMap.has(group.name)) {
        const container = containerMap.get(group.name)!;
        
        // Validate children of this design group
        group.children?.forEach(layer => {
            // Check if layer has valid coordinates
            if (typeof layer.top === 'number' && typeof layer.left === 'number' && 
                typeof layer.bottom === 'number' && typeof layer.right === 'number') {
                
                // Calculate container boundaries
                const containerRight = container.bounds.x + container.bounds.w;
                const containerBottom = container.bounds.y + container.bounds.h;
                
                // Check if layer exceeds container bounds
                const isViolation = 
                    layer.left < container.bounds.x ||
                    layer.top < container.bounds.y ||
                    layer.right > containerRight ||
                    layer.bottom > containerBottom;
                    
                if (isViolation) {
                    issues.push({
                        layerName: layer.name || 'Untitled Layer',
                        containerName: container.name,
                        type: 'PROCEDURAL_VIOLATION',
                        message: `Layer '${layer.name}' extends outside '${container.name}' container.`
                    });
                }
            }
        });
    }
  });

  return {
    isValid: issues.length === 0,
    issues
  };
};

/**
 * Recursively maps ag-psd Layers to a simplified SerializableLayer structure.
 * USES DETERMINISTIC PATH IDs for reconstruction.
 * @param layers The array of layers to process.
 * @param path The current hierarchy path (e.g., "0.1").
 * @returns An array of lightweight SerializableLayer objects.
 */
export const getCleanLayerTree = (layers: Layer[], path: string = ''): SerializableLayer[] => {
  const nodes: SerializableLayer[] = [];
  
  layers.forEach((child, index) => {
    // Explicitly filter out the !!TEMPLATE group
    if (child.name === '!!TEMPLATE') {
      return;
    }

    // Construct deterministic path: "parentIndex.childIndex"
    const currentPath = path ? `${path}.${index}` : `${index}`;

    const top = child.top ?? 0;
    const left = child.left ?? 0;
    const bottom = child.bottom ?? 0;
    const right = child.right ?? 0;

    const node: SerializableLayer = {
      // Deterministic ID based on traversal path
      id: `layer-${currentPath}`,
      name: child.name || 'Untitled',
      type: child.children ? 'group' : 'layer',
      isVisible: child.hidden !== true, 
      opacity: child.opacity != null ? child.opacity / 255 : 1, 
      coords: {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top
      }
    };

    if (child.children) {
      node.children = getCleanLayerTree(child.children, currentPath);
    }

    nodes.push(node);
  });

  return nodes;
};

/**
 * Finds a heavy binary Layer object in the original PSD using the deterministic path ID.
 */
export const findLayerByPath = (psd: Psd, layerId: string): Layer | null => {
  // ID Format: layer-0.1.3
  const pathStr = layerId.replace('layer-', '');
  if (!pathStr) return null;
  
  const indices = pathStr.split('.').map(Number);
  let currentChildren = psd.children;
  let foundLayer: Layer | null = null;
  
  for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (!currentChildren || !currentChildren[idx]) return null;
      
      foundLayer = currentChildren[idx];
      currentChildren = foundLayer.children;
  }
  
  return foundLayer;
};

/**
 * Reconstructs and downloads a new PSD file.
 * @param psd A complete Psd object structure with dimensions and children.
 * @returns A promise that resolves when the file download has been triggered.
 */
export const writePsdFile = async (psd: Psd, fileName: string = 'PROCESSED_RESULT.psd'): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      // Generate the binary using ag-psd
      const buffer = writePsd(psd, { generateThumbnail: true });
      
      // Create Blob
      const blob = new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
      const url = URL.createObjectURL(blob);
      
      // Trigger Download
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Cleanup
      URL.revokeObjectURL(url);
      resolve();
    } catch (e) {
      console.error("Failed to write PSD:", e);
      reject(e);
    }
  });
};
