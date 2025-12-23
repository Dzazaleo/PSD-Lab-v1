import { readPsd, Psd } from 'ag-psd';

export const parsePsdFile = async (file: File): Promise<Psd> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const arrayBuffer = reader.result as ArrayBuffer;
        // Parse the PSD file
        // skipLayerImageData: true speeds up parsing if we only need structure/metadata initially
        // Use standard options for general compatibility
        const psd = readPsd(arrayBuffer, {
          skipLayerImageData: false,
          skipThumbnail: true, 
        });
        resolve(psd);
      } catch (error) {
        console.error("Error parsing PSD:", error);
        reject(error instanceof Error ? error : new Error('Failed to parse PSD file'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsArrayBuffer(file);
  });
};