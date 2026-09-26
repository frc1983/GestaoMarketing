export function roiPercent(revenueCents: number, investmentCents: number): number | null {
  return investmentCents > 0 ? ((revenueCents - investmentCents) / investmentCents) * 100 : null;
}

export function projectProgress(phases: Array<{ status: string }>): number {
  return phases.length ? Math.round(phases.filter(p => p.status === 'Concluído').length / phases.length * 100) : 0;
}

export function availableStock(onHand: number, reserved: number): number {
  return onHand - reserved;
}

export function parseCsv(csv: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim())) result.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV com aspas não fechadas');
  row.push(cell);
  if (row.some(x => x.trim())) result.push(row);
  return result;
}
