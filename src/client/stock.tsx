import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Image as ImageIcon, Package, Plus, Upload } from 'lucide-react';
import { api } from './api';
import { Drawer, Empty } from './screens';
import { readStockWorkbook, type StockImportItem } from './importExcel';
import type { MarketingRecord } from '../shared/types';

interface Variant { id: string; itemId: string; name: string; minimum: number; onHand: number; reserved: number; available: number }
interface StockItem extends MarketingRecord { variants: Variant[]; imageUrl?: string; photos?: string[] }
interface HistoryRow { id: string; variant_id: string; quantity: number; reason: string; requester?: string; event_id?: string; client?: string; created_at: string }

function totals(item: StockItem) { return (item.variants || []).reduce((acc, part) => ({ onHand: acc.onHand + part.onHand, reserved: acc.reserved + part.reserved, available: acc.available + part.available, minimum: acc.minimum + part.minimum }), { onHand: 0, reserved: 0, available: 0, minimum: 0 }); }

function ImportDrawer({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [items, setItems] = useState<StockImportItem[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function load(next: File) { setFile(next); setBusy(true); setError(''); setItems([]); try { setItems(await readStockWorkbook(next)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível ler a planilha.'); } finally { setBusy(false); } }
  function updateItem(index: number, change: Partial<StockImportItem>) { setItems(current => current.map((item, at) => at === index ? { ...item, ...change } : item)); }
  function updateRow(itemIndex: number, rowIndex: number, field: 'quantity' | 'minimum', value: number | null) { setItems(current => current.map((item, at) => at !== itemIndex ? item : { ...item, rows: item.rows.map((row, rowAt) => rowAt !== rowIndex ? row : { ...row, [field]: value, pending: field === 'quantity' && value != null ? [] : row.pending }) })); }
  const importable = items.filter(item => item.name.trim() && item.rows.every(row => row.quantity != null && Number.isInteger(row.quantity) && row.quantity >= 0));
  const pending = items.length - importable.length;
  async function confirm() { if (!file || !importable.length) return; setBusy(true); setError(''); setMessage(''); try {
    const bytes = await file.arrayBuffer(); const hash = await crypto.subtle.digest('SHA-256', bytes); const fingerprint = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
    const result = await api.importStock(fingerprint, importable.map(item => ({ name: item.name, variants: item.rows.map(row => ({ name: row.variant || 'Padrão', quantity: row.quantity, minimum: row.minimum })) })));
    let photoFailures = 0;
    for (const [index, item] of importable.entries()) {
      const photo = item.photos[item.selectedPhoto]; const id = result.items?.[index]?.id;
      if (photo && id) try { await api.uploadImage(id, photo.file); } catch { photoFailures++; }
    }
    setMessage(`${result.imported} itens importados.${pending ? ` ${pending} item(ns) pendente(s) ficaram fora da carga.` : ''}${photoFailures ? ` ${photoFailures} foto(s) precisam ser enviadas novamente.` : ''}`);
    onImported();
  } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao importar.'); } finally { setBusy(false); } }
  return <Drawer title="Importar estoque do Excel" onClose={onClose} footer={<><button className="secondary" onClick={onClose}>{message ? 'Fechar' : 'Cancelar'}</button><button className="primary" disabled={busy || !importable.length || Boolean(message)} onClick={confirm}>{busy ? 'Importando...' : `Importar ${importable.length} item(ns)`}</button></>}>
    <p className="notice">Selecione a planilha com Brinde, Tamanho, Quant. e Imagem. Revise nomes, quantidades e fotos antes de confirmar.</p>
    {error && <div className="alert error" role="alert">{error}</div>}{message && <div className="alert success" role="status">{message}</div>}
    <div className="file-input"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Selecionar planilha Excel" onChange={event => { const next = event.target.files?.[0]; if (next) load(next); }}/></div>
    {busy && <div className="loading">Processando planilha...</div>}
    {items.length > 0 && <><div className="section-title"><h2>Prévia da importação</h2><small>{importable.length} prontos · {pending} pendentes</small></div>{items.map((item, index) => <section className="card import-step" key={`${item.name}-${index}`}>
      <div className="horizontal" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><div><strong style={{ fontSize: 12 }}>{item.name}</strong><div className="notice" style={{ margin: '5px 0' }}>{item.rows.length} variação(ões) · {item.photos.length} foto(s)</div></div>{item.rows.some(row => row.quantity == null) && <span className="pill warn">Conferir quantidade</span>}</div>
      {item.photos.length > 0 && <div className="horizontal" style={{ flexWrap: 'wrap', margin: '8px 0 15px' }}>{item.photos.map((photo, photoIndex) => <label key={photo.url} style={{ border: item.selectedPhoto === photoIndex ? '2px solid #d20000' : '2px solid transparent', borderRadius: 9, padding: 3, cursor: 'pointer' }}><input type="radio" name={`photo-${index}`} checked={item.selectedPhoto === photoIndex} onChange={() => updateItem(index, { selectedPhoto: photoIndex })} style={{ position: 'absolute', opacity: 0 }}/><img src={photo.url} alt={`Foto ${photoIndex + 1} de ${item.name}`} style={{ width: 58, height: 58, borderRadius: 6, objectFit: 'cover' }}/></label>)}</div>}
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Linha</th><th>Tamanho</th><th>Quantidade</th><th>Mínimo</th></tr></thead><tbody>{item.rows.map((row, rowIndex) => <tr key={row.row}><td>{row.row}</td><td>{row.variant || 'Padrão'}</td><td><input aria-label={`Quantidade de ${item.name} ${row.variant}`} type="number" min="0" step="1" value={row.quantity ?? ''} placeholder={row.rawQuantity || 'Conferir'} onChange={event => updateRow(index, rowIndex, 'quantity', event.target.value === '' ? null : Number(event.target.value))} style={{ width: 84, padding: 6, border: '1px solid #eadbdd', borderRadius: 6 }}/></td><td><input aria-label={`Mínimo de ${item.name} ${row.variant}`} type="number" min="0" step="1" value={row.minimum} onChange={event => updateRow(index, rowIndex, 'minimum', Number(event.target.value))} style={{ width: 84, padding: 6, border: '1px solid #eadbdd', borderRadius: 6 }}/></td></tr>)}</tbody></table></div>
    </section>)}</>}
  </Drawer>;
}

function NewItemDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(''); const [variant, setVariant] = useState('Padrão'); const [quantity, setQuantity] = useState(0); const [minimum, setMinimum] = useState(0); const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try {
    const item = await api.create('stock/items', { title: name, status: 'Ativo', data: { minimum } });
    let variants = await api.stockVariants<Variant>(item.id);
    let target = variants[0];
    if (variant.trim() && variant.trim() !== 'Padrão') { await api.addStockVariant(item.id, variant.trim(), minimum); variants = await api.stockVariants<Variant>(item.id); target = variants.find(row => row.name === variant.trim()) || variants[0]; }
    if (quantity > 0 && target) await api.stockMovement({ itemId: item.id, variantId: target.id, quantity, reason: 'Saldo inicial' });
    if (image) await api.uploadImage(item.id, image);
    onSaved(); onClose();
  } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível cadastrar o item.'); } finally { setBusy(false); } }
  return <Drawer title="Novo item" onClose={onClose} footer={<><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" form="stock-new-form" disabled={busy}>{busy ? 'Salvando...' : 'Salvar item'}</button></>}>
    {error && <div className="alert error">{error}</div>}<form id="stock-new-form" onSubmit={save}><div className="field"><label>Nome do item</label><input value={name} onChange={event => setName(event.target.value)} required/></div><div className="form-grid"><div className="field"><label>Tamanho ou variação</label><input value={variant} onChange={event => setVariant(event.target.value)}/></div><div className="field"><label>Saldo inicial</label><input type="number" min="0" step="1" value={quantity} onChange={event => setQuantity(Number(event.target.value))}/></div><div className="field"><label>Estoque mínimo</label><input type="number" min="0" step="1" value={minimum} onChange={event => setMinimum(Number(event.target.value))}/></div><div className="field"><label>Foto</label><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setImage(event.target.files?.[0] || null)}/></div></div></form>
  </Drawer>;
}

function StockDetail({ item, onClose, onChanged }: { item: StockItem; onClose: () => void; onChanged: () => void }) {
  const [action, setAction] = useState<'entrada' | 'saida' | 'reserva'>('entrada'); const [variantId, setVariantId] = useState(item.variants[0]?.id || '');
  const [quantity, setQuantity] = useState(1); const [reason, setReason] = useState(''); const [requester, setRequester] = useState(''); const [eventId, setEventId] = useState(''); const [client, setClient] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  useEffect(() => { api.stockHistory<HistoryRow>(item.id).then(setHistory).catch(() => {}); }, [item.id]);
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try {
    const body = { itemId: item.id, variantId, quantity: action === 'saida' ? -quantity : quantity, reason, requester: requester || null, eventId: eventId || null, client: client || null };
    if (action === 'reserva') await api.stockReservation(body); else await api.stockMovement(body);
    onChanged(); onClose();
  } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha na movimentação.'); } finally { setBusy(false); } }
  const image = item.imageUrl || item.photos?.[0];
  return <Drawer title={item.title} onClose={onClose} footer={<><button className="secondary" onClick={onClose}>Fechar</button><button className="primary" form="stock-action-form" disabled={busy || !variantId}>{busy ? 'Registrando...' : 'Registrar'}</button></>}>
    {image && <img src={image} alt={item.title} style={{ width: 120, height: 120, borderRadius: 12, objectFit: 'cover', marginBottom: 17 }}/>}<div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>{([['Saldo', totals(item).onHand], ['Reservado', totals(item).reserved], ['Disponível', totals(item).available]] as const).map(([label, value]) => <div className="card metric" key={label}><strong>{value}</strong><small>{label}</small></div>)}</div>
    <div className="section-title"><h2>Variações</h2></div><div className="card table-wrap"><table className="data-table"><thead><tr><th>Tamanho</th><th>Saldo</th><th>Reservado</th><th>Disponível</th><th>Mín.</th></tr></thead><tbody>{item.variants.map(variant => <tr key={variant.id}><td>{variant.name}</td><td>{variant.onHand}</td><td>{variant.reserved}</td><td>{variant.available}</td><td>{variant.minimum}</td></tr>)}</tbody></table></div>
    <div className="section-title"><h2>Movimentar estoque</h2></div>{error && <div className="alert error">{error} Seus dados foram preservados.</div>}<form id="stock-action-form" onSubmit={submit}><div className="form-grid"><div className="field"><label>Operação</label><select value={action} onChange={event => setAction(event.target.value as typeof action)}><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="reserva">Reserva</option></select></div><div className="field"><label>Variação</label><select value={variantId} onChange={event => setVariantId(event.target.value)}>{item.variants.map(variant => <option value={variant.id} key={variant.id}>{variant.name}</option>)}</select></div><div className="field"><label>Quantidade</label><input type="number" min="1" step="1" value={quantity} onChange={event => setQuantity(Number(event.target.value))} required/></div><div className="field"><label>Solicitante</label><input value={requester} onChange={event => setRequester(event.target.value)}/></div><div className="field wide"><label>Motivo</label><input value={reason} onChange={event => setReason(event.target.value)} required/></div><div className="field"><label>ID do evento</label><input value={eventId} onChange={event => setEventId(event.target.value)}/></div><div className="field"><label>Cliente</label><input value={client} onChange={event => setClient(event.target.value)}/></div></div></form>
    <div className="section-title"><h2>Histórico de entradas e saídas</h2></div>{history.length ? <div className="card table-wrap"><table className="data-table"><thead><tr><th>Data</th><th>Quantidade</th><th>Motivo</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{new Date(row.created_at).toLocaleDateString('pt-BR')}</td><td>{row.quantity > 0 ? '+' : ''}{row.quantity}</td><td>{row.reason}</td></tr>)}</tbody></table></div> : <p className="notice">Ainda não há movimentações registradas.</p>}
  </Drawer>;
}

export function StockScreen() {
  const [items, setItems] = useState<StockItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [onlyCritical, setOnlyCritical] = useState(false);
  const [selected, setSelected] = useState<StockItem | null>(null); const [importing, setImporting] = useState(false); const [creating, setCreating] = useState(false); const [expanded, setExpanded] = useState<string[]>([]);
  function refresh() { setLoading(true); api.stock<StockItem>().then(setItems).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao carregar o estoque.')).finally(() => setLoading(false)); }
  useEffect(refresh, []);
  const visible = useMemo(() => items.filter(item => item.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')) && (!onlyCritical || totals(item).available < totals(item).minimum)), [items, query, onlyCritical]);
  const critical = items.filter(item => totals(item).available < totals(item).minimum).length;
  return <><div className="page-head"><div><div className="eyebrow">Materiais e brindes</div><h1>Estoque</h1><p>Saldos, reservas e itens que precisam de reposição.</p></div><div className="head-actions"><button className="secondary" onClick={() => setImporting(true)}><Upload size={14}/> Importar Excel</button><button className="primary" onClick={() => setCreating(true)}><Plus size={14}/> Novo item</button></div></div>
    {error && <div className="alert error">{error} <button className="link" onClick={refresh}>Tentar novamente</button></div>}
    <div className="metric-grid"><div className="card metric"><strong>{items.length}</strong><small>Itens cadastrados</small></div><div className="card metric"><strong>{items.reduce((sum, item) => sum + totals(item).onHand, 0)}</strong><small>Unidades em estoque</small></div><div className="card metric"><strong>{items.reduce((sum, item) => sum + totals(item).reserved, 0)}</strong><small>Unidades reservadas</small></div><div className="card metric"><strong>{critical}</strong><small>Abaixo do mínimo</small></div></div>
    <div className="toolbar"><div className="search"><input aria-label="Buscar item" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar item..."/></div><label className="horizontal" style={{ fontSize: 11, color: '#76575b' }}><input type="checkbox" checked={onlyCritical} onChange={event => setOnlyCritical(event.target.checked)}/> Apenas críticos</label></div>
    {loading ? <div className="loading">Carregando estoque...</div> : visible.length === 0 ? <div className="card"><Empty title={items.length ? 'Nenhum item encontrado' : 'Estoque vazio'} body={items.length ? 'Ajuste a busca ou o filtro.' : 'Importe a planilha inicial ou cadastre seu primeiro item.'} action={items.length ? undefined : 'Importar Excel'} onAction={() => setImporting(true)}/></div> : <div className="card table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Saldo</th><th>Reservado</th><th>Disponível</th><th>Mínimo</th><th></th></tr></thead><tbody>{visible.map(item => { const sum = totals(item); const image = item.imageUrl || item.photos?.[0]; const open = expanded.includes(item.id); return <FragmentItem key={item.id} item={item} sum={sum} image={image} open={open} onExpand={() => setExpanded(current => open ? current.filter(id => id !== item.id) : [...current, item.id])} onOpen={() => setSelected(item)}/>; })}</tbody></table></div>}
    {selected && <StockDetail item={selected} onClose={() => setSelected(null)} onChanged={refresh}/>}
    {importing && <ImportDrawer onClose={() => setImporting(false)} onImported={refresh}/>}
    {creating && <NewItemDrawer onClose={() => setCreating(false)} onSaved={refresh}/>}
  </>;
}

function FragmentItem({ item, sum, image, open, onExpand, onOpen }: { item: StockItem; sum: ReturnType<typeof totals>; image?: string; open: boolean; onExpand: () => void; onOpen: () => void }) {
  return <><tr className="clickable" onClick={onOpen}><td className="cell-title">{image ? <img className="stock-photo" src={image} alt=""/> : <span className="stock-placeholder"><ImageIcon size={15}/></span>}{item.title}</td><td>{sum.onHand}</td><td>{sum.reserved}</td><td><span className={sum.available < sum.minimum ? 'pill danger' : 'pill'}>{sum.available}</span></td><td>{sum.minimum}</td><td>{item.variants.length > 1 && <button className="ghost" onClick={event => { event.stopPropagation(); onExpand(); }} aria-label={`Mostrar tamanhos de ${item.title}`}><ChevronDown size={15}/></button>}</td></tr>{open && item.variants.map(variant => <tr key={variant.id} style={{ background: '#fff9f9' }}><td style={{ paddingLeft: 68 }}>↳ {variant.name}</td><td>{variant.onHand}</td><td>{variant.reserved}</td><td>{variant.available}</td><td>{variant.minimum}</td><td/></tr>)}</>;
}
