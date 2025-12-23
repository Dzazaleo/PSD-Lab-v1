import { readPsd, Psd, ReadOptions } from 'ag-psd';
import { TemplateMetadata, ContainerDefinition } from '../types';

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
        name: rawName, // Keep original name with !! for identification if needed, or clean it. Keeping raw allows better color coding if dependent on tags.
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