export type RecordKind = 'task' | 'project' | 'event' | 'roi' | 'stock_item';

export const TASK_STATUSES = ['Backlog', 'A fazer', 'Em andamento', 'Aguardando terceiro', 'Em aprovação', 'Concluído'] as const;
export const PROJECT_STATUSES = ['Planejamento', 'Em execução', 'Em aprovação', 'Pausado', 'Concluído'] as const;
export const EVENT_STATUSES = ['Planejamento', 'Confirmado', 'Em preparação', 'Realizado', 'Em acompanhamento', 'Finalizado'] as const;
export const ROI_STATUSES = ['Futuro', 'Em mensuração', 'Finalizado'] as const;
export const ROI_NETFIVE_CENTER = 'Equipe Netfive';
export const ROI_EXPENSE_CATEGORIES = ['Hospedagem', 'Passagem aérea', 'Transporte', 'Alimentação', 'Outros'] as const;
export const AGENCY_STATUSES = ['Em produção', 'Aguardando Netfive', 'Aguardando agência', 'Concluído'] as const;

export interface MarketingRecord {
  id: string;
  kind: RecordKind;
  title: string;
  status: string;
  dueAt?: string | null;
  eventAt?: string | null;
  owner?: string | null;
  projectId?: string | null;
  eventId?: string | null;
  agencyStatus?: string | null;
  data: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface ApiResult<T> { data: T }
export interface ApiError { error: string }
