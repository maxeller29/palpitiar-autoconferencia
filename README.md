# Palpitiar — Conferência Automática

Script serverless que confere automaticamente as combinações pendentes das loterias **Mega-Sena**, **Lotofácil** e **Quina** no banco Supabase do Palpitiar.

Roda como **GitHub Actions** — sem servidor, sem computador ligado, gratuito.

---

## Como funciona

1. O GitHub Actions dispara automaticamente de **terça a domingo** (segunda é dia sem sorteio relevante).
2. O script acessa o Supabase diretamente, busca combinações pendentes por loteria.
3. Para cada concurso pendente, busca o resultado via proxy Netlify do Palpitiar.
4. Se o sorteio já ocorreu: marca premiadas e deleta as sem prêmio.
5. Se o sorteio ainda não ocorreu: para e aguarda a próxima execução.

---

## Configuração (5 minutos)

### Passo 1 — Criar repositório no GitHub

1. Acesse [github.com/new](https://github.com/new)
2. Crie um repositório **privado** com o nome `palpitiar-autoconferencia`
3. Faça upload de todos os arquivos desta pasta para o repositório

### Passo 2 — Configurar os Secrets

No repositório GitHub, vá em **Settings → Secrets and variables → Actions → New repository secret** e adicione:

| Nome | Valor |
|------|-------|
| `SUPABASE_URL` | `https://oslvqimllizsdtxwkrag.supabase.co` |
| `SUPABASE_KEY` | A anon key do Supabase (a que está no `lotoia-db.js`) |
| `NETLIFY_PROXY` | `https://palpitiar.com.br/.netlify/functions/resultado` |

### Passo 3 — Ativar o Actions

1. Na aba **Actions** do repositório, clique em **"I understand my workflows, go ahead and enable them"**
2. Pronto! O script vai rodar automaticamente nos horários configurados.

### Passo 4 — Testar manualmente

1. Vá em **Actions** → selecione o workflow **"Palpitiar — Conferência Automática"**
2. Clique em **"Run workflow"** → **"Run workflow"**
3. Acompanhe o log em tempo real clicando no job em execução.

---

## Horários de execução

| Cron | Horário BRT | Dias |
|------|-------------|------|
| `30 6 * * 2,3,4,5,6,0` | 03:30 | terça a domingo |

Às 03:30 BRT todos os sorteios do dia anterior já foram realizados (Mega-Sena, Lotofácil e Quina sorteiam por volta das 20h BRT), então uma única execução noturna é suficiente para conferir tudo.

Segunda-feira é excluída pois não há sorteios no domingo à noite.

---

## Verificar resultados

- **GitHub Actions** → **Actions** → veja os logs de cada execução
- Os logs ficam disponíveis por 30 dias
- Cada execução mostra um relatório como:

```
═══════════════════════════════════════════════════
📊 RELATÓRIO FINAL
═══════════════════════════════════════════════════

Loteria       | Inicial | Final | Conferidas | Iter.
─────────────────────────────────────────────────────
Mega-Sena     |      45 |     0 |         45 |     3
Lotofácil     |     120 |     0 |        120 |     8
Quina         |      88 |    20 |         68 |     4
              ↳ Concursos futuros: [7060]

⏱ Tempo total: 47s
```

---

## Estrutura de arquivos

```
palpitiar-autoconferencia/
├── .github/
│   └── workflows/
│       └── conferencia.yml   ← Agendamento e trigger do GitHub Actions
├── scripts/
│   └── conferir.js           ← Lógica de conferência (replica admin.html)
└── README.md
```

---

## Limites do plano gratuito do GitHub Actions

| Recurso | Limite gratuito | Uso estimado |
|---------|-----------------|--------------|
| Minutos/mês | 2.000 min | ~60 min/mês (execuções de ~1min cada) |
| Armazenamento de artefatos | 500 MB | < 1 MB/mês |

O uso está bem dentro do gratuito.

---

## Solução de problemas

**Script falha com erro de autenticação Supabase**
→ Verifique se o Secret `SUPABASE_KEY` está correto (sem espaços extras).

**Script não encontra combinações**
→ Normal se todas já foram conferidas. Veja o log "Nenhuma combinação pendente."

**Erro 404 ao buscar resultado da Caixa**
→ O proxy Netlify pode estar fora do ar ou a API da Caixa mudou. Verifique `palpitiar.com.br/admin` manualmente.

**Workflow não aparece na aba Actions**
→ Confirme que o arquivo `.github/workflows/conferencia.yml` está na branch `main`.
<!-- atualizado -->
