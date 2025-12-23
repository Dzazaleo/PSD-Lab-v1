import { useCallback } from 'react';
import { SerializableLayer } from '../types';

/**
 * Hook to resolve a template container name to a matching design layer group.
 * 
 * Encapsulates the logic for:
 * 1. Stripping procedural prefixes (e.g., '!!SYMBOLS' -> 'SYMBOLS')
 * 2. Case-insensitive matching
 * 3. Top-level tree searching
 */
export const usePsdResolver = () => {
  /**
   * Resolves a template name to a matching group in the design layer tree.
   * 
   * @param templateName The name of the container/template (e.g. "!!SYMBOLS" or "SYMBOLS").
   * @param designTree The array of SerializableLayers from the PSD.
   * @returns The matching SerializableLayer (sub-tree) or null if not found.
   */
  const resolveLayer = useCallback((templateName: string, designTree: SerializableLayer[] | null): SerializableLayer | null => {
    if (!designTree || !templateName) return null;

    // 1. Strip procedural prefixes to ensure we are matching against the core name.
    // Handles '!!', '!', etc. (e.g. !!SYMBOLS -> SYMBOLS)
    const normalizedTemplateName = templateName.replace(/^!+/, '').trim();
    
    if (!normalizedTemplateName) return null;

    const targetNameLower = normalizedTemplateName.toLowerCase();

    // 2. Perform top-level search in the designTree for a name match.
    // We look for a design group that matches the normalized name (case-insensitive).
    const match = designTree.find(layer => {
      const layerNameClean = layer.name.trim().toLowerCase();
      return layerNameClean === targetNameLower;
    });

    // 3. Return the entire sub-tree of that group (the layer object itself).
    return match || null;
  }, []);

  return { resolveLayer };
};