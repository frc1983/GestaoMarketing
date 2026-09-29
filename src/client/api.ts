import type { MarketingRecord } from '../shared/types';

export interface Session { authenticated: boolean; csrfToken?: string; username?: string; authenticationDisabled?: boolean }
export interface DashboardData {
  statusCounts?: Record<string, Record<string, number>>;
  upcomingTasks?: MarketingRecord[];
  upcomingEvents?: MarketingRecord[];
  alerts?: { overdueTasks?: number; criticalStock?: number; pendingRoi?: number };
}
export interface SyncStatus { pending: number; failed: number; synced: number; configured: boolean; lastError?: string | null }
export interface SearchResult { id: string; kind: string; title: string; status: string }
export interface AppSettings {
  owners?: string[];
  categories?: string[];
  priorities?: string[];
  agencyUrl?: string;
  notionSources?: Record<string, string>;
}
export interface RoiLedgerEntry {
  id: string;
  entry_type: 'debit' | 'credit';
  allocation?: string | null;
  expense_category?: string | null;
  company?: string | null;
  service?: string | null;
  client?: string | null;
  amount_cents: number;
  occurred_on: string;
  notes?: string | null;
  created_at: string;
}
export interface RoiLedgerData { entries: RoiLedgerEntry[]; totals: { credits: number; debits: number; balance: number } }

let csrfToken = '';
export function setCsrfToken(token?: string) { csrfToken = token || ''; }

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  const json = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(json.error || `Falha na requisição (${response.status}).`);
  return json.data as T;
}

export const api = {
  session: async () => { const session = await request<Session>('/api/auth/session'); setCsrfToken(session.csrfToken); return session; },
  login: async (username: string, password: string) => {
    await request<unknown>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    return api.session();
  },
  logout: async () => { await request<unknown>('/api/auth/logout', { method: 'POST' }); setCsrfToken(); },
  dashboard: () => request<DashboardData>('/api/dashboard'),
  list: (resource: string) => request<MarketingRecord[]>(`/api/${resource}`),
  stock: <T>() => request<T[]>('/api/stock/items'),
  roiSummary: <T>() => request<T[]>('/api/roi/summary'),
  roiLedger: () => request<RoiLedgerData>('/api/roi/ledger'),
  addRoiLedgerEntry: (body: Record<string, unknown>) => request<RoiLedgerEntry>('/api/roi/ledger', { method: 'POST', body: JSON.stringify(body) }),
  removeRoiLedgerEntry: (id: string) => request<unknown>(`/api/roi/ledger/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  opportunities: <T>(eventId: string) => request<T[]>(`/api/roi/opportunities?eventId=${encodeURIComponent(eventId)}`),
  addOpportunity: (body: Record<string, unknown>) => request<Record<string, unknown>>('/api/roi/opportunities', { method: 'POST', body: JSON.stringify(body) }),
  projectPhases: <T>(id: string) => request<T[]>(`/api/projects/${encodeURIComponent(id)}/phases`),
  updateProjectPhase: (projectId: string, phaseId: string, status: string) => request<Record<string, unknown>>(`/api/projects/${encodeURIComponent(projectId)}/phases/${encodeURIComponent(phaseId)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  eventMilestones: <T>(id: string) => request<T[]>(`/api/events/${encodeURIComponent(id)}/milestones`),
  updateEventMilestone: (eventId: string, phase: string, status: string, notes: string) => request<Record<string, unknown>>(`/api/events/${encodeURIComponent(eventId)}/milestones/${encodeURIComponent(phase)}`, { method: 'PATCH', body: JSON.stringify({ status, notes }) }),
  create: (resource: string, body: Record<string, unknown>) => request<MarketingRecord>(`/api/${resource}`, { method: 'POST', body: JSON.stringify(body) }),
  update: (resource: string, id: string, body: Record<string, unknown>) => request<MarketingRecord>(`/api/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (resource: string, id: string) => request<unknown>(`/api/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  results: () => request<Record<string, unknown>>('/api/results'),
  agency: () => request<Record<string, unknown>>('/api/agency'),
  sync: () => request<SyncStatus>('/api/sync/status'),
  retrySync: () => request<{ queued: boolean }>('/api/sync/retry', { method: 'POST', body: '{}' }),
  importStock: (fingerprint: string, items: Array<Record<string, unknown>>) => request<{ imported: number; items: Array<{ name: string; id: string }> }>('/api/import/stock', { method: 'POST', body: JSON.stringify({ fingerprint, items }) }),
  importRoiCsv: (csv: string) => request<Record<string, unknown>>('/api/import/roi-csv', { method: 'POST', body: JSON.stringify({ csv }) }),
  stockMovement: (body: Record<string, unknown>) => request<Record<string, unknown>>('/api/stock/movements', { method: 'POST', body: JSON.stringify(body) }),
  stockReservation: (body: Record<string, unknown>) => request<Record<string, unknown>>('/api/stock/reservations', { method: 'POST', body: JSON.stringify(body) }),
  stockHistory: <T>(itemId: string) => request<T[]>(`/api/stock/movements?itemId=${encodeURIComponent(itemId)}`),
  stockReservations: <T>(itemId: string) => request<T[]>(`/api/stock/reservations?itemId=${encodeURIComponent(itemId)}`),
  updateStockReservation: (id: string, status: 'cancelled' | 'fulfilled') => request<Record<string, unknown>>(`/api/stock/reservations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  stockVariants: <T>(itemId: string) => request<T[]>(`/api/stock/items/${encodeURIComponent(itemId)}/variants`),
  addStockVariant: (itemId: string, name: string, minimum: number) => request<Record<string, unknown>>(`/api/stock/items/${encodeURIComponent(itemId)}/variants`, { method: 'POST', body: JSON.stringify({ name, minimum }) }),
  search: (query: string) => request<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`),
  settings: () => request<AppSettings>('/api/settings'),
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => request<{ key: K; value: AppSettings[K] }>(`/api/settings/${String(key)}`, { method: 'PUT', body: JSON.stringify(value) }),
};
