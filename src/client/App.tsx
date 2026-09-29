import { useEffect, useState } from 'react';
import { Activity, BarChart3, CalendarDays, ChevronRight, ClipboardList, FolderKanban, Home, LogOut, Menu, Package, Plus, RefreshCw, Search, Settings, Users } from 'lucide-react';
import { api, type DashboardData, type SearchResult, type Session } from './api';
import { AgencyScreen, EventsScreen, ProjectsScreen, ResultsScreen, RoiScreen, StockScreen, TasksScreen } from './screens';
import { SettingsScreen } from './settings';
import { AGENCY_STATUSES, EVENT_STATUSES, PROJECT_STATUSES, ROI_STATUSES, TASK_STATUSES, type MarketingRecord } from '../shared/types';

export type Page = 'home' | 'tasks' | 'projects' | 'events' | 'roi' | 'stock' | 'results' | 'agency' | 'settings';
const menu: Array<{ id: Page; title: string; icon: typeof Home }> = [
  { id: 'home', title: 'Início', icon: Home }, { id: 'tasks', title: 'Tarefas', icon: ClipboardList },
  { id: 'projects', title: 'Projetos e Campanhas', icon: FolderKanban }, { id: 'events', title: 'Eventos', icon: CalendarDays },
  { id: 'roi', title: 'ROI', icon: Activity }, { id: 'stock', title: 'Estoque', icon: Package },
  { id: 'results', title: 'Resultados', icon: BarChart3 }, { id: 'agency', title: 'Agência', icon: Users },
  { id: 'settings', title: 'Configurações', icon: Settings },
];

function pathPage(): Page {
  const path = window.location.pathname.replace(/^\//, '').split('/')[0];
  return menu.find(item => item.id === path)?.id || 'home';
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState('Marketing');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { onLogin(await api.login(username.trim(), password)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><form className="card login-box" onSubmit={submit}>
    <div className="brand"><span className="brandmark">N</span><span>Marketing OS<small>NETFIVE</small></span></div>
    <h1>Bem-vindo ao Marketing</h1><p>Entre para acompanhar tarefas, eventos e resultados em um só lugar.</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="field"><label htmlFor="username">Usuário</label><input id="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></div>
    <div className="field"><label htmlFor="password">Senha</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></div>
    <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>{busy ? 'Entrando...' : 'Entrar'}</button>
  </form></main>;
}

function StatusGroup({ title, statuses, counts, navigate }: { title: string; statuses: readonly string[]; counts?: Record<string, number>; navigate: (page: Page, status?: string) => void }) {
  const id = title === 'Tarefas' ? 'tasks' : title === 'Projetos e Campanhas' ? 'projects' : title === 'Eventos' ? 'events' : title === 'ROI' ? 'roi' : 'agency';
  return <><div className="section-title"><h2>{title}</h2><button className="link" onClick={() => navigate(id)}>Ver todos <ChevronRight size={12}/></button></div>
    <div className={`status-grid ${statuses.length <= 4 ? 'four' : ''}`}>{statuses.map((status, index) =>
      <button key={status} className="status-card" style={{ '--status': ['#d20000', '#e34242', '#ad0000', '#f07070', '#7f1d1d', '#c93636'][index % 6] } as React.CSSProperties} onClick={() => navigate(id, status)} aria-label={`${title}: ${status}, ${counts?.[status] || 0}`}>
        <div className="count">{counts?.[status] ?? 0}</div><div className="label">{status}</div>
      </button>)}</div></>;
}

function HomeScreen({ navigate, onNew }: { navigate: (page: Page, status?: string) => void; onNew: (page: Page) => void }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.dashboard().then(setDashboard).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar a Home.')); }, []);
  const counts = dashboard?.statusCounts || {};
  return <>
    <div className="page-head"><div><div className="eyebrow">Visão geral</div><h1>Como está o Marketing?</h1><p>Status, próximos prazos e pontos de atenção em um só lugar.</p></div><div className="head-actions"><button className="primary" onClick={() => onNew('tasks')}><Plus size={15}/> Nova tarefa</button></div></div>
    {error && <div className="alert error" role="alert">{error} <button className="link" onClick={() => window.location.reload()}>Tentar novamente</button></div>}
    {!dashboard && !error ? <div className="loading">Carregando dashboard...</div> : <>
      <StatusGroup title="Tarefas" statuses={TASK_STATUSES} counts={counts.tasks || counts.task} navigate={navigate}/>
      <StatusGroup title="Projetos e Campanhas" statuses={PROJECT_STATUSES} counts={counts.projects || counts.project} navigate={navigate}/>
      <StatusGroup title="Eventos" statuses={EVENT_STATUSES} counts={counts.events || counts.event} navigate={navigate}/>
      <div className="dashboard-columns" style={{ marginTop: 28 }}><section className="card panel"><h3>Próximos prazos e entregas</h3><div className="insight-list">
        {(dashboard?.upcomingTasks || []).length ? dashboard!.upcomingTasks!.slice(0, 6).map(item => <button className="insight-row link" key={item.id} onClick={() => navigate('tasks')}><strong>{item.title}</strong><small>{item.dueAt ? new Date(item.dueAt).toLocaleDateString('pt-BR') : 'Sem prazo'}</small></button>) : <span className="notice">Nenhuma tarefa com prazo próximo.</span>}
      </div></section><section className="card panel"><h3>Próximos eventos</h3><div className="insight-list">
        {(dashboard?.upcomingEvents || []).length ? dashboard!.upcomingEvents!.slice(0, 4).map(item => <button className="insight-row link" key={item.id} onClick={() => navigate('events')}><strong>{item.title}</strong><small>{item.eventAt ? new Date(item.eventAt).toLocaleDateString('pt-BR') : 'Sem data'}</small></button>) : <span className="notice">Nenhum evento futuro cadastrado.</span>}
      </div></section></div>
      <div className="dashboard-columns"><section className="card panel"><h3>Pontos de atenção</h3><div className="insight-list">{dashboard?.alerts && Object.values(dashboard.alerts).some(value => Number(value) > 0) ? <><button className="insight-row link" onClick={() => navigate('tasks')}><strong>Tarefas atrasadas</strong><small>{dashboard.alerts.overdueTasks || 0}</small></button><button className="insight-row link" onClick={() => navigate('roi')}><strong>Marcos de ROI pendentes</strong><small>{dashboard.alerts.pendingRoi || 0}</small></button><button className="insight-row link" onClick={() => navigate('stock')}><strong>Variações de estoque críticas</strong><small>{dashboard.alerts.criticalStock || 0}</small></button></> : <span className="notice">Sem alertas no momento.</span>}</div></section><section className="card panel"><h3>Ações rápidas</h3><div className="quick-grid"><button onClick={() => onNew('tasks')}>+ Nova tarefa</button><button onClick={() => onNew('projects')}>+ Novo projeto</button><button onClick={() => onNew('events')}>+ Novo evento</button><button onClick={() => navigate('stock')}>↗ Movimentar estoque</button></div></section></div>
      <StatusGroup title="ROI" statuses={ROI_STATUSES} counts={counts.roi} navigate={navigate}/>
      <StatusGroup title="Agência" statuses={AGENCY_STATUSES} counts={counts.agency} navigate={navigate}/>
    </>}
  </>;
}

function GlobalSearch({ navigate }: { navigate: (page: Page) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const timer = window.setTimeout(() => api.search(query).then(value => { setResults(value); setOpen(true); }).catch(() => setResults([])), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => { const reset = () => { setQuery(''); setOpen(false); }; window.addEventListener('marketing:navigate', reset); return () => window.removeEventListener('marketing:navigate', reset); }, []);
  const destination = (kind: string): Page => kind === 'task' ? 'tasks' : kind === 'project' ? 'projects' : kind === 'event' ? 'events' : kind === 'stock_item' ? 'stock' : 'roi';
  return <div className="global-search"><Search size={15}/><input aria-label="Busca global" value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setOpen(true)} placeholder="Buscar em todo o sistema..."/>{open && query.trim().length >= 2 && <div className="search-results">{results.length ? results.map(result => <button key={result.id} onClick={() => { navigate(destination(result.kind)); setQuery(''); setOpen(false); }}><strong>{result.title}</strong><small>{result.status}</small></button>) : <span>Nenhum resultado encontrado.</span>}</div>}</div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<Page>(pathPage);
  const [initialStatus, setInitialStatus] = useState('');
  const [newRequest, setNewRequest] = useState<Page | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sync, setSync] = useState<'ok' | 'pending' | 'error' | 'off'>('ok');
  useEffect(() => { api.session().then(setSession).catch(() => setSession({ authenticated: false })).finally(() => setChecking(false)); }, []);
  useEffect(() => { const handler = () => { setPage(pathPage()); setInitialStatus(new URLSearchParams(window.location.search).get('status') || ''); }; window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, []);
  useEffect(() => { if (!session?.authenticated) return; const refresh = () => api.sync().then(value => setSync(!value.configured ? 'off' : value.failed > 0 ? 'error' : value.pending > 0 ? 'pending' : 'ok')).catch(() => setSync('error')); refresh(); const timer = window.setInterval(refresh, 60000); return () => window.clearInterval(timer); }, [session?.authenticated]);
  function navigate(next: Page, status = '') { const url = `/${next}${status ? `?status=${encodeURIComponent(status)}` : ''}`; window.history.pushState(null, '', url); setPage(next); setInitialStatus(status); setNewRequest(null); setMobileOpen(false); window.dispatchEvent(new Event('marketing:navigate')); }
  function onNew(next: Page) { navigate(next); setNewRequest(next); }
  async function logout() { try { await api.logout(); } finally { setSession({ authenticated: false }); } }
  if (checking) return <div className="loading">Abrindo Marketing OS...</div>;
  if (!session?.authenticated) return <Login onLogin={setSession}/>;
  const current = menu.find(item => item.id === page)!;
  return <div className="app">
    {mobileOpen && <div className="mobile-shade" onClick={() => setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}><div className="brand"><span className="brandmark">N</span><span>Marketing OS<small>NETFIVE</small></span></div><div className="nav-label">Workspace</div><nav className="nav" aria-label="Menu principal">{menu.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span className="nav-icon"><item.icon size={18}/></span>{item.title}</button>)}</nav><div className="sidebar-foot"><div className="user-line"><div className="avatar">M</div><div>Marketing<div className="muted" style={{ fontSize: 10, fontWeight: 500 }}>Netfive</div></div></div>{!session.authenticationDisabled && <button onClick={logout}><LogOut size={12} style={{ verticalAlign: 'middle' }}/> Sair</button>}</div></aside>
    <main className="main"><header className="topbar"><div className="horizontal"><button className="mobile-toggle" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu size={22}/></button><div className="crumb">Marketing OS <ChevronRight size={12} style={{ verticalAlign: 'middle' }}/> <strong>{current.title}</strong></div></div><GlobalSearch navigate={navigate}/><div className="top-actions"><button className="sync-status" style={{ border: 0, background: 'transparent' }} onClick={async () => { if (sync === 'error') { try { await api.retrySync(); setSync('pending'); } catch { setSync('error'); } } }} title={sync === 'error' ? 'Tentar sincronizar novamente' : undefined}><span className={`sync-dot ${sync === 'ok' ? '' : sync}`}/>{sync === 'ok' ? 'Sincronizado' : sync === 'pending' ? 'Sincronização pendente' : sync === 'off' ? 'Notion não configurado' : 'Erro na sincronização · tentar novamente'}</button><button className="secondary" onClick={() => window.location.reload()} title="Atualizar dados"><RefreshCw size={14}/> Atualizar</button></div></header><div className="content">
      {page === 'home' && <HomeScreen navigate={navigate} onNew={onNew}/>}
      {page === 'tasks' && <TasksScreen initialStatus={initialStatus} newRequest={newRequest === 'tasks'} clearNew={() => setNewRequest(null)}/>}
      {page === 'projects' && <ProjectsScreen initialStatus={initialStatus} newRequest={newRequest === 'projects'} clearNew={() => setNewRequest(null)}/>}
      {page === 'events' && <EventsScreen initialStatus={initialStatus} newRequest={newRequest === 'events'} clearNew={() => setNewRequest(null)}/>}
      {page === 'roi' && <RoiScreen initialStatus={initialStatus}/>}
      {page === 'stock' && <StockScreen/>}
      {page === 'results' && <ResultsScreen/>}
      {page === 'agency' && <AgencyScreen initialStatus={initialStatus}/>}
      {page === 'settings' && <SettingsScreen/>}
    </div></main>
  </div>;
}
