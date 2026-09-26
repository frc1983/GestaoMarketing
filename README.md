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

## Estoque

A importação aceita `.xlsx` com as colunas `Brinde`, `Tamanho`, `Quant.` e `Imagem`. A leitura ocorre no navegador, incluindo fotos incorporadas. Antes de confirmar, a interface mostra itens, variações, quantidades pendentes e a foto principal escolhida. O fingerprint do arquivo impede carga duplicada.
