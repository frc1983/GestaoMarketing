import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStockWorkbook } from './importExcel';

const source = 'C:/Users/fabio/Downloads/Estoque Marketing.xlsx';

describe.skipIf(!existsSync(source))('importação do estoque real', () => {
  it('normaliza itens, tamanhos, quantidades e imagens incorporadas', async () => {
    const bytes = readFileSync(source);
    const file = new File([bytes], 'Estoque Marketing.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const items = await readStockWorkbook(file);
    const numericTotal = items.flatMap(item => item.rows).reduce((total, row) => total + (row.quantity ?? 0), 0);
    const photos = items.reduce((total, item) => total + item.photos.length, 0);
    const shirt = items.find(item => item.name === 'Camiseta Netfive');
    const pending = items.find(item => item.name === 'Adesivos, Envelopes e pins');

    expect(items).toHaveLength(22);
    expect(numericTotal).toBe(609);
    expect(photos).toBe(24);
    expect(shirt?.rows.map(row => row.variant)).toEqual(['P', 'M', 'G', 'GG', 'X1', 'X2']);
    expect(pending?.rows[0].quantity).toBeNull();
    expect(pending?.rows[0].pending).toContain('Quantidade precisa de conferência');
  }, 20_000);
});
