# Marketing OS Netfive

Sistema web interno para tarefas, projetos, eventos, ROI, estoque, resultados e demandas da agência. A aplicação usa React + TypeScript no frontend e Cloudflare Workers, D1 e R2 no backend.

## Desenvolvimento local

```powershell
pnpm install
pnpm exec wrangler d1 migrations apply marketing-os --local
pnpm exec wrangler dev --local --var APP_ENV:local --var DEV_AUTH_BYPASS:true
```

Abra `http://127.0.0.1:8787`. O bypass só funciona quando `APP_ENV=local`.

Validações:

```powershell
pnpm run typecheck
pnpm test
pnpm run build
pnpm run smoke # requer wrangler dev em execução com bypass local
pnpm exec wrangler deploy --dry-run
```

## Configuração no Cloudflare

1. Crie um banco D1 e um bucket R2 e substitua o `database_id` em `wrangler.jsonc`.
2. Gere o hash da senha sem gravar a senha no projeto:

```powershell
$env:MARKETING_PASSWORD = "uma-senha-forte"
pnpm run hash-password
Remove-Item Env:MARKETING_PASSWORD
```

3. Cadastre os secrets:

```powershell
pnpm exec wrangler secret put ADMIN_USERNAME
pnpm exec wrangler secret put ADMIN_PASSWORD_HASH
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put NOTION_TOKEN
```

`SESSION_SECRET` deve ser uma sequência aleatória longa. O token do Notion é opcional até a integração ser configurada.

4. Aplique as migrações e publique:

```powershell
pnpm run db:migrate:remote
pnpm run deploy
```

Na tela **Configurações**, informe os `data_source_id` das bases compartilhadas com a integração do Notion. O sistema cria a propriedade `Marketing OS ID` nessas bases para impedir páginas duplicadas. A importação inicial do Notion é permitida somente para **Tarefas**. Projetos, Eventos, ROI e Estoque são criados e mantidos no Marketing OS, com sincronização somente de saída para o Notion.

## Publicação automática pelo GitHub Actions

Os workflows em `.github/workflows` validam pull requests e publicam cada push na `master` no Worker `marketing-os-netfive`.

Antes do primeiro deploy, crie na conta Cloudflare o banco D1 `marketing-os` e o bucket R2 `marketing-os-images`. Crie também um token de API limitado a essa conta, com permissão de edição para Workers e D1. A aplicação será publicada inicialmente em `https://marketing-os-netfive.workers.dev`.

Cadastre os seguintes GitHub Actions secrets no repositório. Eles nunca devem ser gravados no código:

- `CLOUDFLARE_ACCOUNT_ID`: `c47a1cc604a12cbe147b477a4e2f7f79`
- `CLOUDFLARE_API_TOKEN`: token de deploy da Cloudflare
- `CLOUDFLARE_D1_DATABASE_ID`: ID do banco D1 criado
- `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` e `SESSION_SECRET`: credenciais do Marketing OS

O hash pode ser gerado localmente com `MARKETING_PASSWORD` definido e `pnpm run hash-password`. Gere `SESSION_SECRET` com ao menos 32 bytes aleatórios.

Os secrets do Notion são opcionais: `NOTION_TOKEN`, `NOTION_TASKS_DATA_SOURCE_ID`, `NOTION_PROJECTS_DATA_SOURCE_ID`, `NOTION_EVENTS_DATA_SOURCE_ID`, `NOTION_ROI_DATA_SOURCE_ID` e `NOTION_STOCK_DATA_SOURCE_ID`. Quando existirem, o deploy os envia ao Worker. O workflow não publica enquanto os secrets obrigatórios não estiverem cadastrados.

## Estoque

A importação aceita `.xlsx` com as colunas `Brinde`, `Tamanho`, `Quant.` e `Imagem`. A leitura ocorre no navegador, incluindo fotos incorporadas. Antes de confirmar, a interface mostra itens, variações, quantidades pendentes e a foto principal escolhida. O fingerprint do arquivo impede carga duplicada.
