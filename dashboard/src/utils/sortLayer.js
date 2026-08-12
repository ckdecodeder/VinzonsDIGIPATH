/** Physical sort tray mapping (3 layers). */
export const DOCUMENT_TYPE_LAYER_MAP = {
  'DT-001': 1, // Memorandum
  'DT-002': 2, // Executive Order
  'DT-003': 3, // Communication Letter
};

export const SORT_LAYER_LABELS = {
  1: 'Memorandum',
  2: 'Executive Order',
  3: 'Communication Letter',
};

export const resolveSortLayer = (documentTypeId, fallbackLayer = 3) => {
  const id = String(documentTypeId || '').trim();
  if (id in DOCUMENT_TYPE_LAYER_MAP) {
    return DOCUMENT_TYPE_LAYER_MAP[id];
  }
  return fallbackLayer;
};

export const getSortLayerHint = (documentTypeId) => {
  const id = String(documentTypeId || '').trim();
  const layer = DOCUMENT_TYPE_LAYER_MAP[id];
  if (!layer) return '';
  const label = SORT_LAYER_LABELS[layer] || `Layer ${layer}`;
  return `Sort tray: Layer ${layer} — ${label}`;
};
