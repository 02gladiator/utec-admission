export type ExcelPreview = { sheetNames: string[]; activeSheet: string; headers: string[]; rows: Record<string, unknown>[] }

export async function parseXlsx(file: File): Promise<ExcelPreview> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const activeSheet = workbook.SheetNames[0]
  if (!activeSheet) throw new Error('В файле нет листов.')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[activeSheet], { defval: '' })
  const headers = rows.length ? Object.keys(rows[0]) : []
  return { sheetNames: workbook.SheetNames, activeSheet, headers, rows: rows.slice(0, 100) }
}
