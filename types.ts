import { Psd } from 'ag-psd';

export interface PSDNodeData {
  fileName: string | null;
  psd: Psd | null;
  error?: string | null;
}

// Re-export Psd type for convenience in other files
export type { Psd };