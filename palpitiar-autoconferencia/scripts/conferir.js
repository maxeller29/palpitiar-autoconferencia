/**
 * Palpitiar — Conferência Automática de Combinações
 * Replica a lógica do admin.html, acessando Supabase e API da Caixa diretamente.
 * Roda via GitHub Actions (sem browser, sem computador ligado).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
// URL do proxy Netlify (resolve CORS da API da Caixa)
const NETLIFY_PROXY = process.env.NETLIFY_PROXY || 'https://palpitiar.com.br/.netlify/functions/resultado';

const LOTERIAS = [
  {
    id: 'mega-sena',
    nome: 'Mega-Sena',
    slug: 'megasena',
    totalDezenas: 6,
    faixas: [
      { nome: 'sena',   acertos: 6, fixo: false },
      { nome: 'quina',  acertos: 5, fixo: false },
      { nome: 'quadra', acertos: 4, fixo: false },
    ],
  },
  {
    id: 'lotofacil',
    nome: 'Lotofácil',
    slug: 'lotofacil',
    totalDezenas: 15,
    faixas: [
      { nome: '15 acertos', acertos: 15, fixo: false },
      { nome: '14 acertos', acertos: 14, fixo: false },
      { nome: '13 acertos', acertos: 13, fixo: 30 },
      { nome: '12 acertos', acertos: 12, fixo: 12 },
      { nome: '11 acertos', acertos: 11, fixo: 6 },
    ],
  },
  {
    id: 'quina',
    nome: 'Quina',
    slug: 'quina',
    totalDezenas: 5,
    faixas: [
      { nome: 'quina',  acertos: 5, fixo: false },
      { nome: 'quadra', acertos: 4, fixo: false },
      { nome: 'terno',  acertos: 3, fixo: false },
      { nome: 'duque',  acertos: 2, fixo: false },
    ],
  },
];

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${txt}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Busca combinações pendentes de uma loteria (máx. 1000 por chamada) */
async function buscarPendentes(loterid) {
  const data = await supabase(
    'GET',
    `combinacoes?loteria=eq.${loterid}&status=eq.pendente&select=id,concurso,dezenas&order=concurso.asc&limit=1000`
  );
  return data || [];
}

/** Busca o menor concurso pendente ainda não conferido */
async function menorConcursoPendente(loterid) {
  const data = await supabase(
    'GET',
    `combinacoes?loteria=eq.${loterid}&status=eq.pendente&select=concurso&order=concurso.asc&limit=1`
  );
  return data && data.length > 0 ? data[0].concurso : null;
}

/** Conta pendentes de uma loteria */
async function contarPendentes(loterid) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/combinacoes?loteria=eq.${loterid}&status=eq.pendente&select=id`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
        'Range': '0-0',
      },
    }
  );
  const range = res.headers.get('content-range') || '0/0';
  const total = parseInt(range.split('/')[1]) || 0;
  return total;
}

/** Verifica se o concurso já foi conferido anteriormente */
async function concursoJaConferido(loterid, concurso) {
  const data = await supabase(
    'GET',
    `sorteios_conferidos?loteria=eq.${loterid}&concurso=eq.${concurso}&select=concurso&limit=1`
  );
  return data && data.length > 0;
}

/** Busca resultado do sorteio via proxy Netlify */
async function buscarResultado(slug, concurso) {
  const url = `${NETLIFY_PROXY}?loteria=${slug}&concurso=${concurso}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  return res.json();
}

/** Calcula acertos entre dezenas da combinação e as dezenas sorteadas */
function calcularAcertos(dezenasCombinacao, dezenasSorteio) {
  const set = new Set(dezenasSorteio.map(Number));
  return dezenasCombinacao.filter(d => set.has(Number(d))).length;
}

/** Determina a faixa premiada conforme acertos */
function determinarFaixa(acertos, loteria) {
  for (const f of loteria.faixas) {
    if (acertos === f.acertos) return f;
  }
  return null;
}

/** Determina valor de prêmio a partir do resultado da Caixa */
function extrairValorFaixa(resultadoCaixa, faixaNome, loteria) {
  // A API da Caixa retorna premiacoes[] com descricao e valorPremio
  if (!resultadoCaixa.premiacoes) return 0;
  const entry = resultadoCaixa.premiacoes.find(p =>
    p.descricao && p.descricao.toLowerCase().includes(faixaNome.toLowerCase())
  );
  return entry ? (entry.valorPremio || 0) : 0;
}

/** Marca combinações como premiadas ou deleta as sem prêmio */
async function processarCombinacoes(combinacoes, dezenasSorteio, resultadoCaixa, loteria) {
  let premiadas = 0;
  let deletadas = 0;

  const idsPremiados = [];
  const idsSemPremio = [];

  for (const comb of combinacoes) {
    const acertos = calcularAcertos(comb.dezenas, dezenasSorteio);
    const faixa = determinarFaixa(acertos, loteria);

    if (faixa) {
      idsPremiados.push({ id: comb.id, faixa, acertos });
      premiadas++;
    } else {
      idsSemPremio.push(comb.id);
      deletadas++;
    }
  }

  // Deletar não-premiadas em lote
  if (idsSemPremio.length > 0) {
    const lotes = chunk(idsSemPremio, 100);
    for (const lote of lotes) {
      const ids = lote.join(',');
      await supabase('DELETE', `combinacoes?id=in.(${ids})`);
    }
  }

  // Marcar premiadas
  for (const { id, faixa, acertos } of idsPremiados) {
    const valor = faixa.fixo !== false
      ? faixa.fixo
      : extrairValorFaixa(resultadoCaixa, faixa.nome, loteria);

    await supabase('PATCH', `combinacoes?id=eq.${id}`, {
      status: 'premiada',
      faixa_premiada: faixa.nome,
      acertos,
      valor_premio: valor,
      conferido_em: new Date().toISOString(),
    });

    // Atualizar resumo_por_faixa
    await atualizarResumoPorFaixa(loteria.id, faixa.nome, valor);
  }

  return { premiadas, deletadas };
}

/** Upsert no resumo_por_faixa (incrementa totais) */
async function atualizarResumoPorFaixa(loterid, faixaNome, valor) {
  // Busca registro atual
  const atual = await supabase(
    'GET',
    `resumo_por_faixa?loteria=eq.${loterid}&faixa=eq.${encodeURIComponent(faixaNome)}&select=id,total_premiadas,valor_total&limit=1`
  );

  if (atual && atual.length > 0) {
    await supabase('PATCH', `resumo_por_faixa?id=eq.${atual[0].id}`, {
      total_premiadas: (atual[0].total_premiadas || 0) + 1,
      valor_total: (atual[0].valor_total || 0) + valor,
    });
  } else {
    await supabase('POST', 'resumo_por_faixa', {
      loteria: loterid,
      faixa: faixaNome,
      total_premiadas: 1,
      valor_total: valor,
    });
  }
}

/** Registra sorteio conferido */
async function registrarSorteioConferido(loterid, concurso, dataSorteio, dezenas, stats) {
  await supabase('POST', 'sorteios_conferidos', {
    loteria: loterid,
    concurso,
    data_sorteio: dataSorteio,
    dezenas,
    total_combinacoes: stats.total,
    total_premiadas: stats.premiadas,
    total_deletadas: stats.deletadas,
  });
}

// ─── CONFERÊNCIA POR LOTERIA ───────────────────────────────────────────────────

async function conferirLoteria(loteria) {
  log(`\n▶ Iniciando conferência: ${loteria.nome}`);

  const pendentesInicial = await contarPendentes(loteria.id);
  log(`  Pendentes iniciais: ${pendentesInicial}`);

  if (pendentesInicial === 0) {
    log(`  ✓ Nenhuma combinação pendente. Pulando.`);
    return { inicial: 0, final: 0, conferidas: 0, iteracoes: 0 };
  }

  let iteracoes = 0;
  const LIMITE = 100;
  const concursosPulados = new Set();
  let semProgresso = 0;
  let pendenteAnterior = pendentesInicial;

  while (iteracoes < LIMITE) {
    iteracoes++;

    // Pega o menor concurso pendente
    const concurso = await menorConcursoPendente(loteria.id);
    if (!concurso) {
      log(`  ✓ Sem mais pendentes.`);
      break;
    }

    if (concursosPulados.has(concurso)) {
      log(`  ⏭ Concurso ${concurso} já marcado como futuro. Encerrando.`);
      break;
    }

    // Verifica se já foi conferido antes (idempotência)
    const jaConferido = await concursoJaConferido(loteria.id, concurso);
    if (jaConferido) {
      // Combinações deste concurso ficaram pendentes por engano — conferir de novo
      log(`  ↩ Concurso ${concurso} já estava em sorteios_conferidos, mas há pendentes. Reprocessando.`);
    }

    log(`  → Iteração ${iteracoes}: concurso ${concurso}...`);

    // Busca resultado na API da Caixa
    let resultado;
    try {
      resultado = await buscarResultado(loteria.slug, concurso);
    } catch (err) {
      log(`  ⚠ Erro ao buscar resultado do concurso ${concurso}: ${err.message}`);

      // Se não conseguiu buscar, pode ser concurso futuro
      if (err.message.includes('404') || err.message.includes('500')) {
        log(`  ⏭ Concurso ${concurso} ainda não ocorreu (ou erro da API). Marcando como futuro.`);
        concursosPulados.add(concurso);
        break;
      }

      // Erro de rede — tenta mais uma vez
      await sleep(5000);
      try {
        resultado = await buscarResultado(loteria.slug, concurso);
      } catch (err2) {
        log(`  ✗ Segunda tentativa falhou: ${err2.message}. Abortando esta loteria.`);
        break;
      }
    }

    // Verifica se o sorteio já ocorreu
    if (!resultado || !resultado.dezenasSorteadasOrdemSorteio) {
      log(`  ⏭ Concurso ${concurso}: sorteio ainda não realizado ou sem dezenas. Encerrando.`);
      concursosPulados.add(concurso);
      break;
    }

    const dezenasSorteio = resultado.dezenasSorteadasOrdemSorteio.map(Number);
    const dataSorteio = resultado.dataApuracao || resultado.data || null;

    log(`  ✓ Concurso ${concurso} (${dataSorteio}): dezenas [${dezenasSorteio.join(', ')}]`);

    // Busca todas as combinações pendentes deste concurso
    const combinacoes = await supabase(
      'GET',
      `combinacoes?loteria=eq.${loteria.id}&concurso=eq.${concurso}&status=eq.pendente&select=id,dezenas&limit=1000`
    );

    if (!combinacoes || combinacoes.length === 0) {
      log(`  ✓ Sem combinações pendentes para o concurso ${concurso}.`);
      // Não havia pendentes deste concurso; pode ter sido processado parcialmente
      if (!jaConferido) {
        await registrarSorteioConferido(loteria.id, concurso, dataSorteio, dezenasSorteio, {
          total: 0, premiadas: 0, deletadas: 0,
        });
      }
      continue;
    }

    log(`  → ${combinacoes.length} combinações para processar...`);

    // Processa em lotes de 50 para não sobrecarregar o Supabase
    let totalPremiadas = 0;
    let totalDeletadas = 0;
    const lotes = chunk(combinacoes, 50);

    for (const lote of lotes) {
      const stats = await processarCombinacoes(lote, dezenasSorteio, resultado, loteria);
      totalPremiadas += stats.premiadas;
      totalDeletadas += stats.deletadas;
    }

    log(`  ✓ Concurso ${concurso}: ${totalPremiadas} premiadas, ${totalDeletadas} sem prêmio.`);

    // Registra sorteio conferido
    if (!jaConferido) {
      await registrarSorteioConferido(loteria.id, concurso, dataSorteio, dezenasSorteio, {
        total: combinacoes.length,
        premiadas: totalPremiadas,
        deletadas: totalDeletadas,
      });
    }

    // Verifica progresso
    const pendenteAtual = await contarPendentes(loteria.id);
    if (pendenteAtual >= pendenteAnterior) {
      semProgresso++;
      if (semProgresso >= 2) {
        log(`  ⚠ Sem progresso após 2 iterações. Encerrando.`);
        break;
      }
    } else {
      semProgresso = 0;
      pendenteAnterior = pendenteAtual;
    }

    await sleep(500); // pausa para não martelelar a API
  }

  const pendentesFinal = await contarPendentes(loteria.id);
  const conferidas = Math.max(0, pendentesInicial - pendentesFinal);

  log(`\n  ${loteria.nome}: ${pendentesInicial} → ${pendentesFinal} pendentes (${conferidas} conferidas, ${iteracoes} iterações)`);

  return {
    inicial: pendentesInicial,
    final: pendentesFinal,
    conferidas,
    iteracoes,
    concursosPulados: [...concursosPulados],
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const inicio = Date.now();
  log('═══════════════════════════════════════════════════');
  log(`🎱 Palpitiar — Conferência Automática`);
  log(`📅 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  log('═══════════════════════════════════════════════════');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('✗ ERRO: SUPABASE_URL e SUPABASE_KEY são obrigatórias.');
    process.exit(1);
  }

  const resultados = {};

  for (const loteria of LOTERIAS) {
    try {
      resultados[loteria.id] = await conferirLoteria(loteria);
    } catch (err) {
      log(`\n✗ Erro inesperado em ${loteria.nome}: ${err.message}`);
      resultados[loteria.id] = { erro: err.message };
    }
  }

  // Relatório final
  const duracao = ((Date.now() - inicio) / 1000).toFixed(0);
  log('\n═══════════════════════════════════════════════════');
  log('📊 RELATÓRIO FINAL');
  log('═══════════════════════════════════════════════════');
  log('');
  log('Loteria       | Inicial | Final | Conferidas | Iter.');
  log('─────────────────────────────────────────────────────');

  for (const loteria of LOTERIAS) {
    const r = resultados[loteria.id];
    if (r.erro) {
      log(`${loteria.nome.padEnd(13)} | ERRO: ${r.erro}`);
    } else {
      const nome = loteria.nome.padEnd(13);
      const ini  = String(r.inicial).padStart(7);
      const fin  = String(r.final).padStart(5);
      const conf = String(r.conferidas).padStart(10);
      const iter = String(r.iteracoes).padStart(5);
      log(`${nome} | ${ini} | ${fin} | ${conf} | ${iter}`);
      if (r.concursosPulados && r.concursosPulados.length > 0) {
        log(`              ↳ Concursos futuros: [${r.concursosPulados.join(', ')}]`);
      }
    }
  }

  log('');
  log(`⏱ Tempo total: ${duracao}s`);
  log('═══════════════════════════════════════════════════');
}

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  console.log(msg);
}

main().catch(err => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
