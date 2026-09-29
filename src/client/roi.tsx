import { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Plus, Trash2 } from 'lucide-react';
import { api, type RoiLedgerData, type RoiLedgerEntry } from './api';
import { Drawer, Empty } from './screens';

const allocations = ['Equipe Netfive', 'Cliente X', 'Cliente Y'];
const expenseCategories = ['Hospedagem', 'Passagem aérea', 'Transporte', 'Alimentação', 'Outros'];
const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');

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
  const [data, setData] = useState<RoiLedgerData | null>(null); const [error, setError] = useState(''); const [creating, setCreating] = useState<'debit' | 'credit' | null>(null); const [filter, setFilter] = useState<'all' | 'debit' | 'credit'>('all');
  function refresh() { api.roiLedger().then(setData).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar o ROI.')); }
  useEffect(refresh, []);
  const entries = useMemo(() => data?.entries.filter(item => filter === 'all' || item.entry_type === filter) ?? [], [data, filter]);
  async function remove(entry: RoiLedgerEntry) { if (!window.confirm(`Arquivar o lançamento “${entry.entry_type === 'credit' ? entry.service : entry.expense_category}”?`)) return; try { await api.removeRoiLedgerEntry(entry.id); refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível arquivar.'); } }
  const totals = data?.totals ?? { credits: 0, debits: 0, balance: 0 };
  return <><div className="page-head"><div><div className="eyebrow">Financeiro</div><h1>ROI</h1><p>Controle de gastos, créditos recebidos e saldo acumulado.</p></div><div className="head-actions"><button className="secondary" onClick={() => setCreating('debit')}><ArrowDownCircle size={14}/> Novo gasto</button><button className="primary" onClick={() => setCreating('credit')}><ArrowUpCircle size={14}/> Novo ganho</button></div></div>
    {error && <div className="alert error">{error} <button className="link" onClick={refresh}>Tentar novamente</button></div>}
    <div className="metric-grid"><div className="card metric"><strong className="roi-credit">{money(totals.credits)}</strong><small>Créditos recebidos</small></div><div className="card metric"><strong className="roi-debit">{money(totals.debits)}</strong><small>Gastos registrados</small></div><div className="card metric"><strong className={totals.balance >= 0 ? 'roi-credit' : 'roi-debit'}>{money(totals.balance)}</strong><small>Saldo de ROI</small></div><div className="card metric"><strong>{data?.entries.length ?? 0}</strong><small>Lançamentos</small></div></div>
    <div className="toolbar"><div className="segmented"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Todos</button><button className={filter === 'debit' ? 'selected' : ''} onClick={() => setFilter('debit')}>Gastos</button><button className={filter === 'credit' ? 'selected' : ''} onClick={() => setFilter('credit')}>Ganhos</button></div></div>
    {!data && !error ? <div className="loading">Carregando ROI...</div> : entries.length === 0 ? <div className="card"><Empty title="Nenhum lançamento financeiro" body="Registre um gasto ou um ganho para acompanhar o saldo do ROI."/></div> : <div className="card table-wrap"><table className="data-table"><thead><tr><th>Tipo</th><th>Descrição</th><th>Empresa / Cliente</th><th>Responsável</th><th>Data</th><th>Valor</th><th/></tr></thead><tbody>{entries.map(entry => <EntryRow entry={entry} onRemove={remove} key={entry.id}/>)}</tbody></table></div>}
    {creating && <EntryForm type={creating} onClose={() => setCreating(null)} onSaved={refresh}/>}</>;
}
