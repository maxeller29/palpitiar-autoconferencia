/**
 * Palpitiar — Geração Automática de Combinações
 * Replica EXATAMENTE os algoritmos de lotofacil.html, mega-sena.html e quina.html.
 * Roda via GitHub Actions — sem browser, sem computador ligado.
 *
 * Regras:
 *  - Lotofácil: gera 1000 combinações (seg–sáb)
 *  - Quina:     gera 1000 combinações (seg–sáb)
 *  - Mega-Sena: gera 1000 combinações SOMENTE se houver sorteio hoje (ter/qui/sáb + exceções)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const META_LOTOFACIL = 1000;
const META_QUINA     = 1000;
const META_MEGASENA  = 1000;
const LOTE           = 50;   // inserções por vez no Supabase (igual ao site)

// ─── SUPABASE ────────────────────────────────────────────────────────────────

const sb = {
  async req(method, table, body = null, params = '') {
    const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
    const h = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    };
    if (method === 'POST' || method === 'PATCH') h['Prefer'] = 'return=representation';
    const res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`[${method} ${table}] ${await res.text()}`);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  },
  insert: (t, d)    => sb.req('POST',   t, d),
  select: (t, p='') => sb.req('GET',    t, null, p),
  update: (t, d, p) => sb.req('PATCH',  t, d, p),
};

// ─── API CAIXA ───────────────────────────────────────────────────────────────

async function buscarUltimoConcurso(slug) {
  const r = await fetch(
    `https://servicebus2.caixa.gov.br/portaldeloterias/api/${slug}/`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ─── SALVAR NO SUPABASE (igual ao lotoia-db.js) ───────────────────────────────

async function salvarCombinacoes(cartoes, loteria, concurso, dezenasPorCartao, estrategia) {
  // Busca existentes para deduplicação
  const existentes = await sb.select('combinacoes',
    `?loteria=eq.${loteria}&concurso=eq.${concurso}&status=eq.pendente&select=dezenas`
  ).catch(() => []);
  const jaExistem = new Set((existentes || []).map(e => JSON.stringify([...e.dezenas].sort((a,b)=>a-b))));

  const rows = cartoes
    .map(c => ({
      loteria, concurso,
      dezenas: c.dezenas,
      dezenas_por_cartao: dezenasPorCartao,
      estrategia,
      status: 'pendente',
    }))
    .filter(r => !jaExistem.has(JSON.stringify([...r.dezenas].sort((a,b)=>a-b))));

  if (rows.length === 0) return 0;

  // Insere em lotes de 50
  const lotes = chunk(rows, LOTE);
  for (const lote of lotes) {
    await sb.insert('combinacoes', lote);
    await sleep(200);
  }

  // Atualiza contador histórico
  try {
    const atual = await sb.select('contadores_gerados', `?loteria=eq.${loteria}`);
    if (atual?.length) {
      await sb.update('contadores_gerados',
        { total: (parseInt(atual[0].total) || 0) + rows.length, atualizado_em: new Date().toISOString() },
        `?loteria=eq.${loteria}`
      );
    }
  } catch(e) { console.warn('Contador err:', e.message); }

  return rows.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOTOFÁCIL — algoritmo idêntico ao lotofacil.html
// Universo: 1–25, aposta mínima 15 dezenas
// ═══════════════════════════════════════════════════════════════════════════════

const LF = {
  UNIVERSO: 25,
  DEZ_MIN: 15,
  HIST: {
    soma_min: 166, soma_max: 224,
    pares_min: 5,  pares_max: 9,
    consec_max: 8,
  },
};

function lf_analisar(draws) {
  const N = draws.length;
  const freq = new Array(26).fill(0);
  draws.forEach(d => d[2].forEach(x => freq[x]++));
  const ultimaApar = new Array(26).fill(-1);
  draws.forEach((d, idx) => d[2].forEach(x => ultimaApar[x] = idx));
  const atraso = new Array(26).fill(0);
  for (let i = 1; i <= 25; i++) atraso[i] = ultimaApar[i] === -1 ? N : N - 1 - ultimaApar[i];
  const sorteadas15 = new Set(draws.map(d => d[2].join('-')));
  return { freq, atraso, sorteadas15, totalAnalisado: N };
}

function lf_analisarCartao(dz) {
  const sorted = [...dz].sort((a,b) => a-b);
  const k = sorted.length;
  const faixas5 = [0,0,0,0,0];
  sorted.forEach(x => faixas5[Math.floor((x-1)/5)]++);
  const pares = sorted.filter(x => x%2===0).length;
  const soma  = sorted.reduce((a,b) => a+b, 0);
  let maxSeq=1, seq=1;
  for (let i=1; i<sorted.length; i++) {
    if (sorted[i]===sorted[i-1]+1) { seq++; maxSeq=Math.max(maxSeq,seq); } else seq=1;
  }
  return { faixas5, pares, soma, maxSeq, sorted };
}

function lf_qualidade(dz, estrategia) {
  const k = dz.length;
  const fator = k / 15;
  const a = lf_analisarCartao(dz);
  const sMin = LF.HIST.soma_min * fator;
  const sMax = LF.HIST.soma_max * fator;
  const margem = estrategia==='conservadora' ? 8*fator : estrategia==='equilibrada' ? 12*fator : 20*fator;
  if (a.soma < sMin-margem || a.soma > sMax+margem) return false;
  const pMin = Math.max(0, Math.floor(LF.HIST.pares_min*fator)-1);
  const pMax = Math.min(k, Math.ceil(LF.HIST.pares_max*fator)+1);
  if (a.pares < pMin || a.pares > pMax) return false;
  const faixaMin = k >= 15 ? 1 : 0;
  const faixaMax = Math.min(5, Math.ceil(k/4));
  if (a.faixas5.some(f => f < faixaMin || f > faixaMax)) return false;
  const maxConsecPermitido = Math.max(LF.HIST.consec_max, Math.ceil(k*0.6));
  if (a.maxSeq > maxConsecPermitido) return false;
  return true;
}

function lf_pesoDezena(stats, i, perfil) {
  const f = stats.freq[i], a = stats.atraso[i];
  const fNorm = (f+1)/(stats.totalAnalisado+1);
  const aNorm = (a+1)/(stats.totalAnalisado+1);
  switch (perfil) {
    case 'quente':   return Math.pow(fNorm, 1.6);
    case 'frio':     return Math.pow(1-fNorm+0.01, 1.4);
    case 'atrasado': return Math.pow(aNorm, 1.4);
    default:         return fNorm*0.55 + aNorm*0.45;
  }
}

function lf_sample(pesos, k) {
  const pool = [];
  for (let i=1; i<=25; i++) pool.push({n:i, w:pesos[i]});
  const escolhidas = [];
  for (let i=0; i<k; i++) {
    const total = pool.reduce((s,x)=>s+x.w,0);
    let r = Math.random()*total, idx=0;
    for (; idx<pool.length; idx++) { r-=pool[idx].w; if (r<=0) break; }
    idx = Math.min(idx, pool.length-1);
    escolhidas.push(pool[idx].n);
    pool.splice(idx,1);
  }
  return escolhidas.sort((a,b)=>a-b);
}

function lf_escolherPerfil(estrategia) {
  const r = Math.random();
  if (estrategia==='conservadora') {
    if (r<0.65) return 'equilibrado'; if (r<0.90) return 'quente'; return 'atrasado';
  } else if (estrategia==='contrarian') {
    if (r<0.40) return 'frio'; if (r<0.65) return 'atrasado'; if (r<0.85) return 'equilibrado'; return 'quente';
  } else {
    if (r<0.45) return 'equilibrado'; if (r<0.65) return 'quente'; if (r<0.80) return 'frio'; return 'atrasado';
  }
}

function lf_gerarCartoes(qtd, dezPorCartao, stats, estrategia) {
  const cartoes=[]; const chaves=new Set(); let tent=0; const MAX=qtd*600;
  while (cartoes.length<qtd && tent<MAX) {
    tent++;
    const perfil = lf_escolherPerfil(estrategia);
    const pesos = new Array(26);
    for (let i=1; i<=25; i++) pesos[i] = lf_pesoDezena(stats,i,perfil);
    const dz = lf_sample(pesos, dezPorCartao);
    if (!lf_qualidade(dz, estrategia)) continue;
    const chave = dz.join('-');
    if (chaves.has(chave)) continue;
    if (dezPorCartao===15 && stats.sorteadas15.has(chave)) continue;
    chaves.add(chave);
    cartoes.push({ dezenas: dz, perfil });
  }
  // fallback
  while (cartoes.length<qtd) {
    const pesos = new Array(26);
    for (let i=1; i<=25; i++) pesos[i] = lf_pesoDezena(stats,i,'equilibrado');
    const dz = lf_sample(pesos, dezPorCartao);
    const chave = dz.join('-');
    if (chaves.has(chave)) continue;
    chaves.add(chave); cartoes.push({ dezenas: dz, perfil: 'equilibrado' });
  }
  return cartoes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEGA-SENA — algoritmo idêntico ao mega-sena.html
// Universo: 1–60, aposta mínima 6 dezenas
// ═══════════════════════════════════════════════════════════════════════════════

const MS = {
  UNIVERSO: 60,
  DEZ_MIN: 6,
  HIST: {
    pares_min: 2, pares_max: 4,
    soma_min: 140, soma_max: 220,
    consec_max: 3,
  },
};

function ms_analisar(draws) {
  const N = draws.length;
  const freq = new Array(61).fill(0);
  draws.forEach(d => d[2].forEach(x => freq[x]++));
  const ultimaApar = new Array(61).fill(-1);
  draws.forEach((d, idx) => d[2].forEach(x => ultimaApar[x] = idx));
  const atraso = new Array(61).fill(0);
  for (let i=1; i<=60; i++) atraso[i] = ultimaApar[i]===-1 ? N : N-1-ultimaApar[i];
  const sorteadas6 = new Set(draws.map(d => d[2].join('-')));
  return { freq, atraso, sorteadas6, totalAnalisado: N };
}

function ms_analisarCartao(dz) {
  const k = dz.length;
  const sorted = [...dz].sort((a,b)=>a-b);
  const q1 = sorted.filter(x=>x<=20).length;
  const q2 = sorted.filter(x=>x>20&&x<=40).length;
  const q3 = sorted.filter(x=>x>40).length;
  const pares = sorted.filter(x=>x%2===0).length;
  const soma  = sorted.reduce((a,b)=>a+b,0);
  let maxSeq=1, seq=1;
  for (let i=1; i<sorted.length; i++) {
    if (sorted[i]===sorted[i-1]+1) { seq++; maxSeq=Math.max(maxSeq,seq); } else seq=1;
  }
  const faixas10=[0,0,0,0,0,0];
  sorted.forEach(x => { const idx=Math.min(Math.floor((x-1)/10),5); faixas10[idx]++; });
  return { q1, q2, q3, pares, soma, maxSeq, maxFaixa10: Math.max(...faixas10), sorted };
}

function ms_qualidade(dz, estrategia) {
  const k = dz.length;
  const a = ms_analisarCartao(dz);
  const fator = k/6;
  const quadrantesUsados = [a.q1,a.q2,a.q3].filter(x=>x>0).length;
  if (quadrantesUsados < (k>=9?3:2)) return false;
  const paresMin = Math.max(0, Math.floor(MS.HIST.pares_min*fator)-1);
  const paresMax = Math.min(k, Math.ceil(MS.HIST.pares_max*fator)+1);
  if (a.pares<paresMin || a.pares>paresMax) return false;
  const somaMinExp = MS.HIST.soma_min*fator, somaMaxExp = MS.HIST.soma_max*fator;
  if (estrategia==='conservadora') {
    if (a.soma<somaMinExp+10*fator || a.soma>somaMaxExp-10*fator) return false;
  } else if (estrategia==='equilibrada') {
    if (a.soma<somaMinExp-5*fator || a.soma>somaMaxExp+5*fator) return false;
  } else {
    if (a.soma<somaMinExp-20*fator || a.soma>somaMaxExp+20*fator) return false;
  }
  if (a.maxSeq > Math.max(3, Math.ceil(k/4))) return false;
  if (a.maxFaixa10 > Math.max(3, Math.ceil(k/6)+2)) return false;
  return true;
}

function ms_pesoDezena(stats, i, perfil) {
  const f=stats.freq[i], a=stats.atraso[i];
  const fNorm=(f+1)/(stats.totalAnalisado+1), aNorm=(a+1)/(stats.totalAnalisado+1);
  switch (perfil) {
    case 'quente':   return Math.pow(fNorm, 1.6);
    case 'frio':     return Math.pow(1-fNorm+0.01, 1.4);
    case 'atrasado': return Math.pow(aNorm, 1.4);
    default:         return fNorm*0.55+aNorm*0.45;
  }
}

function ms_sample(pesos, k) {
  const pool=[];
  for (let i=1; i<=60; i++) pool.push({n:i, w:pesos[i]});
  const escolhidas=[];
  for (let i=0; i<k; i++) {
    const total=pool.reduce((s,x)=>s+x.w,0);
    let r=Math.random()*total, idx=0;
    for (; idx<pool.length; idx++) { r-=pool[idx].w; if (r<=0) break; }
    idx=Math.min(idx,pool.length-1);
    escolhidas.push(pool[idx].n); pool.splice(idx,1);
  }
  return escolhidas.sort((a,b)=>a-b);
}

function ms_escolherPerfil(estrategia) {
  const r=Math.random();
  if (estrategia==='conservadora') {
    if (r<0.65) return 'equilibrado'; if (r<0.95) return 'quente'; return 'atrasado';
  } else if (estrategia==='contrarian') {
    if (r<0.35) return 'frio'; if (r<0.65) return 'atrasado'; if (r<0.85) return 'equilibrado'; return 'quente';
  } else {
    if (r<0.45) return 'equilibrado'; if (r<0.65) return 'quente'; if (r<0.80) return 'frio'; return 'atrasado';
  }
}

function ms_gerarCartoes(qtd, dezPorCartao, stats, estrategia) {
  const cartoes=[]; const chaves=new Set(); let tent=0; const MAX=qtd*500;
  while (cartoes.length<qtd && tent<MAX) {
    tent++;
    const perfil=ms_escolherPerfil(estrategia);
    const pesos=new Array(61);
    for (let i=1; i<=60; i++) pesos[i]=ms_pesoDezena(stats,i,perfil);
    const dz=ms_sample(pesos,dezPorCartao);
    if (!ms_qualidade(dz,estrategia)) continue;
    const chave=dz.join('-');
    if (chaves.has(chave)) continue;
    if (dezPorCartao===6 && stats.sorteadas6.has(chave)) continue;
    chaves.add(chave); cartoes.push({dezenas:dz, perfil});
  }
  while (cartoes.length<qtd) {
    const pesos=new Array(61);
    for (let i=1; i<=60; i++) pesos[i]=ms_pesoDezena(stats,i,'equilibrado');
    const dz=ms_sample(pesos,dezPorCartao);
    const chave=dz.join('-');
    if (chaves.has(chave)) continue;
    chaves.add(chave); cartoes.push({dezenas:dz, perfil:'equilibrado'});
  }
  return cartoes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUINA — algoritmo idêntico ao quina.html
// Universo: 1–80, aposta mínima 5 dezenas
// ═══════════════════════════════════════════════════════════════════════════════

const QN = {
  UNIVERSO: 80,
  DEZ_MIN: 5,
  HIST: {
    soma_min: 120, soma_max: 285,
    pares_min: 1,  pares_max: 4,
    consec_max: 2,
  },
};

function qn_analisar(draws) {
  const N = draws.length;
  const freq = new Array(81).fill(0);
  draws.forEach(d => d[2].forEach(x => freq[x]++));
  const ultimaApar = new Array(81).fill(-1);
  draws.forEach((d, idx) => d[2].forEach(x => ultimaApar[x] = idx));
  const atraso = new Array(81).fill(0);
  for (let i=1; i<=80; i++) atraso[i] = ultimaApar[i]===-1 ? N : N-1-ultimaApar[i];
  const sorteadas5 = new Set(draws.map(d => d[2].join('-')));
  return { freq, atraso, sorteadas5, totalAnalisado: N };
}

function qn_analisarCartao(dz) {
  const sorted=[...dz].sort((a,b)=>a-b);
  const k=sorted.length;
  const faixas20=[0,0,0,0];
  sorted.forEach(x => faixas20[Math.floor((x-1)/20)]++);
  const pares=sorted.filter(x=>x%2===0).length;
  const soma=sorted.reduce((a,b)=>a+b,0);
  let maxSeq=1, seq=1;
  for (let i=1; i<sorted.length; i++) {
    if (sorted[i]===sorted[i-1]+1) { seq++; maxSeq=Math.max(maxSeq,seq); } else seq=1;
  }
  return { faixas20, pares, soma, maxSeq, sorted };
}

function qn_qualidade(dz, estrategia) {
  const k=dz.length;
  const fator=k/5;
  const a=qn_analisarCartao(dz);
  const sMin=QN.HIST.soma_min*fator, sMax=QN.HIST.soma_max*fator;
  const margem=estrategia==='conservadora'?10*fator:estrategia==='equilibrada'?18*fator:30*fator;
  if (a.soma<sMin-margem||a.soma>sMax+margem) return false;
  const pMin=Math.max(0,Math.floor(QN.HIST.pares_min*fator)-1);
  const pMax=Math.min(k,Math.ceil(QN.HIST.pares_max*fator)+1);
  if (a.pares<pMin||a.pares>pMax) return false;
  if (a.maxSeq > Math.max(QN.HIST.consec_max, Math.ceil(k*0.4))) return false;
  if (k>=5 && a.faixas20.filter(f=>f>0).length<2) return false;
  return true;
}

function qn_pesoDezena(stats, i, perfil) {
  const f=stats.freq[i], a=stats.atraso[i];
  const fNorm=(f+1)/(stats.totalAnalisado+1), aNorm=(a+1)/(stats.totalAnalisado+1);
  switch (perfil) {
    case 'quente':   return Math.pow(fNorm,1.6);
    case 'frio':     return Math.pow(1-fNorm+0.01,1.4);
    case 'atrasado': return Math.pow(aNorm,1.4);
    default:         return fNorm*0.55+aNorm*0.45;
  }
}

function qn_sample(pesos, k) {
  const pool=[];
  for (let i=1; i<=80; i++) pool.push({n:i, w:pesos[i]});
  const escolhidas=[];
  for (let i=0; i<k; i++) {
    const total=pool.reduce((s,x)=>s+x.w,0);
    let r=Math.random()*total, idx=0;
    for (; idx<pool.length; idx++) { r-=pool[idx].w; if (r<=0) break; }
    idx=Math.min(idx,pool.length-1);
    escolhidas.push(pool[idx].n); pool.splice(idx,1);
  }
  return escolhidas.sort((a,b)=>a-b);
}

function qn_escolherPerfil(estrategia) {
  const r=Math.random();
  if (estrategia==='conservadora') {
    if (r<0.65) return 'equilibrado'; if (r<0.90) return 'quente'; return 'atrasado';
  } else if (estrategia==='contrarian') {
    if (r<0.40) return 'frio'; if (r<0.65) return 'atrasado'; if (r<0.85) return 'equilibrado'; return 'quente';
  } else {
    if (r<0.45) return 'equilibrado'; if (r<0.65) return 'quente'; if (r<0.80) return 'frio'; return 'atrasado';
  }
}

function qn_gerarCartoes(qtd, dezPorCartao, stats, estrategia) {
  const cartoes=[]; const chaves=new Set(); let tent=0; const MAX=qtd*600;
  while (cartoes.length<qtd && tent<MAX) {
    tent++;
    const perfil=qn_escolherPerfil(estrategia);
    const pesos=new Array(81);
    for (let i=1; i<=80; i++) pesos[i]=qn_pesoDezena(stats,i,perfil);
    const dz=qn_sample(pesos,dezPorCartao);
    if (!qn_qualidade(dz,estrategia)) continue;
    const chave=dz.join('-');
    if (chaves.has(chave)) continue;
    if (dezPorCartao===5 && stats.sorteadas5.has(chave)) continue;
    chaves.add(chave); cartoes.push({dezenas:dz, perfil});
  }
  while (cartoes.length<qtd) {
    const pesos=new Array(81);
    for (let i=1; i<=80; i++) pesos[i]=qn_pesoDezena(stats,i,'equilibrado');
    const dz=qn_sample(pesos,dezPorCartao);
    const chave=dz.join('-');
    if (chaves.has(chave)) continue;
    chaves.add(chave); cartoes.push({dezenas:dz, perfil:'equilibrado'});
  }
  return cartoes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LÓGICA DE GERAÇÃO POR LOTERIA
// ═══════════════════════════════════════════════════════════════════════════════

async function gerarLotofacil() {
  log('\n▶ Lotofácil — carregando dados da API...');
  const latest = await buscarUltimoConcurso('lotofacil');
  const concurso = latest.numeroConcursoProximo || (latest.numero + 1);
  log(`  Próximo concurso: ${concurso}`);

  // Constrói série histórica mínima a partir do último sorteio (para estatísticas básicas)
  // Busca os últimos 500 sorteios para ter estatísticas decentes
  log('  Carregando histórico recente para análise estatística...');
  const draws = await carregarHistoricoRecente('lotofacil', latest, 500);
  log(`  ${draws.length} sorteios carregados para análise.`);

  const stats    = lf_analisar(draws);
  const estrategia = 'equilibrada';
  let totalSalvos = 0;

  log(`  Gerando ${META_LOTOFACIL} combinações...`);
  while (totalSalvos < META_LOTOFACIL) {
    const faltam  = META_LOTOFACIL - totalSalvos;
    const qtdLote = Math.min(LOTE, faltam);
    const cartoes = lf_gerarCartoes(qtdLote, LF.DEZ_MIN, stats, estrategia);
    const salvos  = await salvarCombinacoes(cartoes, 'lotofacil', concurso, LF.DEZ_MIN, estrategia);
    totalSalvos  += salvos;
    log(`  → ${totalSalvos}/${META_LOTOFACIL} salvas`);
    if (salvos === 0 && totalSalvos < META_LOTOFACIL) {
      log('  ⚠ Sem novas combinações (todas duplicadas). Encerrando lote.');
      break;
    }
    await sleep(300);
  }
  return totalSalvos;
}

async function gerarQuina() {
  log('\n▶ Quina — carregando dados da API...');
  const latest = await buscarUltimoConcurso('quina');
  const concurso = latest.numeroConcursoProximo || (latest.numero + 1);
  log(`  Próximo concurso: ${concurso}`);

  log('  Carregando histórico recente para análise estatística...');
  const draws = await carregarHistoricoRecente('quina', latest, 500);
  log(`  ${draws.length} sorteios carregados para análise.`);

  const stats    = qn_analisar(draws);
  const estrategia = 'equilibrada';
  let totalSalvos = 0;

  log(`  Gerando ${META_QUINA} combinações...`);
  while (totalSalvos < META_QUINA) {
    const faltam  = META_QUINA - totalSalvos;
    const qtdLote = Math.min(LOTE, faltam);
    const cartoes = qn_gerarCartoes(qtdLote, QN.DEZ_MIN, stats, estrategia);
    const salvos  = await salvarCombinacoes(cartoes, 'quina', concurso, QN.DEZ_MIN, estrategia);
    totalSalvos  += salvos;
    log(`  → ${totalSalvos}/${META_QUINA} salvas`);
    if (salvos === 0 && totalSalvos < META_QUINA) {
      log('  ⚠ Sem novas combinações (todas duplicadas). Encerrando lote.');
      break;
    }
    await sleep(300);
  }
  return totalSalvos;
}

async function gerarMegaSena() {
  log('\n▶ Mega-Sena — verificando se há sorteio hoje...');
  const latest = await buscarUltimoConcurso('megasena');

  // A API retorna dataProximoConcurso no formato dd/mm/yyyy
  const dataProximo = latest.dataProximoConcurso;
  const concurso    = latest.numeroConcursoProximo || (latest.numero + 1);

  // Verifica se o próximo sorteio é hoje (horário de Brasília)
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  log(`  Hoje (BRT): ${hoje} | Próximo sorteio: ${dataProximo} (concurso ${concurso})`);

  if (dataProximo !== hoje) {
    log(`  ⏭ Sem sorteio da Mega-Sena hoje. Pulando.`);
    return 0;
  }

  log('  ✓ Há sorteio hoje! Gerando combinações...');
  log('  Carregando histórico recente para análise estatística...');
  const draws = await carregarHistoricoRecente('megasena', latest, 500);
  log(`  ${draws.length} sorteios carregados para análise.`);

  const stats    = ms_analisar(draws);
  const estrategia = 'equilibrada';
  let totalSalvos = 0;

  log(`  Gerando ${META_MEGASENA} combinações...`);
  while (totalSalvos < META_MEGASENA) {
    const faltam  = META_MEGASENA - totalSalvos;
    const qtdLote = Math.min(LOTE, faltam);
    const cartoes = ms_gerarCartoes(qtdLote, MS.DEZ_MIN, stats, estrategia);
    const salvos  = await salvarCombinacoes(cartoes, 'mega-sena', concurso, MS.DEZ_MIN, estrategia);
    totalSalvos  += salvos;
    log(`  → ${totalSalvos}/${META_MEGASENA} salvas`);
    if (salvos === 0 && totalSalvos < META_MEGASENA) {
      log('  ⚠ Sem novas combinações (todas duplicadas). Encerrando lote.');
      break;
    }
    await sleep(300);
  }
  return totalSalvos;
}

// Carrega os últimos N sorteios de uma loteria via API da Caixa para análise estatística
async function carregarHistoricoRecente(slug, latest, n) {
  const draws = [];
  const ultimo = latest.numero;
  const inicio = Math.max(1, ultimo - n + 1);

  // Adiciona o último sorteio já disponível
  if (latest.listaDezenas) {
    const g = latest.listaRateioPremio?.[0]?.numeroDeGanhadores || 0;
    draws.unshift([
      latest.numero, latest.dataApuracao,
      latest.listaDezenas.map(x=>parseInt(x,10)).sort((a,b)=>a-b),
      parseInt(g,10)||0
    ]);
  }

  // Busca anteriores
  for (let i = ultimo - 1; i >= inicio; i--) {
    try {
      const r = await fetch(
        `https://servicebus2.caixa.gov.br/portaldeloterias/api/${slug}/${i}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) continue;
      const d = await r.json();
      if (!d.listaDezenas) continue;
      const g = d.listaRateioPremio?.[0]?.numeroDeGanhadores || 0;
      draws.unshift([
        d.numero, d.dataApuracao,
        d.listaDezenas.map(x=>parseInt(x,10)).sort((a,b)=>a-b),
        parseInt(g,10)||0
      ]);
      await sleep(120);
    } catch(e) { /* ignora erros individuais */ }
  }

  return draws.sort((a,b)=>a[0]-b[0]);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const inicio = Date.now();
  log('═══════════════════════════════════════════════════');
  log('🎱 Palpitiar — Geração Automática de Combinações');
  log(`📅 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  log('═══════════════════════════════════════════════════');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('✗ ERRO: SUPABASE_URL e SUPABASE_KEY são obrigatórias.');
    process.exit(1);
  }

  const resultados = {};

  // Lotofácil — sempre (seg–sáb)
  try {
    resultados['lotofacil'] = await gerarLotofacil();
  } catch(e) {
    log(`\n✗ Erro em Lotofácil: ${e.message}`);
    resultados['lotofacil'] = `ERRO: ${e.message}`;
  }

  // Quina — sempre (seg–sáb)
  try {
    resultados['quina'] = await gerarQuina();
  } catch(e) {
    log(`\n✗ Erro em Quina: ${e.message}`);
    resultados['quina'] = `ERRO: ${e.message}`;
  }

  // Mega-Sena — somente se sorteio hoje
  try {
    resultados['mega-sena'] = await gerarMegaSena();
  } catch(e) {
    log(`\n✗ Erro em Mega-Sena: ${e.message}`);
    resultados['mega-sena'] = `ERRO: ${e.message}`;
  }

  const duracao = ((Date.now()-inicio)/1000).toFixed(0);
  log('\n═══════════════════════════════════════════════════');
  log('📊 RELATÓRIO FINAL');
  log('═══════════════════════════════════════════════════');
  log('');
  log('Loteria       | Combinações geradas');
  log('─────────────────────────────────────');
  for (const [k,v] of Object.entries(resultados)) {
    log(`${k.padEnd(13)} | ${v}`);
  }
  log('');
  log(`⏱ Tempo total: ${duracao}s`);
  log('═══════════════════════════════════════════════════');
}

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

function chunk(arr, size) {
  const c=[]; for (let i=0; i<arr.length; i+=size) c.push(arr.slice(i,i+size)); return c;
}
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function log(msg)  { console.log(msg); }

main().catch(err => { console.error('ERRO FATAL:', err); process.exit(1); });
