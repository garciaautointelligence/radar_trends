# Radar de Tendências

Site que mostra o que o Brasil está pesquisando no Google, com ranking, horário da coleta, histórico por termo e indicadores de quem está emergindo.

```
Google Trends (feed RSS, BR)
        │
        ▼
Coletor Python  ──(Agendador do Windows, a cada 30 min)──┐
        │                                                │
Função /api/collect (botão "Coletar agora", Vercel) ─────┤
        │                                                │
        ▼                                                │
Supabase (PostgreSQL)  ◄─────────────────────────────────┘
        │
        ▼
Site React + Vite (Vercel)
```

**Versão:** v1.0 (MVP). **Fora do escopo:** n8n, IA, alertas, VPS 24/7, contas de usuário, outras regiões.

---

## Estrutura

```
radar-trends/
├── collector/
│   ├── collector.py          coletor agendado (PC)
│   ├── probe_feed.py         inspeção do feed (diagnóstico)
│   ├── run_collector.bat     chamado pelo Agendador de Tarefas
│   ├── requirements.txt
│   ├── .env                  NUNCA versionar
│   └── logs/                 criada automaticamente
├── sql/
│   ├── 01_schema.sql         tabelas, RLS e função ingest_collection
│   ├── 02_views.sql          v_latest_ranking, v_term_history
│   ├── 03_movers.sql         v_movers (Emergindo)
│   ├── 04_term_summary.sql   term_summary (ranking por período)
│   ├── 05_term_rankings.sql  term_rankings (aba Rankings)
│   ├── 06_news.sql           fontes RSS e notícias
│   ├── 07_news_categories_and_sources.sql  categorias e fontes iniciais
│   └── 08_news_source_logos.sql  campo de logo das fontes
├── web/
│   ├── api/                  funções serverless de coleta e administração de RSS
│   ├── src/                  interface React
│   ├── .env                  NUNCA versionar
│   └── package.json
├── .gitignore
└── README.md
```

> O arquivo do app se chama `app.jsx` (minúsculo) e o `main.jsx` importa `./app.jsx`. O nome no import precisa ser idêntico ao do arquivo: o Windows ignora maiúsculas, mas a Vercel (Linux) não.

---

## 1. Banco (Supabase)

1. Crie o projeto no Supabase.
2. Em **Project Settings → API**, anote a URL, a chave **pública** (anon/publishable) e a chave **secreta** (service_role/secret).
3. No **SQL Editor**, rode nesta ordem: `01_schema.sql`, `02_views.sql`, `03_movers.sql`, `04_term_summary.sql`, `05_term_rankings.sql`, `06_news.sql`, `07_news_categories_and_sources.sql` e `08_news_source_logos.sql`.

## 2. Coletor (PC)

Requisitos: Python 3.11+.

```powershell
cd collector
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

`collector/.env`:

```
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SECRET_KEY=chave_secreta
TRENDS_REGION=BR
INTERVAL_MINUTES=30
```

Teste manual:

```powershell
python collector.py
```

Deve registrar os termos no Supabase e escrever em `collector/logs/collector.log`. Rodar de novo no mesmo intervalo é ignorado (não duplica).

### Agendador de Tarefas do Windows

Tarefa `RadarTrends`, ação: `collector\run_collector.bat` (iniciar em `collector`).

- Gatilho: diariamente às 07:00, repetir a cada 30 minutos por 16 horas
- Executar o mais rápido possível após início perdido
- Não iniciar nova instância se já estiver rodando
- Parar a tarefa após 5 minutos

O PC precisa estar ligado e fora de suspensão nos horários de coleta.

## 3. Site (local)

Requisitos: Node 20+.

```powershell
cd web
npm install
npm run dev
```

`web/.env`:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=chave_publica
```

> O botão **Coletar agora** chama `/api/collect`, que só existe no site publicado. No `npm run dev` ele mostra um aviso.

## 4. Deploy (Vercel)

- **Root Directory:** `web`
- **Framework Preset:** Vite, build `npm run build`, saída `dist`
- **Environment Variables:**

| Variável | Onde é usada | Observação |
|---|---|---|
| `VITE_SUPABASE_URL` | site e função | pública |
| `VITE_SUPABASE_ANON_KEY` | site | chave pública |
| `SUPABASE_SECRET_KEY` | funções serverless de coleta e notícias | **secreta, nunca com prefixo `VITE_`** |
| `RADAR_ADMIN_PASSWORD` | só a função `/api/news-admin` | Senha única com pelo menos 16 caracteres |

Depois de alterar variáveis, faça **Redeploy**: elas entram no build.

Deploy novo não aparece? Veja em **Deployments** se o último está com erro. Quando o build falha, a Vercel continua servindo o último que deu certo.

---

## Como funciona

- **Posição** é a ordem dos itens no feed. O Google não fornece campo de posição nem de crescimento.
- **Volume** é uma estimativa mínima ("200+" = pelo menos 200).
- **Emergindo / selos:** compara a última coleta com a anterior. "novo" = não estava na anterior; "▲ N" = subiu N posições.
- **Abas Hoje / 24 horas / 7 dias:** termos mais presentes na lista no período, com melhor posição e maior volume. "Hoje" usa a meia-noite do fuso do dispositivo.
- **Aba Pesquisa:** compara até três termos no Brasil pelo gráfico incorporado do Google Trends, com dados diários dos últimos 30 ou 90 dias. O índice de 0 a 100 representa interesse relativo, não o total absoluto de buscas.
- **Detalhe do termo:** gráfico de posição (1 no topo). Trechos sem linha = o termo saiu da lista naquela coleta.
- **Coletar agora:** dispara uma coleta pela função da Vercel. Há intervalo mínimo de 10 minutos entre quaisquer duas coletas (agendadas ou manuais). Coletas manuais ficam com `source = 'google_trends_rss_manual'`.
- **Notícias:** a página inicial mostra cards compactos com a manchete mais recente, categorias e ícone de cada agência. As categorias filtram as fontes; tocar no ícone abre até as 10 notícias mais recentes daquela agência. O botão de atualização exige sessão de administrador e aplica intervalo mínimo de 5 minutos por fonte. O Google Trends permanece disponível em abas próprias.
- **Categorias:** as notícias são agrupadas em Brasil, Internacional, Política, Economia e Breaking News. A migração `07_news_categories_and_sources.sql` cadastra as dez fontes iniciais e suas categorias; fontes e categorias podem ser editadas pelo painel Admin.
- **Admin de RSS:** lista fontes com logo, status e horário da última atualização; é possível atualizar todos os feeds ativos em sequência ou cada fonte individualmente. No cadastro, informe opcionalmente uma URL HTTPS para a logo; sem ela, o sistema usa o favicon do domínio. Ao cadastrar uma fonte ativa, o primeiro carregamento das notícias é iniciado automaticamente. Cadastro e edição abrem em uma janela própria. Defina `RADAR_ADMIN_PASSWORD` (mínimo 16 caracteres, de preferência uma senha longa e exclusiva) nas variáveis do servidor Vercel. A senha nunca é salva no navegador; o acesso usa cookie `HttpOnly`, `SameSite=Strict`, com validade de 8 horas. Os feeds precisam usar HTTPS e apontar para endereços públicos.
- **Reuters, CNN e AP:** as URLs sugeridas são buscas do Google Notícias limitadas às últimas 24 horas, não feeds oficiais dessas agências. O próprio feed do Google Notícias informa restrições de uso; confira os termos aplicáveis antes de usar fora de um leitor pessoal não comercial.
- **Atualização local:** as rotas `/api/*` são funções da Vercel; para exercitar cadastro e atualização dos feeds, publique o site ou use um ambiente local que execute as funções serverless. O dashboard local pode ler fontes já cadastradas no Supabase.
- **Aviso de dados antigos:** aparece após 2 horas sem coleta.

## Segurança (checklist)

- [ ] `.env` de `collector/` e `web/` no `.gitignore`, nunca commitados
- [ ] `git log --all --oneline -- collector/.env` retorna vazio (senão, troque a chave no Supabase)
- [ ] Chave secreta só em `collector/.env` e em `SUPABASE_SECRET_KEY` na Vercel (sem `VITE_`)
- [ ] Site usa apenas a chave pública
- [ ] RLS ativo nas duas tabelas, apenas policies de `select`
- [ ] `select has_function_privilege('anon', 'public.ingest_collection(text,text,timestamptz,jsonb)', 'execute');` retorna `false`

## Manutenção

- Logs do coletor: `collector/logs/collector.log`
- O plano gratuito do Supabase pode pausar projetos inativos. Se o PC e o site ficarem muito tempo sem coletar, confira o painel.
- Limpeza opcional de coletas antigas (as linhas de `trend_entries` saem em cascata):

```sql
delete from public.collections where collected_at < now() - interval '90 days';
```

## Problemas comuns

| Sintoma | O que verificar |
|---|---|
| `403` / `429` no coletor | Aumentar `INTERVAL_MINUTES`; conferir User-Agent |
| Feed com 0 itens | Rodar `probe_feed.py` e comparar as tags com `parse_feed` |
| Erro `23505` | Normal: coleta repetida no mesmo horário é ignorada |
| Site vazio, sem erro | Policies de leitura (RLS) e existência de coletas |
| "Emergindo" nunca aparece | `select * from v_movers;` no Supabase |
| Abas Hoje/24h/7d com erro | Rodar `04_term_summary.sql` |
| Coletar agora: "O Google recusou..." | A Google pode recusar a origem da Vercel; o coletor do PC segue funcionando |
| Coletar agora: "Servidor sem configuração" | Falta `SUPABASE_SECRET_KEY` na Vercel (e redeploy) |
| Tarefa não rodou | PC dormindo/desligado; ver Histórico da tarefa no Agendador |
| Build da Vercel: `Cannot resolve ./App.jsx` | Maiúsculas no nome do arquivo ou do import |

## Versão

```powershell
git add -A
git commit -m "release: MVP v1.0"
git tag -a v1.0 -m "MVP Radar de Tendencias"
git push
git push origin v1.0
```
