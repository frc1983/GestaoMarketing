import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api, type AppSettings } from './api';

const defaults: Required<Pick<AppSettings, 'owners' | 'categories' | 'priorities'>> = {
  owners: ['Juliana', 'Estefani'],
  categories: ['Social Media', 'Eventos', 'CRM', 'Campanhas', 'Endomarketing', 'Site', 'Materiais', 'Comercial', 'Institucional', 'Agência'],
  priorities: ['Baixa', 'Média', 'Alta', 'Urgente'],
};

function lines(value: string[]): string { return value.join('\n'); }
function parseLines(value: string): string[] { return [...new Set(value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean))]; }

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>({});
  const [owners, setOwners] = useState(lines(defaults.owners));
  const [categories, setCategories] = useState(lines(defaults.categories));
  const [priorities, setPriorities] = useState(lines(defaults.priorities));
  const [agencyUrl, setAgencyUrl] = useState('');
  const [notionSources, setNotionSources] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.settings().then(value => {
    setSettings(value);
    setOwners(lines(value.owners?.length ? value.owners : defaults.owners));
    setCategories(lines(value.categories?.length ? value.categories : defaults.categories));
    setPriorities(lines(value.priorities?.length ? value.priorities : defaults.priorities));
    setAgencyUrl(value.agencyUrl || '');
    setNotionSources(value.notionSources || {});
  }).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar configurações.')); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const next: AppSettings = { owners: parseLines(owners), categories: parseLines(categories), priorities: parseLines(priorities), agencyUrl: agencyUrl.trim(), notionSources };
    try {
      await Promise.all((Object.keys(next) as Array<keyof AppSettings>).map(key => api.updateSetting(key, next[key] as never)));
      setSettings(next); setMessage('Configurações salvas.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-head"><div><div className="eyebrow">Administração</div><h1>Configurações</h1><p>Cadastros auxiliares e conexões usadas pelo Marketing OS.</p></div></div>
    {error && <div className="alert error" role="alert">{error}</div>}{message && <div className="alert success" role="status">{message}</div>}
    <form onSubmit={save} className="settings-grid">
      <section className="card panel"><h3>Operação</h3><div className="field"><label>Responsáveis</label><textarea value={owners} onChange={event => setOwners(event.target.value)}/><small>Um nome por linha.</small></div><div className="field"><label>Prioridades</label><textarea value={priorities} onChange={event => setPriorities(event.target.value)}/></div></section>
      <section className="card panel"><h3>Categorias</h3><div className="field"><label>Categorias de tarefas</label><textarea style={{ minHeight: 210 }} value={categories} onChange={event => setCategories(event.target.value)}/><small>Um nome por linha.</small></div></section>
      <section className="card panel"><h3>Agência</h3><div className="field"><label>Link do painel da agência</label><input type="url" placeholder="https://www.notion.so/..." value={agencyUrl} onChange={event => setAgencyUrl(event.target.value)}/></div></section>
      <section className="card panel"><h3>Notion</h3><p className="notice">Informe os IDs dos data sources. O token da integração permanece protegido nos secrets do Cloudflare.</p>{[['tasks','Tarefas'],['projects','Projetos'],['events','Eventos'],['roi','ROI'],['stock','Estoque']].map(([key,label]) => <div className="field" key={key}><label>{label}</label><input value={notionSources[key] || ''} onChange={event => setNotionSources(current => ({ ...current, [key]: event.target.value.trim() }))} placeholder="data_source_id"/></div>)}</section>
      <div className="settings-actions"><button className="primary" disabled={busy}><Save size={15}/>{busy ? 'Salvando...' : 'Salvar configurações'}</button>{settings.owners && <span className="notice">Configuração carregada do banco.</span>}</div>
    </form>
  </>;
}
