// Explicitly collect every metadata page for callers that require complete totals.
export async function collectPages(fetchPage, options = {}) {
  const first = await fetchPage({ page: 1, limit: 100 }, options);
  if (!Array.isArray(first?.items) || !Number.isSafeInteger(first.total)) throw new Error('Invalid paginated API response');
  const pages = Math.ceil(first.total / first.limit);
  if (!Number.isFinite(pages) || pages > 10000) throw new Error('Dataset is too large. Use filtered reports or paginated browsing.');
  const items = [...first.items];
  // Bounded parallelism keeps complete exports from exhausting the API pool.
  for (let page = 2; page <= pages; page += 3) {
    const results = await Promise.all(Array.from({ length: Math.min(3, pages - page + 1) }, (_, index) => fetchPage({ page: page + index, limit: first.limit }, options)));
    for (const result of results) items.push(...result.items);
  }
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
export function toDocumentSummary(document) {
  const { scannedImageUrl, scannedFiles, scannedText, timeline, ...metadata } = document;
  return { ...metadata, attachmentCount: scannedFiles?.length || (scannedImageUrl ? 1 : document.attachmentCount || 0), _summary: true };
}
