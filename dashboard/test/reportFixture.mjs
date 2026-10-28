// Synthetic records only. Shared by the large-report regression checks and
// the development-only browser harness; no database connection is used.
export function reportFixture(count = 10000) {
  return {
    categoryLabel: 'Activity', preparedBy: 'Test Reviewer Peña',
    coverageText: 'Start to Present', generatedAt: '28/10/2026, 6:00:00 PM',
    recordCount: count,
    summaryRows: [['Documents', 'Synthetic count', 0, 'Test fixture only']],
    table: {
      title: 'Activity Log Report',
      headers: ['Date / Time', 'User', 'Role', 'Action', 'Reference', 'Details'],
      columnWidths: [16, 14, 10, 12, 12, 36],
      rows: Array.from({ length: count }, (_, index) => [
        '28/10/2026, 6:00:00 PM', 'Test Reviewer Peña', 'Admin', 'document_updated',
        `R${String(index).padStart(5, '0')}`,
        'Synthetic activity for report verification. This entry checks wrapped details, page breaks and complete output across a very large historical activity report.',
      ]),
    },
  };
}
