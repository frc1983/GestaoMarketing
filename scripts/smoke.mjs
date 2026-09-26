const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787';
const csrf = 'local-dev-token';
const created = [];
let previousAgencyUrl;
let changedAgencyUrl = false;

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(`${base}/api${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path}: ${response.status} ${body.error || ''}`);
  return body.data;
}

function assert(condition, message) { if (!condition) throw new Error(message); }
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });

try {
  const session = await api('/auth/session');
  assert(session.authenticated, 'Sessão local não autenticada');
  previousAgencyUrl = (await api('/settings')).agencyUrl ?? '';

  const suffix = Date.now().toString(36);
  const task = await post('/tasks', { title: `Smoke tarefa ${suffix}`, status: 'Backlog', owner: 'Estefani', data: { priority: 'Alta' } });
  created.push(['tasks', task.id]);
  const updatedTask = await patch(`/tasks/${task.id}`, { status: 'Em andamento' });
  assert(updatedTask.status === 'Em andamento', 'Mudança de status da tarefa falhou');

  const project = await post('/projects', { title: `Smoke projeto ${suffix}`, status: 'Planejamento', data: { template: 'Campanha' } });
  created.push(['projects', project.id]);
  const phases = await api(`/projects/${project.id}/phases`);
  assert(phases.length === 7, 'Template Campanha não criou sete fases');
  const progress = await patch(`/projects/${project.id}/phases/${phases[0].id}`, { status: 'Concluído' });
  assert(progress.progress === 14, 'Progresso do projeto incorreto');

  const event = await post('/events', { title: `Smoke evento ${suffix}`, status: 'Planejamento', eventAt: '2026-10-10', data: { actualBudget: 1000 } });
  created.push(['events', event.id]);
  const milestones = await api(`/events/${event.id}/milestones`);
  assert(milestones.length === 6, 'Evento não criou os seis marcos de ROI');
  assert(milestones.find(item => item.phase === 'D+30')?.due_at === '2026-11-09', 'Prazo D+30 incorreto');

  const stock = await post('/stock/items', { title: `Smoke estoque ${suffix}`, status: 'Ativo', data: { initialVariant: 'Padrão', initialQuantity: 10, minimum: 2 } });
  created.push(['stock/items', stock.id]);
  const variants = await api(`/stock/items/${stock.id}/variants`);
  assert(variants[0].onHand === 10 && variants[0].available === 10, 'Saldo inicial incorreto');
  const reservation = await post('/stock/reservations', { itemId: stock.id, variantId: variants[0].id, quantity: 3, reason: 'Smoke', requester: 'Marketing' });
  const reserved = await api(`/stock/items/${stock.id}/variants`);
  assert(reserved[0].reserved === 3 && reserved[0].available === 7, 'Reserva não reduziu o disponível');
  await patch(`/stock/reservations/${reservation.id}`, { status: 'fulfilled' });
  const fulfilled = await api(`/stock/items/${stock.id}/variants`);
  assert(fulfilled[0].onHand === 7 && fulfilled[0].reserved === 0, 'Consumo da reserva incorreto');

  const fingerprint = `smoke-${suffix}`;
  const imported = await post('/import/stock', { fingerprint, items: [{ name: `Smoke import ${suffix}`, variants: [{ name: 'Padrão', quantity: 4, minimum: 1 }] }] });
  created.push(['stock/items', imported.items[0].id]);
  const duplicate = await fetch(`${base}/api/import/stock`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ fingerprint, items: [{ name: 'Duplicado', variants: [{ name: 'Padrão', quantity: 1, minimum: 0 }] }] }) });
  assert(duplicate.status === 409, 'Importação repetida deveria retornar 409');

  await api('/settings/agencyUrl', { method: 'PUT', body: JSON.stringify('https://www.notion.so/netfive') });
  changedAgencyUrl = true;
  const settings = await api('/settings');
  assert(settings.agencyUrl === 'https://www.notion.so/netfive', 'Configuração não persistiu');
  const search = await api(`/search?q=${encodeURIComponent(`Smoke tarefa ${suffix}`)}`);
  assert(search.some(item => item.id === task.id), 'Busca global não encontrou a tarefa');

  console.log(JSON.stringify({ ok: true, checks: 13 }, null, 2));
} finally {
  if (changedAgencyUrl) {
    try { await api('/settings/agencyUrl', { method: 'PUT', body: JSON.stringify(previousAgencyUrl) }); } catch { /* best-effort cleanup */ }
  }
  for (const [resource, id] of created.reverse()) {
    try { await api(`/${resource}/${id}`, { method: 'DELETE' }); } catch { /* best-effort cleanup */ }
  }
}
