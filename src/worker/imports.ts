import { Hono } from 'hono';
import { z } from 'zod';
import { insertRecordStatement, outboxStatement } from './db';
import type { MarketingRecord } from '../shared/types';
import type { Env } from './env';

type Bindings = { Bindings: Env; Variables: { csrfToken: string } };
export const importsApi = new Hono<Bindings>();

const stockItem = z.object({
  name: z.string().trim().min(1),
  variants: z.array(z.object({ name: z.string().trim().min(1), quantity: z.number().int().min(0), minimum: z.number().int().min(0).default(0) })).min(1),
  imageKey: z.string().optional(),
});
importsApi.post('/import/stock', async c => {
  const parsed = z.object({ fingerprint: z.string().min(8), items: z.array(stockItem).min(1).max(1000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Importação inválida', details: parsed.error.flatten() }, 400);
  const { fingerprint, items } = parsed.data;
  const already = await c.env.DB.prepare('SELECT id FROM import_batches WHERE fingerprint=?').bind(fingerprint).first();
  if (already) return c.json({ error: 'Esta planilha já foi importada' }, 409);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const created: string[] = [];
  for (const item of items) {
    const id = crypto.randomUUID(); created.push(id);
    const record: MarketingRecord = { id, kind: 'stock_item', title: item.name, status: 'Ativo', data: { source: 'xlsx', imageKey: item.imageKey ?? null },
      version: 1, createdAt: now, updatedAt: now, archivedAt: null };
    statements.push(insertRecordStatement(c.env.DB, record), outboxStatement(c.env.DB, record));
    for (const variant of item.variants) {
      const variantId = crypto.randomUUID();
      statements.push(c.env.DB.prepare('INSERT INTO stock_variants (id,item_id,name,minimum) VALUES (?,?,?,?)')
        .bind(variantId, id, variant.name, variant.minimum));
      if (variant.quantity) statements.push(c.env.DB.prepare(`INSERT INTO stock_movements
        (id,item_id,variant_id,quantity,reason,created_at) VALUES (?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), id, variantId, variant.quantity, 'Saldo inicial - Excel', now));
    }
  }
  statements.push(c.env.DB.prepare('INSERT INTO import_batches (id,kind,fingerprint,row_count,created_at) VALUES (?,\'stock\',?,?,?)')
    .bind(crypto.randomUUID(), fingerprint, items.length, now));
  // The source workbook is small; a single D1 batch keeps the import all-or-nothing.
  await c.env.DB.batch(statements);
  return c.json({ data: { imported: items.length, items: items.map((item, i) => ({ name: item.name, id: created[i] })) } }, 201);
});
