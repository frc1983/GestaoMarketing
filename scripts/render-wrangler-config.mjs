import { readFile, writeFile } from 'node:fs/promises';

const outputPath = process.argv[2];
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;

if (!outputPath) throw new Error('Informe o caminho da configuração de saída.');
if (!databaseId || databaseId === 'REPLACE_WITH_D1_DATABASE_ID') {
  throw new Error('CLOUDFLARE_D1_DATABASE_ID não foi informado.');
}

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const database = config.d1_databases?.find((entry) => entry.binding === 'DB');
if (!database) throw new Error('Binding DB não encontrado em wrangler.jsonc.');

database.database_id = databaseId;
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
