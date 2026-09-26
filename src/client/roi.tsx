import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { api } from './api';
import { Drawer, Empty } from './screens';
import type { MarketingRecord } from '../shared/types';

interface Milestone { id: string; event_id: string; phase: string; status: string; notes?: string | null; due_at?: string | null; completed_at?: string | null }
interface RoiSummary { eventId: string; eventTitle: string; investmentCents: number; revenueCents: number; pipelineCents: number; opportunityCount: number; roiPercent: number | null; milestones: Milestone[] }
interface Opportunity { id: string; event_id: string; account: string; amount_cents: number; stage: string; close_date?: string | null; owner?: string | null; updated_at: string }
const phases = ['Pré-ROI', 'D+5', 'D+10', 'D+30', 'D+90', 'D+180'];
const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const dateLabel = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem data';

function groupOf(event: MarketingRecord, summary: RoiSummary): 'Futuro' | 'Em mensuração' | 'Finalizado' {
  const when = event.eventAt ? new Date(event.eventAt.slice(0, 10) + 'T23:59:59').getTime() : 0;
  if (when > Date.now()) return 'Futuro';
  if (summary.milestones.some(step => step.phase === 'D+180' && step.status === 'Concluído')) return 'Finalizado';
  return 'Em mensuração';
}
function currentPhase(summary: RoiSummary): string { return phases.find(phase => summary.milestones.find(step => step.phase === phase)?.status !== 'Concluído') || 'D+180'; }

function OpportunityForm({ eventId, onClose, onSaved }: { eventId: string; onClose: () => void; onSaved: () => void }) {
  const [account, setAccount] = useState(''); const [amount, setAmount] = useState(''); const [stage, setStage] = useState('Aberta'); const [closeDate, setCloseDate] = useState(''); const [owner, setOwner] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api.addOpportunity({ eventId, account, amountCents: Math.round(Number(amount) * 100), stage, closeDate: closeDate || null, owner: owner || null }); onSaved(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao salvar oportunidade.'); } finally { setBusy(false); } }
  return <Drawer title="Nova oportunidade" onClose={onClose} footer={<><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" form="opportunity-form" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button></>}>
    {error && <div className="alert error">{error} Seus dados foram preservados.</div>}<form id="opportunity-form" onSubmit={save}><div className="form-grid"><div className="field wide"><label>Conta ou empresa</label><input required value={account} onChange={event => setAccount(event.target.value)}/></div><div className="field"><label>Valor (R$)</label><input type="number" min="0" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)}/></div><div className="field"><label>Estágio</label><select value={stage} onChange={event => setStage(event.target.value)}><option>Aberta</option><option>Em negociação</option><option>Fechada</option><option>Perdida</option></select></div><div className="field"><label>Data do fechamento</label><input type="date" value={closeDate} onChange={event => setCloseDate(event.target.value)}/></div><div className="field"><label>Responsável comercial</label><input value={owner} onChange={event => setOwner(event.target.value)}/></div></div></form>
  </Drawer>;
}

function RoiDetail({ summary, event, onClose, onChanged }: { summary: RoiSummary; event: MarketingRecord; onClose: () => void; onChanged: () => void }) {
  const [milestones, setMilestones] = useState<Milestone[]>(summary.milestones); const [opportunities, setOpportunities] = useState<Opportunity[]>([]); const [adding, setAdding] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api.eventMilestones<Milestone>(event.id).then(setMilestones).catch(() => {}); api.opportunities<Opportunity>(event.id).then(setOpportunities).catch(() => {}); }, [event.id]);
  async function update(step: Milestone, status: string) { try { await api.updateEventMilestone(event.id, step.phase, status, step.notes || ''); setMilestones(previous => previous.map(item => item.phase === step.phase ? { ...item, status } : item)); onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao atualizar o marco.'); } }
  return <><Drawer title={`ROI · ${event.title}`} onClose={onClose}>
    {error && <div className="alert error">{error}</div>}
    <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}><div className="card metric"><strong>{money(summary.investmentCents)}</strong><small>Investimento</small></div><div className="card metric"><strong>{money(summary.pipelineCents)}</strong><small>Pipeline</small></div><div className="card metric"><strong>{money(summary.revenueCents)}</strong><small>Receita fechada</small></div></div>
    <p className="notice">Evento em {dateLabel(event.eventAt)}. A receita mantém a data do fechamento e a atribuição a este evento.</p>
    <div className="section-title"><h2>Marcos de acompanhamento</h2></div><ol className="timeline">{phases.map(phase => { const step = milestones.find(item => item.phase === phase); return <li key={phase}><strong>{phase} <span className="muted" style={{ fontWeight: 400 }}>· {dateLabel(step?.due_at)}</span></strong><div className="horizontal" style={{ marginTop: 8 }}><select aria-label={`Status de ${phase}`} value={step?.status || 'Pendente'} onChange={change => step && update(step, change.target.value)} style={{ border: '1px solid #eadbdd', borderRadius: 7, padding: 7, fontSize: 11 }}><option>Pendente</option><option>Em andamento</option><option>Concluído</option></select></div>{step?.notes && <small>{step.notes}</small>}</li>; })}</ol>
    <div className="section-title"><h2>Oportunidades</h2><button className="link" onClick={() => setAdding(true)}><Plus size={13}/> Adicionar</button></div>{opportunities.length ? <div className="card table-wrap"><table className="data-table"><thead><tr><th>Conta</th><th>Valor</th><th>Estágio</th></tr></thead><tbody>{opportunities.map(item => <tr key={item.id}><td className="cell-title">{item.account}</td><td>{money(item.amount_cents)}</td><td><span className="pill">{item.stage}</span></td></tr>)}</tbody></table></div> : <p className="notice">Nenhuma oportunidade cadastrada para este evento.</p>}
  </Drawer>{adding && <OpportunityForm eventId={event.id} onClose={() => setAdding(false)} onSaved={() => { api.opportunities<Opportunity>(event.id).then(setOpportunities); onChanged(); }}/>}</>;
}

function CsvDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function importFile() { setBusy(true); setError(''); try { const result = await api.importRoiCsv(csv); setMessage(`${result.imported || 0} oportunidades importadas.`); onDone(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao importar CSV.'); } finally { setBusy(false); } }
  return <Drawer title="Importar dados comerciais" onClose={onClose} footer={<><button className="secondary" onClick={onClose}>Fechar</button><button className="primary" onClick={importFile} disabled={busy || !csv.trim() || Boolean(message)}>{busy ? 'Importando...' : 'Importar CSV'}</button></>}>
    <p className="notice">Colunas obrigatórias: event_id, external_id, account, amount_cents e stage. O valor deve ser informado em centavos. Colunas opcionais: close_date e owner.</p>{error && <div className="alert error">{error}</div>}{message && <div className="alert success">{message}</div>}
    <div className="field"><label>Arquivo CSV</label><input type="file" accept=".csv,text/csv" onChange={event => { const file = event.target.files?.[0]; if (file) file.text().then(setCsv); }}/></div><div className="field"><label>Prévia do conteúdo</label><textarea rows={8} value={csv} onChange={event => setCsv(event.target.value)} placeholder="event_id,external_id,account,amount_cents,stage"/></div>
  </Drawer>;
}

export function RoiScreen({ initialStatus = '' }: { initialStatus?: string }) {
  const [events, setEvents] = useState<MarketingRecord[]>([]); const [summaries, setSummaries] = useState<RoiSummary[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [filter, setFilter] = useState(initialStatus); const [query, setQuery] = useState(''); const [selected, setSelected] = useState<string | null>(null); const [importing, setImporting] = useState(false);
  function refresh() { setLoading(true); Promise.all([api.list('events'), api.roiSummary<RoiSummary>()]).then(([eventRows, summaryRows]) => { setEvents(eventRows); setSummaries(summaryRows); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar ROI.')).finally(() => setLoading(false)); }
  useEffect(refresh, []); useEffect(() => setFilter(initialStatus), [initialStatus]);
  const linked = useMemo(() => summaries.map(summary => ({ summary, event: events.find(item => item.id === summary.eventId) })).filter((pair): pair is { summary: RoiSummary; event: MarketingRecord } => Boolean(pair.event)), [events, summaries]);
  const visible = linked.filter(pair => (!filter || groupOf(pair.event, pair.summary) === filter) && pair.event.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const aggregate = linked.reduce((acc, pair) => ({ investment: acc.investment + pair.summary.investmentCents, pipeline: acc.pipeline + pair.summary.pipelineCents, revenue: acc.revenue + pair.summary.revenueCents, opportunities: acc.opportunities + pair.summary.opportunityCount }), { investment: 0, pipeline: 0, revenue: 0, opportunities: 0 });
  const detail = linked.find(pair => pair.event.id === selected);
  return <><div className="page-head"><div><div className="eyebrow">Retorno de eventos</div><h1>ROI</h1><p>Investimento, oportunidades e retorno ao longo de cada evento.</p></div><div className="head-actions"><button className="secondary" onClick={() => setImporting(true)}><Upload size={14}/> Importar CSV</button></div></div>{error && <div className="alert error">{error} <button className="link" onClick={refresh}>Tentar novamente</button></div>}
    <div className="metric-grid"><div className="card metric"><strong>{money(aggregate.investment)}</strong><small>Investimento</small></div><div className="card metric"><strong>{money(aggregate.pipeline)}</strong><small>Pipeline atribuído</small></div><div className="card metric"><strong>{money(aggregate.revenue)}</strong><small>Receita fechada</small></div><div className="card metric"><strong>{aggregate.opportunities}</strong><small>Oportunidades</small></div></div>
    <div className="toolbar"><div className="search"><input aria-label="Buscar evento" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar evento..."/></div><select aria-label="Filtrar estágio" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todos os estágios</option><option>Futuro</option><option>Em mensuração</option><option>Finalizado</option></select></div>
    {loading ? <div className="loading">Carregando ROI...</div> : visible.length === 0 ? <div className="card"><Empty title={linked.length ? 'Nenhum evento nesse estágio' : 'Nenhum evento para acompanhar'} body={linked.length ? 'Ajuste os filtros para consultar os eventos.' : 'Cadastre um evento para iniciar o Pré-ROI e seus marcos de acompanhamento.'}/></div> : <>{(['Futuro', 'Em mensuração', 'Finalizado'] as const).map(group => { const rows = visible.filter(pair => groupOf(pair.event, pair.summary) === group); return rows.length ? <section key={group}><h2 className="group-title">{group} <span className="muted">({rows.length})</span></h2><div className="card table-wrap"><table className="data-table"><thead><tr><th>Evento</th><th>Data</th><th>Fase atual</th><th>Investimento</th><th>Pipeline</th><th>Receita</th><th>Próxima ação</th></tr></thead><tbody>{rows.map(({ event, summary }) => { const phase = currentPhase(summary); const next = summary.milestones.find(item => item.phase === phase); return <tr key={event.id} className="clickable" onClick={() => setSelected(event.id)}><td className="cell-title">{event.title}</td><td>{dateLabel(event.eventAt)}</td><td><span className="pill">{phase}</span></td><td>{money(summary.investmentCents)}</td><td>{money(summary.pipelineCents)}</td><td>{money(summary.revenueCents)}</td><td>{next?.status === 'Em andamento' ? 'Concluir marco' : `Iniciar ${phase}`}{next?.due_at ? ` · ${dateLabel(next.due_at)}` : ''}</td></tr>; })}</tbody></table></div></section> : null; })}</>}
    {detail && <RoiDetail summary={detail.summary} event={detail.event} onClose={() => setSelected(null)} onChanged={refresh}/>}
    {importing && <CsvDrawer onClose={() => setImporting(false)} onDone={refresh}/>}
  </>;
}
