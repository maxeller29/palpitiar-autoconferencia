'use strict';
// atualizar-historico.js  —  CommonJS (sem import/export)
// Busca apenas os concursos novos da API da Caixa e os appenda ao JSON.
// Compatível com Node 18+ sem flags experimentais.

const fs   = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://servicebus2.caixa.gov.br/portaldeloterias/api';
const DELAY_MS = 800;

// ── Configuração das loterias ─────────────────────────────
const LOTERIAS = [
  {
    id:      'mega-sena',
    slug:    'megasena',
    arquivo: 'mega-sena-historico.json',
    qtdDez:  6,
    premios(r) {
      const p = {}, f = r.premiacoes || [];
      const mF = { 0:'s',  1:'qn',  2:'qd'  };
      const mG = { 0:'gs', 1:'gqn', 2:'gqd' };
      f.forEach((x, i) => {
        if (mF[i]) { p[mF[i]] = x.valorPremio || 0; p[mG[i]] = x.numeradorGanhadores || 0; }
      });
      return p;
    }
  },
  {
    id:      'lotofacil',
    slug:    'lotofacil',
    arquivo: 'lotofacil-historico.json',
    qtdDez:  15,
    premios(r) {
      const p = {}, f = r.premiacoes || [];
      const mF = { 0:'15', 1:'14', 2:'13', 3:'12', 4:'11' };
      const mG = { 0:'g15',1:'g14',2:'g13',3:'g12',4:'g11' };
      f.forEach((x, i) => {
        if (mF[i]) { p[mF[i]] = x.valorPremio || 0; p[mG[i]] = x.numeradorGanhadores || 0; }
      });
      return p;
    }
  },
  {
    id:      'quina',
    slug:    'quina',
    arquivo: 'quina-historico.json',
    qtdDez:  5,
    premios(r) {
      const p = {}, f = r.premiacoes || [];
      const mF = { 0:'5', 1:'4', 2:'3', 3:'2' };
      const mG = { 0:'g5',1:'g4',2:'g3',3:'g2' };
      f.forEach((x, i) => {
        if (mF[i]) { p[mF[i]] = x.valorPremio || 0; p[mG[i]] = x.numeradorGanhadores || 0; }
      });
      return p;
    }
  }
];

// ── Helpers ───────────────────────────────────────────────
function sleep(ms) {
  return new Promise(ok => setTimeout(ok, ms));
}

function formatarData(d) {
  if (!d) return null;
  const p = d.split('/');
  if (p.length !== 3) return d;
  return p[2] + '-' + p[1].padStart(2,'0') + '-' + p[0].padStart(2,'0');
}

// fetch() nativo disponível no Node 18+; fallback via https para Node 16
function fetchJSON(url) {
  // Node 18+ tem fetch global
  if (typeof fetch === 'function') {
    return fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; palpitiar-bot/1.0)'
      }
    }).then(res => {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status + ' para ' + url);
      return res.json();
    });
  }
  // Fallback Node 16 via https
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; palpitiar-bot/1.0)'
      }
    }, res => {
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' para ' + url));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Timeout')); });
  });
}

function calcularStats(draws, qtdDez) {
  const max = qtdDez === 6 ? 60 : qtdDez === 15 ? 25 : 80;
  const freqMap = {};
  for (let n = 1; n <= max; n++) freqMap[n] = 0;
  const ultimoSorteio = {};
  let somaTotal = 0, comAcert = 0, semAcert = 0;

  draws.forEach((d, idx) => {
    const dz = d[2], g = d[3] || 0;
    somaTotal += dz.reduce((s, n) => s + n, 0);
    if (g > 0) comAcert++; else semAcert++;
    dz.forEach(n => { freqMap[n] = (freqMap[n] || 0) + 1; ultimoSorteio[n] = idx; });
  });

  const total = draws.length, lastIdx = total - 1;
  const frequencia = {}, atraso = {};
  Object.keys(freqMap).forEach(n => {
    frequencia[n] = freqMap[n];
    atraso[n] = lastIdx - (ultimoSorteio[n] !== undefined ? ultimoSorteio[n] : -1);
  });

  const sorted = Object.entries(freqMap).sort((a, b) => b[1] - a[1]);
  const quentes = sorted.slice(0, 5).map(([n]) => Number(n));
  const frias   = sorted.slice(-5).map(([n]) => Number(n));
  const somas   = draws.map(d => d[2].reduce((s, n) => s + n, 0));
  const mediaPares = draws.reduce((s, d) => s + d[2].filter(n => n % 2 === 0).length, 0) / total;

  return {
    comAcertadores: comAcert,
    semAcertadores: semAcert,
    percentualComAcertadores: Number((comAcert / total * 100).toFixed(1)),
    frequencia, atraso, quentes, frias,
    somaMedia: Number((somaTotal / total).toFixed(1)),
    somaMin: Math.min.apply(null, somas),
    somaMax: Math.max.apply(null, somas),
    mediaPares: Number(mediaPares.toFixed(2))
  };
}

// ── Atualizar uma loteria ─────────────────────────────────
async function atualizarLoteria(cfg) {
  const arquivo = path.join(__dirname, cfg.arquivo);
  const existente = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const draws = existente.draws;
  const ultimoConcurso = draws[draws.length - 1][0];

  console.log('\n[' + cfg.id + '] Ultimo no JSON: concurso ' + ultimoConcurso);

  let proximo = ultimoConcurso + 1;
  let novos = 0;
  let ultimoProcessado = ultimoConcurso;
  let ultimaData = draws[draws.length - 1][1];

  while (true) {
    process.stdout.write('  -> Buscando concurso ' + proximo + '... ');
    let resultado;
    try {
      resultado = await fetchJSON(BASE_URL + '/' + cfg.slug + '/' + proximo);
    } catch (e) {
      console.log('ERRO: ' + e.message);
      break;
    }

    if (!resultado) {
      console.log('nao existe ainda. Fim.');
      break;
    }

    const dezenas = (resultado.listaDezenas || resultado.dezenas || [])
      .map(Number).sort((a, b) => a - b);

    if (dezenas.length !== cfg.qtdDez) {
      console.log('dezenas invalidas (' + dezenas.length + '). Pulando.');
      break;
    }

    const data       = formatarData(resultado.dataApuracao || resultado.data);
    const ganhadores = resultado.numeradorGanhadores || resultado.ganhadores || 0;
    const premiosObj = cfg.premios(resultado);

    draws.push([proximo, data, dezenas, ganhadores, premiosObj]);
    novos++;
    ultimoProcessado = proximo;
    ultimaData = data;
    console.log('OK (' + data + ') [' + dezenas.join(',') + ']');

    proximo++;
    await sleep(DELAY_MS);
  }

  if (novos === 0) {
    console.log('  = Nenhum concurso novo.');
    return false;
  }

  const stats = calcularStats(draws, cfg.qtdDez);
  const hoje  = new Date().toISOString().slice(0, 10);

  existente.draws = draws;
  existente.stats = stats;
  existente.meta  = Object.assign({}, existente.meta, {
    geradoEm: hoje,
    totalConcursos: draws.length,
    ultimoConcurso: ultimoProcessado,
    ultimaData: ultimaData,
    enriquecidoEm: hoje
  });

  fs.writeFileSync(arquivo, JSON.stringify(existente), 'utf8');
  console.log('  + ' + cfg.arquivo + ' salvo: ' + draws.length + ' concursos (+' + novos + ' novos).');
  return true;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('=== Atualizar historico de loterias ===');
  console.log('Data: ' + new Date().toISOString());
  console.log('Node: ' + process.version);

  let algumAtualizado = false;

  for (let i = 0; i < LOTERIAS.length; i++) {
    const cfg = LOTERIAS[i];
    try {
      const ok = await atualizarLoteria(cfg);
      if (ok) algumAtualizado = true;
    } catch (e) {
      console.error('[' + cfg.id + '] ERRO FATAL: ' + e.message);
      console.error(e.stack);
      process.exitCode = 1;
    }
  }

  if (algumAtualizado) {
    console.log('\n[OK] JSONs atualizados — commit sera realizado.');
    fs.writeFileSync(path.join(__dirname, '.historico-atualizado'), '1');
  } else {
    console.log('\n[OK] Nenhum JSON precisou de atualizacao.');
  }
}

main().catch(e => {
  console.error('ERRO INESPERADO:', e.message);
  process.exit(1);
});
