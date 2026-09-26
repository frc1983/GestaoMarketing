export interface StockImportRow { name: string; variant: string; quantity: number | null; rawQuantity: string; minimum: number; row: number; pending: string[] }
export interface StockImportItem { name: string; rows: StockImportRow[]; photos: Array<{ url: string; file: File; row: number }>; selectedPhoto: number }

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const data = value as { text?: string; richText?: Array<{ text: string }>; result?: unknown };
    if (data.text != null) return String(data.text);
    if (data.richText) return data.richText.map(part => part.text).join('');
    if (data.result != null) return String(data.result);
  }
  return String(value).trim();
}

export async function readStockWorkbook(file: File): Promise<StockImportItem[]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer() as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('A planilha não tem abas.');
  const header = [1, 2, 3, 4].map(col => cellText(sheet.getCell(1, col).value).toLocaleLowerCase('pt-BR'));
  if (!header[0].includes('brinde') || !header[2].includes('quant')) throw new Error('Colunas esperadas: Brinde, Tamanho, Quant. e Imagem.');
  const items = new Map<string, StockImportItem>();
  const itemByRow = new Map<number, string>();
  let currentName = '';
  for (let row = 2; row <= sheet.rowCount; row++) {
    const found = cellText(sheet.getCell(row, 1).value);
    if (found) currentName = found;
    if (!currentName) continue;
    const variant = cellText(sheet.getCell(row, 2).value);
    const rawQuantity = cellText(sheet.getCell(row, 3).value);
    if (!rawQuantity && !variant && !found) continue;
    const numeric = Number(rawQuantity.replace(',', '.'));
    const quantity = rawQuantity && Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
    const entry = items.get(currentName) || { name: currentName, rows: [], photos: [], selectedPhoto: 0 };
    entry.rows.push({ name: currentName, variant, quantity, rawQuantity, minimum: 0, row, pending: quantity == null ? ['Quantidade precisa de conferência'] : [] });
    items.set(currentName, entry); itemByRow.set(row, currentName);
  }
  for (const picture of sheet.getImages()) {
    const row = Math.floor(picture.range.tl.nativeRow) + 1;
    const col = Math.floor(picture.range.tl.nativeCol) + 1;
    if (col !== 4) continue;
    const name = itemByRow.get(row) || [...itemByRow.entries()].filter(([at]) => at <= row).at(-1)?.[1];
    const item = name ? items.get(name) : undefined;
    if (!item) continue;
    const image = workbook.getImage(Number(picture.imageId));
    if (!image) continue;
    const extension = String(image.extension || 'png').replace('jpeg', 'jpg').toLowerCase();
    const mime = extension === 'jpg' ? 'image/jpeg' : extension === 'gif' ? 'image/gif' : 'image/png';
    const bytes = image.buffer ? new Uint8Array(image.buffer as ArrayBuffer) : image.base64 ? Uint8Array.from(atob(image.base64), char => char.charCodeAt(0)) : null;
    if (!bytes) continue;
    const photoFile = new File([bytes], `${item.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${item.photos.length + 1}.${extension}`, { type: mime });
    item.photos.push({ url: URL.createObjectURL(photoFile), file: photoFile, row });
  }
  return [...items.values()];
}
