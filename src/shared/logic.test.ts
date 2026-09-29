import { describe, it, expect } from 'vitest';
import { availableStock, parseCsv, projectProgress, roiBalance, roiPercent, sumCents, totalsByKey } from './logic';

describe('regras de negócio', () => {
  it('mantém pipeline separado do ROI e evita divisão por zero', () => {
    expect(roiPercent(15000, 10000)).toBe(50);
    expect(roiPercent(15000, 0)).toBeNull();
  });
  it('calcula progresso e saldo disponível', () => {
    expect(projectProgress([{ status: 'Concluído' }, { status: 'Em andamento' }])).toBe(50);
    expect(availableStock(20, 8)).toBe(12);
  });
  it('separa créditos e débitos no saldo financeiro de ROI', () => {
    expect(sumCents([125000, 7500])).toBe(132500);
    expect(roiBalance(225000, 132500)).toBe(92500);
    expect(totalsByKey([{ key: 'Hospedagem', amountCents: 125000 }, { key: 'Hospedagem', amountCents: 7500 }])).toEqual({ Hospedagem: 132500 });
  });
  it('lê CSV com vírgulas e aspas', () => {
    expect(parseCsv('id,conta\r\n1,"ACME, Inc."\r\n2,"A ""B"""')).toEqual([
      ['id', 'conta'], ['1', 'ACME, Inc.'], ['2', 'A "B"'],
    ]);
  });
});
