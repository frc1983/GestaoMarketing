import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Download, ExternalLink, Filter, Image as ImageIcon, List, Plus, Search, Upload, X } from 'lucide-react';
import { api } from './api';
import { AGENCY_STATUSES, EVENT_STATUSES, PROJECT_STATUSES, ROI_STATUSES, TASK_STATUSES, type MarketingRecord } from '../shared/types';
import { StockScreen } from './stock';
import { RoiScreen } from './roi';

export { StockScreen, RoiScreen };

type ScreenProps = { initialStatus?: string; newRequest?: boolean; clearNew?: () => void };
type Resource = 'tasks' | 'projects' | 'events';
type FieldName = 'title' | 'status' | 'owner' | 'dueAt' | 'eventAt' | 'projectId' | 'eventId' | 'agencyStatus';
type Field = { key: string; label: string; type?: 'text' | 'date' | 'number' | 'select' | 'textarea'; options?: readonly string[]; wide?: boolean };
const categories = ['Social Media', 'Eventos', 'CRM', 'Campanhas', 'Endomarketing', 'Site', 'Materiais', 'Comercial', 'Institucional', 'Agência'];
const projectTypes = ['Campanha', 'Evento', 'Vídeo', 'Outro'];
const phaseTemplates: Record<string, string[]> = {
  Campanha: ['Planejamento', 'Conteúdo', 'Design', 'Aprovação', 'Programação', 'Publicação', 'Métricas'],
  Evento: ['Planejamento', 'Budget', 'Contratação', 'Comunicação', 'Materiais', 'Logística', 'Execução', 'Pós-evento', 'ROI'],
  Vídeo: ['Pauta', 'Roteiro', 'Aprovação', 'Gravação', 'Edição', 'Aprovação final', 'Publicação'],
};
const specs: Record<Resource, { title: string; description: string; singular: string; statuses: readonly string[]; fields: Field[] }> = {
  tasks: { title: 'Tarefas', description: 'Acompanhe a operação diária e os próximos prazos.', singular: 'tarefa', statuses: TASK_STATUSES, fields: [
    { key: 'title', label: 'Título', wide: true }, { key: 'status', label: 'Status', type: 'select', options: TASK_STATUSES }, { key: 'owner', label: 'Responsável' },
    { key: 'dueAt', label: 'Prazo', type: 'date' }, { key: 'priority', label: 'Prioridade', type: 'select', options: ['Baixa', 'Média', 'Alta', 'Urgente'] },
    { key: 'category', label: 'Categoria', type: 'select', options: categories }, { key: 'requester', label: 'Solicitante' },
    { key: 'projectId', label: 'Projeto relacionado' }, { key: 'eventId', label: 'Evento relacionado' }, { key: 'agencyStatus', label: 'Status na agência', type: 'select', options: ['', ...AGENCY_STATUSES] },
    { key: 'notes', label: 'Observações', type: 'textarea', wide: true },
  ] },
  projects: { title: 'Projetos e Campanhas', description: 'Veja a fase, o progresso e as pendências de cada iniciativa.', singular: 'projeto', statuses: PROJECT_STATUSES, fields: [
    { key: 'title', label: 'Nome do projeto', wide: true }, { key: 'type', label: 'Modelo', type: 'select', options: projectTypes },
    { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUSES }, { key: 'owner', label: 'Responsável' },
    { key: 'dueAt', label: 'Prazo', type: 'date' }, { key: 'notes', label: 'Descrição', type: 'textarea', wide: true },
  ] },
  events: { title: 'Eventos', description: 'Planejamento, execução e retorno de cada evento.', singular: 'evento', statuses: EVENT_STATUSES, fields: [
    { key: 'title', label: 'Nome do evento', wide: true }, { key: 'eventAt', label: 'Data', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: EVENT_STATUSES },
    { key: 'owner', label: 'Responsável' }, { key: 'location', label: 'Local' }, { key: 'partner', label: 'Fabricante ou parceiro' },
    { key: 'participationType', label: 'Tipo de participação' }, { key: 'audience', label: 'Público e objetivo', wide: true },
    { key: 'budgetPlanned', label: 'Budget previsto (R$)', type: 'number' }, { key: 'budgetActual', label: 'Budget realizado (R$)', type: 'number' },
    { key: 'notes', label: 'Observações', type: 'textarea', wide: true },
  ] },
};

function datum(record: MarketingRecord, key: string): string {
  const base = record as unknown as Record<string, unknown>;
  const value = key in base ? base[key] : record.data?.[key];
  return value == null ? '' : String(value);
}
function dateLabel(value: string | null | undefined) { if (!value) return 'Sem data'; const d = new Date(value.includes('T') ? value : `${value}T12:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('pt-BR'); }
function money(value: unknown) { const number = Number(value || 0); return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number); }
function initialForm(resource: Resource, record?: MarketingRecord): Record<string, string> {
  const fields = specs[resource].fields;
  return Object.fromEntries(fields.map(field => [field.key, record ? (field.key === 'type' ? String(record.data.template || 'Campanha') : field.key === 'budgetActual' ? String(record.data.actualBudget || '') : datum(record, field.key)).slice(0, field.type === 'date' ? 10 : undefined) : field.key === 'status' ? specs[resource].statuses[0] : field.key === 'type' ? 'Campanha' : '']));
}
function payload(resource: Resource, values: Record<string, string>, record?: MarketingRecord) {
  const baseKeys = ['title', 'status', 'owner', 'dueAt', 'eventAt', 'projectId', 'eventId', 'agencyStatus'];
  const data = { ...(record?.data || {}) } as Record<string, unknown>;
  for (const field of specs[resource].fields) if (!baseKeys.includes(field.key)) data[field.key] = field.type === 'number' ? Number(values[field.key] || 0) : values[field.key] || '';
  if (resource === 'projects') data.template = values.type || 'Campanha';
  if (resource === 'events') data.actualBudget = Number(values.budgetActual || 0);
  return { title: values.title, status: values.status, owner: values.owner || null, dueAt: values.dueAt || null, eventAt: values.eventAt || null,
    projectId: values.projectId || null, eventId: values.eventId || null, agencyStatus: values.agencyStatus || null, data };
}

export function Empty({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="empty"><div className="empty-icon"><List size={22}/></div><strong>{title}</strong><p>{body}</p>{action && onAction && <button className="primary" onClick={onAction}><Plus size={14}/>{action}</button>}</div>;
}
export function Drawer({ title, children, onClose, footer }: { title: string; children: React.ReactNode; onClose: () => void; footer?: React.ReactNode }) {
  return <><div className="drawer-backdrop" onClick={onClose}/><section className="drawer" role="dialog" aria-modal="true" aria-label={title}><div className="drawer-head"><h2>{title}</h2><button className="drawer-close" onClick={onClose} aria-label="Fechar"><X size={22}/></button></div><div className="drawer-body">{children}</div>{footer && <div className="drawer-foot">{footer}</div>}</section></>;
}

function RecordForm({ resource, record, onSaved, onClose }: { resource: Resource; record?: MarketingRecord; onSaved: () => void; onClose: () => void }) {
  const [values, setValues] = useState(() => initialForm(resource, record));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try {
    const body = payload(resource, values, record);
    if (record) await api.update(resource, record.id, body); else await api.create(resource, body);
    onSaved(); onClose();
  } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao salvar.'); } finally { setBusy(false); } }
  return <Drawer title={record ? `Editar ${specs[resource].singular}` : `Nova ${specs[resource].singular}`} onClose={onClose} footer={<><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" form="record-form" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button></>}>
    {error && <div className="alert error" role="alert">{error} Seus dados foram preservados.</div>}
    <form id="record-form" onSubmit={save}><div className="form-grid">{specs[resource].fields.map(field => <div className={`field ${field.wide ? 'wide' : ''}`} key={field.key}><label htmlFor={`field-${field.key}`}>{field.label}</label>
      {field.type === 'textarea' ? <textarea id={`field-${field.key}`} value={values[field.key] || ''} onChange={event => setValues({ ...values, [field.key]: event.target.value })}/> : field.type === 'select' ? <select id={`field-${field.key}`} value={values[field.key] || ''} onChange={event => setValues({ ...values, [field.key]: event.target.value })}>{field.options?.map(option => <option value={option} key={option}>{option || 'Nenhum'}</option>)}</select> : <input id={`field-${field.key}`} type={field.type || 'text'} min={field.type === 'number' ? 0 : undefined} step={field.type === 'number' ? '0.01' : undefined} value={values[field.key] || ''} onChange={event => setValues({ ...values, [field.key]: event.target.value })} required={field.key === 'title'}/>}</div>)}</div></form>
  </Drawer>;
}

function RecordDetails({ resource, record, onEdit, onClose, onUpdated }: { resource: Resource; record: MarketingRecord; onEdit: () => void; onClose: () => void; onUpdated: () => void }) {
  const [error, setError] = useState('');
  const [phases, setPhases] = useState<Array<{ id: string; name: string; status: string }>>([]);
  useEffect(() => { if (resource === 'projects') api.projectPhases<{ id: string; name: string; status: string }>(record.id).then(setPhases).catch(() => setError('Falha ao carregar as fases.')); }, [resource, record.id]);
  async function phaseChange(id: string, status: string) { try { await api.updateProjectPhase(record.id, id, status); setPhases(previous => previous.map(phase => phase.id === id ? { ...phase, status } : phase)); onUpdated(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao atualizar fase.'); } }
  return <Drawer title={record.title} onClose={onClose} footer={<button className="primary" onClick={onEdit}>Editar</button>}>
    {error && <div className="alert error">{error}</div>}<div className="detail-list"><div className="detail-row"><dt>Status</dt><dd><span className="pill">{record.status}</span></dd></div>
      {specs[resource].fields.filter(field => !['title', 'status'].includes(field.key)).map(field => { const value = datum(record, field.key); return value ? <div className="detail-row" key={field.key}><dt>{field.label}</dt><dd>{field.type === 'date' ? dateLabel(value) : field.type === 'number' ? money(value) : value}</dd></div> : null; })}</div>
    {resource === 'projects' && phases.length > 0 && <><div className="section-title"><h2>Fases</h2><small className="muted">{Math.round(phases.filter(phase => phase.status === 'Concluído').length / phases.length * 100)}% concluído</small></div><ol className="timeline">{phases.map(phase => <li key={phase.id}><strong>{phase.name}</strong><select style={{ width: 'auto', marginTop: 7, border: '1px solid #dfe9e5', borderRadius: 6, padding: 5 }} value={phase.status} onChange={event => phaseChange(phase.id, event.target.value)}><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select></li>)}</ol></>}
  </Drawer>;
}

function RecordScreen({ resource, initialStatus = '', newRequest, clearNew }: ScreenProps & { resource: Resource }) {
  const spec = specs[resource]; const [records, setRecords] = useState<MarketingRecord[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(initialStatus); const [view, setView] = useState(resource === 'tasks' ? 'kanban' : resource === 'events' ? 'list' : 'cards');
  const [selected, setSelected] = useState<MarketingRecord | null>(null); const [editing, setEditing] = useState<MarketingRecord | null>(null); const [creating, setCreating] = useState(false); const [year, setYear] = useState('');
  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);
  useEffect(() => { if (newRequest) { setCreating(true); clearNew?.(); } }, [newRequest, clearNew]);
  function refresh() { setLoading(true); api.list(resource).then(setRecords).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar os dados.')).finally(() => setLoading(false)); }
  useEffect(refresh, [resource]);
  const filtered = useMemo(() => records.filter(item => (!status || item.status === status) && (!search || `${item.title} ${item.owner || ''} ${JSON.stringify(item.data || {})}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) && (resource !== 'events' || !year || (item.eventAt || '').slice(0, 4) === year)), [records, status, search, resource, year]);
  const years = [...new Set(records.map(item => (item.eventAt || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  async function move(item: MarketingRecord, nextStatus: string) { if (item.status === nextStatus) return; try { const updated = await api.update(resource, item.id, { status: nextStatus }); setRecords(previous => previous.map(row => row.id === item.id ? updated : row)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao alterar status.'); } }
  function open(item: MarketingRecord) { setSelected(item); }
  function closeAndRefresh() { setSelected(null); setEditing(null); setCreating(false); refresh(); }
  return <><div className="page-head"><div><div className="eyebrow">Operação</div><h1>{spec.title}</h1><p>{spec.description}</p></div><div className="head-actions"><button className="primary" onClick={() => setCreating(true)}><Plus size={15}/> Novo {spec.singular}</button></div></div>
    {error && <div className="alert error" role="alert">{error} <button className="link" onClick={refresh}>Tentar novamente</button></div>}
    <div className="toolbar"><div className="search"><input aria-label="Buscar" placeholder={`Buscar ${spec.title.toLocaleLowerCase('pt-BR')}...`} value={search} onChange={event => setSearch(event.target.value)}/></div>
      <select aria-label="Filtrar por status" value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos os status</option>{spec.statuses.map(value => <option key={value}>{value}</option>)}</select>
      {resource === 'events' && <select aria-label="Filtrar por ano" value={year} onChange={event => setYear(event.target.value)}><option value="">Todos os anos</option>{years.map(value => <option key={value}>{value}</option>)}</select>}
      <div className="segmented" role="group" aria-label="Visualização">{(resource === 'tasks' ? [['kanban', 'Kanban'], ['list', 'Lista']] : resource === 'events' ? [['list', 'Lista'], ['calendar', 'Calendário']] : [['cards', 'Cartões'], ['list', 'Lista']]).map(([key, label]) => <button key={key} className={view === key ? 'selected' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
    </div>
    {loading ? <div className="loading">Carregando...</div> : filtered.length === 0 ? <div className="card"><Empty title={records.length ? 'Nenhum resultado para os filtros' : `Nenhum ${spec.singular} cadastrado`} body={records.length ? 'Ajuste a busca ou os filtros para encontrar registros.' : `Comece criando o primeiro ${spec.singular} do Marketing.`} action={records.length ? undefined : `Novo ${spec.singular}`} onAction={() => setCreating(true)}/></div> :
      view === 'kanban' ? <div className="kanban">{spec.statuses.map(column => <div className="kanban-col" key={column} onDragOver={event => event.preventDefault()} onDrop={event => { const id = event.dataTransfer.getData('text/plain'); const item = records.find(row => row.id === id); if (item) move(item, column); }}><div className="kanban-head"><span>{column}</span><span>{filtered.filter(item => item.status === column).length}</span></div>{filtered.filter(item => item.status === column).map(item => <div className="kanban-card clickable" draggable onDragStart={event => event.dataTransfer.setData('text/plain', item.id)} key={item.id} onClick={() => open(item)} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') open(item); }}><strong>{item.title}</strong><div className="kanban-meta"><span>{item.owner || 'Sem responsável'}</span><span>{dateLabel(item.dueAt)}</span></div><div style={{ marginTop: 9 }}><select aria-label={`Status de ${item.title}`} value={item.status} onClick={event => event.stopPropagation()} onChange={event => { event.stopPropagation(); move(item, event.target.value); }} style={{ maxWidth: '100%', fontSize: 10, border: '1px solid #e6eeea', borderRadius: 6, padding: 5 }}>{spec.statuses.map(value => <option key={value}>{value}</option>)}</select></div></div>)}{!filtered.some(item => item.status === column) && <div className="kanban-empty">Nenhum item</div>}</div>)}</div> :
      view === 'cards' ? <div className="record-grid">{filtered.map(item => { const progress = Number(item.data.progress || 0); return <div className="card record-card" key={item.id} onClick={() => open(item)} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') open(item); }}><span className="pill">{item.status}</span><h3>{item.title}</h3><p>{item.owner || 'Sem responsável'} · {dateLabel(item.dueAt)}</p><div className="progress"><span style={{ width: `${progress}%` }}/></div><div className="record-footer"><span>{progress}% das fases</span><span>Ver projeto →</span></div></div>; })}</div> :
      view === 'calendar' ? <EventCalendar records={filtered} onOpen={open}/> :
      <div className="card table-wrap"><table className="data-table"><thead><tr><th>{resource === 'events' ? 'Evento' : 'Nome'}</th><th>Status</th><th>Responsável</th><th>{resource === 'events' ? 'Data' : 'Prazo'}</th>{resource === 'events' && <th>Local</th>}</tr></thead><tbody>{filtered.map(item => <tr key={item.id} className="clickable" onClick={() => open(item)}><td className="cell-title">{item.title}</td><td><span className="pill">{item.status}</span></td><td>{item.owner || '—'}</td><td>{dateLabel(resource === 'events' ? item.eventAt : item.dueAt)}</td>{resource === 'events' && <td>{datum(item, 'location') || '—'}</td>}</tr>)}</tbody></table></div>}
    {selected && !editing && <RecordDetails resource={resource} record={selected} onEdit={() => setEditing(selected)} onClose={() => setSelected(null)} onUpdated={closeAndRefresh}/>}
    {(creating || editing) && <RecordForm key={editing?.id || `new-${resource}`} resource={resource} record={editing || undefined} onClose={() => { setCreating(false); setEditing(null); }} onSaved={closeAndRefresh}/>}
  </>;
}

function EventCalendar({ records, onOpen }: { records: MarketingRecord[]; onOpen: (record: MarketingRecord) => void }) {
  const [month, setMonth] = useState(() => { const date = records.find(record => record.eventAt)?.eventAt; return date ? date.slice(0, 7) : new Date().toISOString().slice(0, 7); });
  const [year, monthNumber] = month.split('-').map(Number); const first = new Date(year, monthNumber - 1, 1).getDay(); const days = new Date(year, monthNumber, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, index) => index - first + 1);
  function shift(value: number) { const date = new Date(year, monthNumber - 1 + value, 1); setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`); }
  return <div className="card" style={{ overflow: 'hidden' }}><div className="panel horizontal"><button className="secondary" onClick={() => shift(-1)}>‹</button><strong style={{ textTransform: 'capitalize', fontSize: 13 }}>{new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong><button className="secondary" onClick={() => shift(1)}>›</button></div><div className="calendar">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => <div className="day-head" key={day}>{day}</div>)}{cells.map((day, index) => { const date = day > 0 && day <= days ? `${month}-${String(day).padStart(2, '0')}` : ''; return <div key={index}><span className="date">{date ? day : ''}</span>{records.filter(record => record.eventAt?.slice(0, 10) === date).map(record => <button className="event-chip" onClick={() => onOpen(record)} key={record.id}>{record.title}</button>)}</div>; })}</div></div>;
}

export function TasksScreen(props: ScreenProps) { return <RecordScreen resource="tasks" {...props}/>; }
export function ProjectsScreen(props: ScreenProps) { return <RecordScreen resource="projects" {...props}/>; }
export function EventsScreen(props: ScreenProps) { return <RecordScreen resource="events" {...props}/>; }

export function ResultsScreen() {
  const [result, setResult] = useState<Record<string, unknown> | null>(null); const [error, setError] = useState('');
  useEffect(() => { api.results().then(setResult).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar resultados.')); }, []);
  const metrics = [ ['Tarefas concluídas', 'tasksCompleted'], ['Eventos trabalhados', 'eventsWorked'], ['Entregas no prazo', 'onTimePercent'] ];
  return <><div className="page-head"><div><div className="eyebrow">Indicadores</div><h1>Resultados</h1><p>Volume de entregas e capacidade operacional do Marketing.</p></div></div>{error && <div className="alert error">{error}</div>}{!result && !error ? <div className="loading">Carregando resultados...</div> : <><div className="metric-grid">{metrics.map(([label, key]) => <div className="card metric" key={key}><strong>{result?.[key] == null ? '—' : `${result[key]}${key === 'onTimePercent' ? '%' : ''}`}</strong><small>{label}</small></div>)}</div><div className="card"><Empty title="Indicadores do período" body="Os dados aparecem conforme tarefas, eventos e entregas forem registrados no sistema."/></div></>}</>;
}

export function AgencyScreen({ initialStatus = '' }: ScreenProps) {
  const [tasks, setTasks] = useState<MarketingRecord[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialStatus); const [selected, setSelected] = useState<MarketingRecord | null>(null);
  useEffect(() => { setFilter(initialStatus); }, [initialStatus]);
  function refresh() { setLoading(true); api.list('tasks').then(items => setTasks(items.filter(item => item.agencyStatus || item.data?.agency))).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar demandas.')).finally(() => setLoading(false)); }
  useEffect(refresh, []);
  async function move(item: MarketingRecord, status: string) { try { await api.update('tasks', item.id, { agencyStatus: status }); refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao alterar a demanda.'); } }
  const visible = filter ? tasks.filter(item => item.agencyStatus === filter) : tasks;
  return <><div className="page-head"><div><div className="eyebrow">Parceiros</div><h1>Agência</h1><p>Demandas compartilhadas com a agência, reunidas a partir das tarefas.</p></div></div>{error && <div className="alert error">{error}</div>}
    <div className="toolbar"><select aria-label="Filtrar status" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todos os status</option>{AGENCY_STATUSES.map(value => <option key={value}>{value}</option>)}</select></div>
    {loading ? <div className="loading">Carregando demandas...</div> : visible.length === 0 ? <div className="card"><Empty title="Sem demandas da agência" body="Vincule uma tarefa à agência para acompanhá-la aqui."/></div> : <div className="kanban">{AGENCY_STATUSES.map(status => <div className="kanban-col" key={status}><div className="kanban-head"><span>{status}</span><span>{visible.filter(item => item.agencyStatus === status).length}</span></div>{visible.filter(item => item.agencyStatus === status).map(item => <div className="kanban-card" key={item.id}><strong className="clickable" onClick={() => setSelected(item)}>{item.title}</strong><div className="kanban-meta"><span>{item.owner || 'Sem responsável'}</span><span>{dateLabel(item.dueAt)}</span></div><select aria-label={`Status da agência para ${item.title}`} value={item.agencyStatus || ''} onChange={event => move(item, event.target.value)} style={{ marginTop: 9, width: '100%', border: '1px solid #e6eeea', borderRadius: 6, padding: 5, fontSize: 10 }}>{AGENCY_STATUSES.map(value => <option key={value}>{value}</option>)}</select></div>)}{!visible.some(item => item.agencyStatus === status) && <div className="kanban-empty">Nenhuma demanda</div>}</div>)}</div>}
    {selected && <Drawer title={selected.title} onClose={() => setSelected(null)}><div className="detail-list"><div className="detail-row"><dt>Status</dt><dd>{selected.agencyStatus || '—'}</dd></div><div className="detail-row"><dt>Responsável</dt><dd>{selected.owner || '—'}</dd></div><div className="detail-row"><dt>Prazo</dt><dd>{dateLabel(selected.dueAt)}</dd></div></div></Drawer>}
  </>;
}
