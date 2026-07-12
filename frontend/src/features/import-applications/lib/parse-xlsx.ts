export type ExcelPreview = { sheetNames: string[]; activeSheet: string; headers: string[]; rows: Record<string, unknown>[] }

export async function parseXlsx(file: File): Promise<ExcelPreview> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const activeSheet = workbook.SheetNames[0]
  if (!activeSheet) throw new Error('В файле нет листов.')
  const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[activeSheet], { header: 1, defval: '' })
  const normalized = (value: unknown) => String(value ?? '').trim().toLowerCase()
  const headerIndex = values.findIndex(row => {
    const cells = row.map(normalized)
    return cells.some(cell => cell.includes('снилс')) &&
      cells.some(cell => cell.includes('фио') || cell.includes('фамил')) &&
      cells.some(cell => cell.includes('балл') || cell.includes('средн'))
  })
  if (headerIndex === -1) throw new Error('Не найдена строка заголовков с колонками ФИО, СНИЛС и средним баллом.')
  const headers = values[headerIndex].map(value => String(value ?? '').trim())
  const rows = values.slice(headerIndex + 1)
    .filter(row => row.some(cell => String(cell ?? '').trim() !== ''))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
  if (rows.length > 2000) throw new Error('В одном файле можно импортировать до 2000 строк.')
  return { sheetNames: workbook.SheetNames, activeSheet, headers, rows }
}
