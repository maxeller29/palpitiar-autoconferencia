// atualizar-historico.js
// Busca apenas os concursos novos (após o último registrado em cada JSON)
// e os anexa ao arquivo. Atualiza meta e stats.
// Usado pelo GitHub Actions workflow atualizar-historico.yml

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuração das loterias ─────────────────────────────
const LOTERIAS = [
  {
    id:       'megasena',
    slug:     'megasena',
    arquivo:  'mega-sena-historico.json',
    qtdDez:   6,
    // Mapeamento de prêmios: chave no JSON → chave no draw[4]
    premios: (r) => {
      const p = {};
      const faixas = r.premiacoes || [];
      // sena=0, quina=1, quadra=2
      const mapFaixa = { 0: 's', 1: 'qn', 2: 'qd' };
      const mapG     = { 0: 'gs', 1: 'gqn', 2: 'gqd' };
      faixas.forEach((f, i) => {
        const k = mapFaixa[i];
        const kg = mapG[i];
        if (k) {
          p[k]  = f.valorPremio   ?? 0;
          p[kg] = f.numeradorGanhadores ?? 0;
        }
      });
      return p;
    }
  },
  {
    id:       'lotofacil',
    slug:     'lotofacil',
    arquivo:  'lotofacil-historico.json',
    qtdDez:   15,
    premios: (r) => {
      const p = {};
      const faixas = r.premiacoes || [];
      // 15=0,14=1,13=2,12=3,11=4
      const mapFaixa = { 0:'15', 1:'14', 2:'13', 3:'12', 4:'11' };
      const mapG     = { 0:'g15',1:'g14',2:'g13',3:'g12',4:'g11' };
      faixas.forEach((f, i) => {
        const k = mapFaixa[i];
        const kg = mapG[i];
        if (k) {
          p[k]  = f.valorPremio   ?? 0;
          p[kg] = f.numeradorGanhadores ?? 0;
        }
      });
      return p;
    }
  },
  {
    id:       'quina',
    slug:     'quina',
    arquivo:  'quina-historico.json',
    qtdDez:   5,
    premios: (r) => {
      const p = {};
      const faixas = r.premiacoes || [];
      // quina=0,quadra=1,terno=2,duque=3
      const mapFaixa = { 0:'5', 1:'4', 2:'3', 3:'2' };
      const mapG     = { 0:'g5',1:'g4',2:'g3',3:'g2' };
      faixas.forEach((f, i) => {
        const k = mapFaixa[i];
        const kg = mapG[i];
        if (k) {
          p[k]  = f.valorPremio   ?? 0;
          p[kg] = f.numeradorGanhadores ?? 0;
        }
      });
      return p;
    }
  }
];

const BASE_URL = 'https://servicebus2.caixa.gov.br/portaldeloterias/api';
const DELAY_MS = 800; // respeitar rate limit da Caixa

// ── Helpers ───────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchCaixa(slug, numero) {
  const url = `${BASE_URL}/${slug}/${numero}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; palpitiar-bot/1.0)'
    }
  });
  if (res.status === 404) return null;        // concurso não existe ainda
  if (!res.ok) throw new Error(`HTTP ${res.status} para ${url}`);
  return res.json();
}

// Formata data da Caixa (DD/MM/YYYY) para ISO (YYYY-MM-DD)
function formatarData(dataCaixa) {
  if (!dataCaixa) return null;
  const parts = dataCaixa.split('/');
  if (parts.length !== 3) return dataCaixa;
  return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
}

// Recalcula stats a partir dos draws
function calcularStats(draws, qtdDez) {
  const freqMap = {};
  for (let n = 1; n <= (qtdDez === 6 ? 60 : qtdDez === 15 ? 25 : 80); n++) freqMap[n] = 0;

  let somaTotal = 0, comAcert = 0, semAcert = 0;
  const ultimoSorteio = {};

  draws.forEach((d, idx) => {
    const dz = d[2];
    const ganhadores = d[3] ?? 0;
    const soma = dz.reduce((s, n) => s + n, 0);
    somaTotal += soma;
    if (ganhadores > 0) comAcert++; else semAcert++;
    dz.forEach(n => {
      freqMap[n] = (freqMap[n] || 0) + 1;
      ultimoSorteio[n] = idx;
    });
  });

  const total = draws.length;
  const lastIdx = total - 1;

  // Frequência e atraso
  const frequencia = {};
  const atraso = {};
  Object.entries(freqMap).forEach(([n, f]) => {
    frequencia[n] = f;
    atraso[n] = lastIdx - (ultimoSorteio[n] ?? -1);
  });

  // Top 5 quentes/frias
  const sorted = Object.entries(freqMap).sort((a, b) => b[1] - a[1]);
  const quentes = sorted.slice(0, 5).map(([n]) => Number(n));
  const frias   = sorted.slice(-5).map(([n]) => Number(n));

  // Paridade média (só Mega)
  const mediaPares = draws.reduce((s, d) => s + d[2].filter(n => n % 2 === 0).length, 0) / total;

  return {
    comAcertadores: comAcert,
    semAcertadores: semAcert,
    percentualComAcertadores: Number((comAcert / total * 100).toFixed(1)),
    frequencia,
    atraso,
    quentes,
    frias,
    somaMedia: Number((somaTotal / total).toFixed(1)),
    somaMin: Math.min(...draws.map(d => d[2].reduce((s, n) => s + n, 0))),
    somaMax: Math.max(...draws.map(d => d[2].reduce((s, n) => s + n, 0))),
    ...(qtdDez === 6 ? { mediaPares: Number(mediaPares.toFixed(2)) } : {})
  };
}

// ── Função principal por loteria ──────────────────────────
async function atualizarLoteria(cfg) {
  const arquivo = path.join(__dirname, cfg.arquivo);

  // Carregar JSON existente
  const existente = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const draws = existente.draws;
  const ultimoConcurso = draws[draws.length - 1][0];

  console.log(`\n[${cfg.id}] Último no JSON: concurso ${ultimoConcurso}`);

  // Buscar próximos concursos até 404 ou erro
  let proximo = ultimoConcurso + 1;
  let novos = 0;
  let ultimoProcessado = ultimoConcurso;
  let ultimaData = draws[draws.length - 1][1];

  while (true) {
    console.log(`  → Buscando concurso ${proximo}...`);
    let resultado;
    try {
      resultado = await fetchCaixa(cfg.slug, proximo);
    } catch (e) {
      console.log(`  ✗ Erro: ${e.message}`);
      break;
    }

    if (!resultado) {
      console.log(`  → Concurso ${proximo} não existe ainda. Fim.`);
      break;
    }

    // Extrair dezenas
    const dezenas = (resultado.listaDezenas || resultado.dezenas || []).map(Number).sort((a, b) => a - b);
    if (dezenas.length !== cfg.qtdDez) {
      console.log(`  ✗ Dezenas inválidas (${dezenas.length} vs ${cfg.qtdDez}). Pulando.`);
      break;
    }

    // Extrair data
    const data = formatarData(resultado.dataApuracao || resultado.data);

    // Extrair ganhadores do prêmio máximo
    const ganhadores = resultado.numeradorGanhadores ?? resultado.ganhadores ?? 0;

    // Extrair prêmios
    const premiosObj = cfg.premios(resultado);

    // Montar draw
    const draw = [proximo, data, dezenas, ganhadores, premiosObj];
    draws.push(draw);
    novos++;
    ultimoProcessado = proximo;
    ultimaData = data;

    console.log(`  ✓ Concurso ${proximo} (${data}) adicionado. Dezenas: [${dezenas.join(',')}]`);

    proximo++;
    await sleep(DELAY_MS);
  }

  if (novos === 0) {
    console.log(`  = Nenhum concurso novo. JSON já atualizado.`);
    return false;
  }

  // Recalcular stats e meta
  const stats = calcularStats(draws, cfg.qtdDez);
  const hoje = new Date().toISOString().slice(0, 10);

  existente.draws = draws;
  existente.stats = stats;
  existente.meta = {
    ...existente.meta,
    geradoEm: hoje,
    totalConcursos: draws.length,
    ultimoConcurso: ultimoProcessado,
    ultimaData,
    enriquecidoEm: hoje,
    totalComPremio: draws.length
  };

  fs.writeFileSync(arquivo, JSON.stringify(existente), 'utf8');
  console.log(`  ✓ ${cfg.arquivo} salvo com ${draws.length} concursos (+${novos} novos).`);
  return true;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('=== Atualizar histórico de loterias ===');
  console.log('Data:', new Date().toISOString());

  let algumAtualizado = false;

  for (const cfg of LOTERIAS) {
    try {
      const atualizado = await atualizarLoteria(cfg);
      if (atualizado) algumAtualizado = true;
    } catch (e) {
      console.error(`[${cfg.id}] ERRO FATAL: ${e.message}`);
      process.exitCode = 1;
    }
  }

  if (algumAtualizado) {
    console.log('\n✓ Pelo menos um JSON foi atualizado — commit será feito.');
    // Sinal para o workflow fazer commit
    fs.writeFileSync(path.join(__dirname, '.historico-atualizado'), '1');
  } else {
    console.log('\n= Nenhum JSON precisou de atualização.');
  }
}

main();
