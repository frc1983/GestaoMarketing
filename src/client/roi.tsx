import { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Plus, Trash2 } from 'lucide-react';
import { api, type RoiLedgerData, type RoiLedgerEntry } from './api';
import { Drawer, Empty } from './screens';

const allocations = ['Equipe Netfive', 'Cliente X', 'Cliente Y'];
const expenseCategories = ['Hospedagem', 'Passagem aérea', 'Transporte', 'Alimentação', 'Outros'];
const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
const monthLabel = (value: string) => new Date(`${value}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
const inputDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const currentMonthRange = () => {
  const now = new Date();
  return { start: inputDate(new Date(now.getFullYear(), now.getMonth(), 1)), end: inputDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

interface TimelinePoint { month: string; credits: number; debits: number }

function FinancialTimelineChart({ entries }: { entries: RoiLedgerEntry[] }) {
  const points = useMemo(() => {
    const grouped = new Map<string, TimelinePoint>();
    for (const entry of entries) {
      const month = entry.occurred_on.slice(0, 7);
      const point = grouped.get(month) ?? { month, credits: 0, debits: 0 };
      if (entry.entry_type === 'credit') point.credits += entry.amount_cents;
      else point.debits += entry.amount_cents;
      grouped.set(month, point);
    }
    return [...grouped.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [entries]);
  if (!points.length) return null;
  const width = 760; const height = 260; const left = 54; const right = 18; const top = 24; const bottom = 42;
  const chartWidth = width - left - right; const chartHeight = height - top - bottom;
  const maximum = Math.max(...points.flatMap(point => [point.credits, point.debits]), 1);
  const step = chartWidth / points.length; const barWidth = Math.min(22, Math.max(7, step * .28));
  const currentMonth = new Date().toISOString().slice(0, 7); const futureStart = points.findIndex(point => point.month > currentMonth);
  const labelInterval = Math.max(1, Math.ceil(points.length / 7));
  const tickValues = [0, .5, 1].map(value => Math.round(maximum * value));
  return <section className="card roi-chart" aria-label="Gráfico temporal de débitos e créditos">
    <div className="roi-chart-head"><div><h2>Fluxo financeiro no tempo</h2><p>Débitos e créditos por mês, incluindo lançamentos futuros.</p></div><div className="roi-chart-legend"><span><i className="credit"/>Créditos</span><span><i className="debit"/>Débitos</span></div></div>
    <div className="roi-chart-scroll"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Barras de créditos e débitos por mês">
      {futureStart >= 0 && <><rect className="roi-chart-future" x={left + futureStart * step} y={top} width={chartWidth - futureStart * step} height={chartHeight}/><text className="roi-chart-future-label" x={left + futureStart * step + 7} y={top + 14}>Futuro</text></>}
      {tickValues.map((value, index) => { const y = top + chartHeight - (value / maximum) * chartHeight; return <g key={value}><line className="roi-chart-grid" x1={left} x2={width - right} y1={y} y2={y}/><text className="roi-chart-axis" x={left - 8} y={y + 4} textAnchor="end">{money(value)}</text></g>; })}
      {points.map((point, index) => { const center = left + index * step + step / 2; const creditHeight = point.credits / maximum * chartHeight; const debitHeight = point.debits / maximum * chartHeight; const showLabel = index % labelInterval === 0 || index === points.length - 1; return <g key={point.month}><rect className="roi-chart-bar credit" x={center - barWidth - 2} y={top + chartHeight - creditHeight} width={barWidth} height={creditHeight} rx="3"><title>{`${monthLabel(point.month)} · Créditos: ${money(point.credits)}`}</title></rect><rect className="roi-chart-bar debit" x={center + 2} y={top + chartHeight - debitHeight} width={barWidth} height={debitHeight} rx="3"><title>{`${monthLabel(point.month)} · Débitos: ${money(point.debits)}`}</title></rect>{showLabel && <text className="roi-chart-axis" x={center} y={height - 17} textAnchor="middle">{monthLabel(point.month)}</text>}</g>; })}
      <line className="roi-chart-baseline" x1={left} x2={width - right} y1={top + chartHeight} y2={top + chartHeight}/>
    </svg></div>
  </section>;
}

function EntryForm({ type, onClose, onSaved }: { type: 'debit' | 'credit'; onClose: () => void; onSaved: () => void }) {
  const [allocation, setAllocation] = useState(allocations[0]); const [expenseCategory, setExpenseCategory] = useState(expenseCategories[0]);
  const [company, setCompany] = useState(''); const [service, setService] = useState(''); const [client, setClient] = useState('');
  const [amount, setAmount] = useState(''); const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10)); const [notes, setNotes] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const common = { entryType: type, amountCents: Math.round(Number(amount) * 100), occurredOn, notes: notes || null };
      await api.addRoiLedgerEntry(type === 'debit' ? { ...common, allocation, expenseCategory, company } : { ...common, service, client });
      onSaved(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o lançamento.'); }
    finally { setBusy(false); }
  }
  const isDebit = type === 'debit';
  return <Drawer title={isDebit ? 'Novo gasto' : 'Novo ganho'} onClose={onClose} footer={<><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" form="roi-entry-form" disabled={busy}>{busy ? 'Salvando...' : 'Salvar lançamento'}</button></>}>
    {error && <div className="alert error">{error}</div>}
    <form id="roi-entry-form" onSubmit={save}><div className="form-grid">
      {isDebit ? <><div className="field"><label>Responsável pelo gasto</label><select value={allocation} onChange={event => setAllocation(event.target.value)}>{allocations.map(item => <option key={item}>{item}</option>)}</select></div><div className="field"><label>Categoria</label><select value={expenseCategory} onChange={event => setExpenseCategory(event.target.value)}>{expenseCategories.map(item => <option key={item}>{item}</option>)}</select></div><div className="field wide"><label>Empresa</label><input required value={company} onChange={event => setCompany(event.target.value)} placeholder="Ex.: Companhia aérea ou hotel"/></div></> : <><div className="field wide"><label>Serviço prestado</label><input required value={service} onChange={event => setService(event.target.value)} placeholder="Ex.: Produção de evento"/></div><div className="field wide"><label>Cliente que pagou</label><input required value={client} onChange={event => setClient(event.target.value)} placeholder="Nome do cliente"/></div></>}
      <div className="field"><label>Valor (R$)</label><input type="number" min="0" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)}/></div><div className="field"><label>{isDebit ? 'Data do gasto' : 'Data do crédito'}</label><input type="date" required value={occurredOn} onChange={event => setOccurredOn(event.target.value)}/></div><div className="field wide"><label>Observações</label><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Opcional"/></div>
    </div></form>
  </Drawer>;
}

function EntryRow({ entry, onRemove }: { entry: RoiLedgerEntry; onRemove: (entry: RoiLedgerEntry) => void }) {
  const credit = entry.entry_type === 'credit';
  const description = credit ? entry.service : entry.expense_category;
  const counterpart = credit ? entry.client : entry.company;
  return <tr><td><span className={`pill ${credit ? '' : 'danger'}`}>{credit ? 'Crédito' : 'Débito'}</span></td><td className="cell-title">{description}</td><td>{counterpart}</td><td>{credit ? '—' : entry.allocation}</td><td>{dateLabel(entry.occurred_on)}</td><td className={credit ? 'roi-credit' : 'roi-debit'}>{credit ? '+' : '−'} {money(entry.amount_cents)}</td><td><button className="ghost" title="Arquivar lançamento" onClick={() => onRemove(entry)}><Trash2 size={15}/></button></td></tr>;
}

export function RoiScreen({ initialStatus: _initialStatus = '' }: { initialStatus?: string }) {
  const [data, setData] = useState<RoiLedgerData | null>(null); const [error, setError] = useState(''); const [creating, setCreating] = useState<'debit' | 'credit' | null>(null); const [filter, setFilter] = useState<'all' | 'debit' | 'credit'>('all'); const [startDate, setStartDate] = useState(() => currentMonthRange().start); const [endDate, setEndDate] = useState(() => currentMonthRange().end);
  function refresh() { api.roiLedger().then(setData).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar o ROI.')); }
  useEffect(refresh, []);
  const dateEntries = useMemo(() => data?.entries.filter(item => (!startDate || item.occurred_on >= startDate) && (!endDate || item.occurred_on <= endDate)) ?? [], [data, startDate, endDate]);
  const entries = useMemo(() => dateEntries.filter(item => filter === 'all' || item.entry_type === filter), [dateEntries, filter]);
  async function remove(entry: RoiLedgerEntry) { if (!window.confirm(`Arquivar o lançamento “${entry.entry_type === 'credit' ? entry.service : entry.expense_category}”?`)) return; try { await api.removeRoiLedgerEntry(entry.id); refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível arquivar.'); } }
  const totals = useMemo(() => dateEntries.reduce((total, entry) => ({ credits: total.credits + (entry.entry_type === 'credit' ? entry.amount_cents : 0), debits: total.debits + (entry.entry_type === 'debit' ? entry.amount_cents : 0) }), { credits: 0, debits: 0 }), [dateEntries]);
  const balance = totals.credits - totals.debits;
  return <><div className="page-head"><div><div className="eyebrow">Financeiro</div><h1>ROI</h1><p>Controle de gastos, créditos recebidos e saldo acumulado.</p></div><div className="head-actions"><button className="secondary" onClick={() => setCreating('debit')}><ArrowDownCircle size={14}/> Novo gasto</button><button className="primary" onClick={() => setCreating('credit')}><ArrowUpCircle size={14}/> Novo ganho</button></div></div>
    {error && <div className="alert error">{error} <button className="link" onClick={refresh}>Tentar novamente</button></div>}
    <div className="metric-grid"><div className="card metric"><strong className="roi-credit">{money(totals.credits)}</strong><small>Créditos recebidos</small></div><div className="card metric"><strong className="roi-debit">{money(totals.debits)}</strong><small>Gastos registrados</small></div><div className="card metric"><strong className={balance >= 0 ? 'roi-credit' : 'roi-debit'}>{money(balance)}</strong><small>Saldo de ROI</small></div><div className="card metric"><strong>{dateEntries.length}</strong><small>Lançamentos</small></div></div>
    {data && <FinancialTimelineChart entries={dateEntries}/>} 
    <div className="toolbar"><div className="date-filter"><label>Início<input type="date" value={startDate} max={endDate || undefined} onChange={event => setStartDate(event.target.value)}/></label><label>Fim<input type="date" value={endDate} min={startDate || undefined} onChange={event => setEndDate(event.target.value)}/></label><button className="link" onClick={() => { const range = currentMonthRange(); setStartDate(range.start); setEndDate(range.end); }}>Mês atual</button></div><div className="segmented"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Todos</button><button className={filter === 'debit' ? 'selected' : ''} onClick={() => setFilter('debit')}>Gastos</button><button className={filter === 'credit' ? 'selected' : ''} onClick={() => setFilter('credit')}>Ganhos</button></div></div>
    {!data && !error ? <div className="loading">Carregando ROI...</div> : entries.length === 0 ? <div className="card"><Empty title="Nenhum lançamento financeiro" body="Registre um gasto ou um ganho para acompanhar o saldo do ROI."/></div> : <div className="card table-wrap"><table className="data-table"><thead><tr><th>Tipo</th><th>Descrição</th><th>Empresa / Cliente</th><th>Responsável</th><th>Data</th><th>Valor</th><th/></tr></thead><tbody>{entries.map(entry => <EntryRow entry={entry} onRemove={remove} key={entry.id}/>)}</tbody></table></div>}
    {creating && <EntryForm type={creating} onClose={() => setCreating(null)} onSaved={refresh}/>}</>;
}
