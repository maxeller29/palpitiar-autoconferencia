#!/usr/bin/env node
// scripts/gerar-cards.js
// Uso: node scripts/gerar-cards.js
// Gera cards/cards-YYYY-MM-DD.html com dados em tempo real da API da Caixa.
// Apenas loterias com sorteio no dia atual recebem card.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── API ────────────────────────────────────────────────────────────────────
function fetchCaixa(endpoint) {
  return new Promise((resolve) => {
    const url = `https://servicebus2.caixa.gov.br/portaldeloterias/api/${endpoint}/`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
        'Accept':     'application/json',
        'Referer':    'https://loterias.caixa.gov.br/',
        'Origin':     'https://loterias.caixa.gov.br',
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(null); }
      });
    });
    req.on('error', (e) => {
      console.error(`  ⚠ Erro ${endpoint}: ${e.message}`);
      resolve(null);
    });
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

// ─── FORMATADORES ────────────────────────────────────────────────────────────
function formatPremio(valor) {
  if (!valor || valor <= 0) return '—';
  if (valor >= 1_000_000_000) {
    const b = valor / 1_000_000_000;
    return `${b % 1 === 0 ? b : b.toFixed(1).replace('.', ',')} bilhão`;
  }
  if (valor >= 1_000_000) return `${Math.round(valor / 1_000_000)} milhões`;
  return `R$ ${valor.toLocaleString('pt-BR', {minimumFractionDigits: 0})}`;
}

function ptbrDate(d) {
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// ─── CONTA CONCURSOS ACUMULADOS DO HISTORICO JSON ────────────────────────────
function contarAcumulados(historicoPath, ultimoConcursoAPI) {
  try {
    const h = JSON.parse(fs.readFileSync(historicoPath, 'utf8'));
    const draws = h.draws;
    if (!draws) return 0;
    const keys = Object.keys(draws).map(Number).sort((a,b) => a-b);
    let count = 0;
    for (let i = keys.length - 1; i >= 0; i--) {
      const entry = draws[keys[i]]; // [numero, data, dezenas, ?, {premios}]
      const p = entry[4];
      let ganhadores = 0;
      if (p && typeof p === 'object') {
        ganhadores = p.gs ?? p.g5 ?? p.g15 ?? 0;
      }
      if (ganhadores === 0) count++;
      else break;
    }
    if (ultimoConcursoAPI) count++;
    return count;
  } catch {
    return 0;
  }
}

// ─── EXTRAI DADOS DA RESPOSTA DA CAIXA ───────────────────────────────────────
function extrairDados(json, nome, historicoFile) {
  if (!json) return { ok: false, nome };
  const acumulado = !!json.acumulado;
  let acumHa = 0;
  if (acumulado && historicoFile) {
    const fullPath = path.join(process.cwd(), historicoFile);
    if (fs.existsSync(fullPath)) {
      acumHa = contarAcumulados(fullPath, true);
    }
  }
  return {
    ok:       true,
    nome,
    concurso: json.numero || 0,
    proximo:  json.numeroConcursoProximo || (json.numero + 1),
    dataProx: json.dataProximoConcurso   || '',
    acumulado,
    acumHa,
    premio:   json.valorEstimadoProximoConcurso || json.valorAcumuladoProximoConcurso || 0,
  };
}

// ─── VERIFICA SE HÁ CONCURSO HOJE ────────────────────────────────────────────
function hasDrawToday(dados, today) {
  if (!dados.ok || !dados.dataProx) return false;
  return dados.dataProx === ptbrDate(today);
}

// ─── TEMPLATE HTML ───────────────────────────────────────────────────────────
function gerarHTML(dados, today) {
  const { ms, lf, qn, lm, ds, tm, dds, ml } = dados;
  const todayStr = ptbrDate(today);

  const show = {
    ms:  ms.ok  && hasDrawToday(ms,  today),
    lf:  lf.ok  && hasDrawToday(lf,  today),
    qn:  qn.ok  && hasDrawToday(qn,  today),
    lm:  lm.ok  && hasDrawToday(lm,  today),
    ds:  ds.ok  && hasDrawToday(ds,  today),
    tm:  tm.ok  && hasDrawToday(tm,  today),
    dds: dds.ok && hasDrawToday(dds, today),
    ml:  ml.ok  && hasDrawToday(ml,  today),
  };

  const totalCards = Object.values(show).filter(Boolean).length + 1; // +1 analisador

  function badgeText(d) {
    if (!d.acumulado) return 'Sorteio hoje';
    if (d.acumHa > 0) return `Acumulada · há ${d.acumHa} concurso${d.acumHa !== 1 ? 's' : ''}`;
    return 'Acumulada';
  }

  let cardNum = 0;
  function mkLabel(nome, concurso) {
    return `<p class="card-label">Card ${++cardNum} · ${nome} · Concurso ${concurso}</p>`;
  }

  // ─── Seções por loteria ───────────────────────────────────────────────────

  const megaSection = !show.ms ? '' : (() => {
    const badge = badgeText(ms);
    const title = ms.acumulado
      ? `O prêmio<br>está <em>acumulado.</em><br>Você gerou<br>seus números?`
      : `Mega-Sena<br><em>sorteio hoje.</em><br>Gere seus<br>números grátis.`;
    return `
${mkLabel('Mega-Sena', ms.proximo)}
<div class="card card-mega">
  <div class="mega-glow-tl"></div>
  <div class="mega-glow-br"></div>
  <div class="mega-grid"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Mega-Sena · ${badge}</div>
    <div class="headline">${title}</div>
  </div>
  <div class="mega-prize-block">
    <div class="prize-label">Prêmio estimado · Concurso ${ms.proximo} · ${ms.dataProx || todayStr}</div>
    <div class="prize-value"><span class="rs">R$</span>&nbsp;${formatPremio(ms.premio)}</div>
    <div class="prize-sub">palpitiar.com.br/mega-sena</div>
  </div>
  <div class="bottom"><div class="cta-btn">Gerar combinações grátis →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  const facilSection = !show.lf ? '' : (() => {
    const badge = badgeText(lf);
    return `
${mkLabel('Lotofácil', lf.proximo)}
<div class="card card-facil">
  <div class="facil-glow-tr"></div>
  <div class="facil-glow-bl"></div>
  <div class="facil-dots"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Lotofácil · ${badge}</div>
    <div class="headline">Lotofácil<br><em>sorteio hoje.</em></div>
    <div class="sub">15 dezenas geradas por IA com análise de 3.700+ concursos — grátis e sem cadastro.</div>
  </div>
  <div class="facil-prize-block">
    <div class="prize-label">Prêmio estimado · Concurso ${lf.proximo} · ${lf.dataProx || todayStr}</div>
    <div class="prize-value"><span class="rs">R$</span>&nbsp;${formatPremio(lf.premio)}</div>
    <div class="prize-sub">palpitiar.com.br/lotofacil</div>
  </div>
  <div class="bottom"><div class="cta-btn">Gerar dezenas agora →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  const quinaSection = !show.qn ? '' : (() => {
    const badge = badgeText(qn);
    const title = qn.acumulado
      ? `Quina acumulada.<br><em>Gere seus<br>números.</em>`
      : `Quina<br><em>sorteio hoje.</em>`;
    return `
${mkLabel('Quina', qn.proximo)}
<div class="card card-quina">
  <div class="quina-glow-tl"></div>
  <div class="quina-glow-br"></div>
  <div class="quina-lines"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Quina · ${badge}</div>
    <div class="headline">${title}</div>
  </div>
  <div class="quina-prize-block">
    <div class="prize-label">Prêmio estimado · Concurso ${qn.proximo} · ${qn.dataProx || todayStr}</div>
    <div class="prize-value"><span class="rs">R$</span>&nbsp;${formatPremio(qn.premio)}</div>
    <div class="prize-sub">palpitiar.com.br/quina</div>
  </div>
  <div class="bottom"><div class="cta-btn">Gerar combinações grátis →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  const lmSection = !show.lm ? '' : (() => {
    const badge = badgeText(lm);
    const title = lm.acumulado
      ? `Lotomania<br><em>acumulada.</em><br>Gere seus<br>números.`
      : `Loto<em>mania</em><br><em>sorteio hoje.</em>`;
    return `
${mkLabel('Lotomania', lm.proximo)}
<div class="card card-lm">
  <div class="lm-glow-tl"></div>
  <div class="lm-glow-br"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Lotomania · ${badge}</div>
    <div class="headline">${title}</div>
  </div>
  <div class="lm-prize-block">
    <div class="prize-label">Prêmio estimado · Concurso ${lm.proximo} · ${lm.dataProx || todayStr}</div>
    <div class="prize-value"><span class="rs">R$</span>&nbsp;${formatPremio(lm.premio)}</div>
    <div class="prize-sub">palpitiar.com.br/lotomania</div>
  </div>
  <div class="bottom"><div class="cta-btn">Gerar combinações grátis →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  const dsSection = !show.ds ? '' : (() => {
    const badge = badgeText(ds);
    const title = ds.acumulado
      ? `Dupla Sena<br><em>acumulada.</em><br>Gere seus<br>números.`
      : `Dupla<em>Sena</em><br><em>sorteio hoje.</em>`;
    return `
${mkLabel('Dupla Sena', ds.proximo)}
<div class="card card-ds">
  <div class="ds-glow-tl"></div>
  <div class="ds-glow-br"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Dupla Sena · ${badge}</div>
    <div class="headline">${title}</div>
  </div>
  <div class="ds-prize-block">
    <div class="prize-label">Prêmio estimado · Concurso ${ds.proximo} · ${ds.dataProx || todayStr}</div>
    <div class="prize-value"><span class="rs">R$</span>&nbsp;${formatPremio(ds.premio)}</div>
    <div class="prize-sub">palpitiar.com.br/dupla-sena</div>
  </div>
  <div class="bottom"><div class="cta-btn">Gerar combinações grátis →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  const tmSection = !show.tm ? '' : (() => {
    const badge = badgeText(tm);
    const title = tm.acumulado
      ? `Timemania<br><em>acumulada.</em><br>Gere seus<br>números.`
      : `Time<em>mania</em><br><em>sorteio hoje.</em>`;
    return `
${mkLabel('Timemania', tm.proximo)}
<div class="card card-tm">
  <div class="tm-glow-tl"></div>
  <div class="tm-glow-br"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Timemania · ${badge}</div>
    <div class="headline">${title}</div>
  </div>
  <div class="tm-prize-block">
    <div class="prize-label">Prêmio estimado · Concurso ${tm.proximo} · ${tm.dataProx || todayStr}</div>
    <div class="prize-value"><span class="rs">R$</span>&nbsp;${formatPremio(tm.premio)}</div>
    <div class="prize-sub">palpitiar.com.br/timemania</div>
  </div>
  <div class="bottom"><div class="cta-btn">Gerar combinações grátis →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  const ddsSection = !show.dds ? '' : (() => {
    const badge = badgeText(dds);
    const title = dds.acumulado
      ? `Dia de Sorte<br><em>acumulado.</em><br>Gere seus<br>números.`
      : `Dia de<br><em>Sorte hoje.</em>`;
    return `
${mkLabel('Dia de Sorte', dds.proximo)}
<div class="card card-dds">
  <div class="dds-glow-tl"></div>
  <div class="dds-glow-br"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Dia de Sorte · ${badge}</div>
    <div class="headline">${title}</div>
  </div>
  <div class="dds-prize-block">
    <div class="prize-label">Prêmio estimado · Concurso ${dds.proximo} · ${dds.dataProx || todayStr}</div>
    <div class="prize-value"><span class="rs">R$</span>&nbsp;${formatPremio(dds.premio)}</div>
    <div class="prize-sub">palpitiar.com.br/diadesorte</div>
  </div>
  <div class="bottom"><div class="cta-btn">Gerar combinações grátis →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  const mlSection = !show.ml ? '' : (() => {
    const badge = badgeText(ml);
    const title = ml.acumulado
      ? `O prêmio<br>está <em>acumulado.</em><br>Você gerou<br>seus números?`
      : `A Mais<br><em>Milionária</em><br>sorteio hoje.`;
    return `
${mkLabel('Milionária', ml.proximo)}
<div class="card card-ml">
  <div class="ml-glow-tl"></div>
  <div class="ml-glow-br"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Milionária · ${badge}</div>
    <div class="headline">${title}</div>
  </div>
  <div class="ml-prize-block">
    <div class="prize-label">Prêmio estimado · Concurso ${ml.proximo} · ${ml.dataProx || todayStr}</div>
    <div class="prize-value"><span class="rs">R$</span>&nbsp;${formatPremio(ml.premio)}</div>
    <div class="prize-sub">palpitiar.com.br/milionaria</div>
  </div>
  <div class="bottom"><div class="cta-btn">Gerar combinações grátis →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  const analisaSection = (() => {
    return `
${mkLabel('Analisador', 'Análise')}
<div class="card card-analisa">
  <div class="analisa-glow-c"></div>
  <div class="analisa-glow-bl"></div>
  <img class="brand-icon" src="../icon-512.png" alt="Palpitiar">
  <div class="top">
    <div class="badge"><span class="badge-dot"></span>Palpitiar · Analisador</div>
    <div class="headline">Seus números<br><em>são bons<br>de verdade?</em></div>
  </div>
  <div class="analisa-mockup">
    <div class="mockup-hint">Sua combinação analisada</div>
    <div class="mockup-balls">
      <div class="num-ball hot">07</div>
      <div class="num-ball mid">14</div>
      <div class="num-ball hot">23</div>
      <div class="num-ball cold">31</div>
      <div class="num-ball mid">42</div>
      <div class="num-ball hot">58</div>
    </div>
    <div class="mockup-bars">
      <div>
        <div class="bar-label">Frequência</div>
        <div class="bar-track"><div class="bar-fill good"></div></div>
        <div class="bar-value good">Ótima · 78%</div>
      </div>
      <div>
        <div class="bar-label">Distribuição</div>
        <div class="bar-track"><div class="bar-fill blue"></div></div>
        <div class="bar-value blue">Boa · 70%</div>
      </div>
      <div>
        <div class="bar-label">Paridade</div>
        <div class="bar-track"><div class="bar-fill mid"></div></div>
        <div class="bar-value mid">Regular · 3×3</div>
      </div>
    </div>
  </div>
  <div class="bottom"><div class="cta-btn">Testar meus números →</div></div>
  <div class="mascot-bubble"><img src="../coruja.png" alt="Coruja Palpitiar"></div>
</div>`;
  })();

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cards Palpitiar — ${todayStr}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,400;9..144,0,600;9..144,0,800;9..144,1,800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #0d0d0d;
  font-family: 'Fraunces', Georgia, serif;
  padding: 40px 40px 80px;
  display: flex;
  flex-direction: column;
  gap: 0;
  align-items: center;
}

/* ─── GUIDE ─── */
.guide {
  width: 1080px;
  margin-bottom: 40px;
  padding: 24px 32px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 12px;
  color: rgba(255,255,255,0.55);
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  line-height: 1.7;
}
.guide strong { color: #d4a84b; }
.guide h2 { font-size: 15px; color: rgba(255,255,255,0.8); margin-bottom: 10px; letter-spacing: 0.05em; }

.card-label {
  width: 1080px;
  padding: 20px 0 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.2);
  border-top: 1px solid #222;
  margin-top: 48px;
}
.card-label:first-of-type { margin-top: 0; border-top: none; }

/* ─── CARD BASE ─── */
.card {
  width: 1080px;
  height: 1080px;
  position: relative;
  overflow: hidden;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 72px;
  flex-shrink: 0;
}

/* ─── SHARED ELEMENTS ─── */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  padding: 8px 20px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  letter-spacing: 0.05em;
  margin-bottom: 40px;
}
.badge-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.prize-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.prize-value {
  font-size: 96px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}
.prize-value .rs {
  font-size: 44px;
  vertical-align: top;
  margin-top: 14px;
  display: inline-block;
}
.prize-sub {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  margin-top: 8px;
  opacity: 0.4;
}

.cta-btn {
  font-family: 'JetBrains Mono', monospace;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 18px 40px;
  border-radius: 12px;
  display: inline-block;
}
.draw-info { text-align: right; }
.draw-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  opacity: 0.3;
  margin-bottom: 4px;
}
.draw-date { font-size: 24px; font-weight: 600; opacity: 0.5; }

.brand-icon {
  position: absolute;
  top: 62px; right: 62px;
  width: 80px; height: 80px;
  object-fit: contain;
  z-index: 3;
  mix-blend-mode: screen;
  opacity: 0.9;
}

.mascot-bubble {
  position: absolute;
  bottom: 54px; right: 54px;
  width: 190px; height: 190px;
  border-radius: 50%;
  overflow: hidden;
  z-index: 3;
  border: 2px solid rgba(212,168,75,0.35);
  background: rgba(255,255,255,0.03);
}
.mascot-bubble img {
  width: 118%; height: 118%;
  object-fit: cover;
  object-position: 44% 8%;
  margin-left: -9%; margin-top: -4%;
}

/* ─── COMMON TOP/BOTTOM FOR ALL CARDS ─── */
.card .top { position: relative; z-index: 1; }
.card .bottom {
  position: relative; z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

/* ═══ CARD — MEGA-SENA ══════════════════════════════════════════════════════ */
.card-mega { background: #03120A; }
.mega-glow-tl {
  position: absolute; top: -200px; left: -200px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(0,166,81,0.28) 0%, transparent 65%);
  pointer-events: none;
}
.mega-glow-br {
  position: absolute; bottom: -300px; right: -150px;
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(0,166,81,0.12) 0%, transparent 60%);
  pointer-events: none;
}
.mega-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(0,166,81,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,166,81,0.04) 1px, transparent 1px);
  background-size: 72px 72px; pointer-events: none;
}
.card-mega .badge { background: rgba(0,166,81,0.15); border: 1px solid rgba(0,166,81,0.4); color: #00A651; }
.card-mega .badge-dot { background: #00A651; box-shadow: 0 0 8px #00A651; }
.card-mega .headline { font-size: 68px; font-weight: 800; line-height: 1.05; letter-spacing: -0.03em; color: #f4ebd0; }
.card-mega .headline em { font-style: italic; color: #00A651; }
.mega-prize-block {
  position: relative; z-index: 1;
  margin: 0 -72px; padding: 40px 72px;
  background: linear-gradient(90deg, rgba(0,166,81,0.14), rgba(0,166,81,0.04));
  border-top: 1px solid rgba(0,166,81,0.2);
  border-bottom: 1px solid rgba(0,166,81,0.2);
}
.card-mega .prize-label { color: rgba(0,166,81,0.7); }
.card-mega .prize-value { color: #f4ebd0; }
.card-mega .prize-value .rs { color: #00A651; }
.card-mega .prize-sub { color: #f4ebd0; }
.card-mega .cta-btn { background: #00A651; color: #03120A; }
.card-mega .mascot-bubble { border-color: rgba(0,166,81,0.5); }

/* ═══ CARD — LOTOFÁCIL ══════════════════════════════════════════════════════ */
.card-facil { background: #07030F; }
.facil-glow-tr {
  position: absolute; top: -150px; right: -150px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(123,47,190,0.32) 0%, transparent 60%);
  pointer-events: none;
}
.facil-glow-bl {
  position: absolute; bottom: -200px; left: -100px;
  width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, rgba(123,47,190,0.14) 0%, transparent 60%);
  pointer-events: none;
}
.facil-dots {
  position: absolute; inset: 0;
  background-image: radial-gradient(rgba(123,47,190,0.12) 1px, transparent 1px);
  background-size: 40px 40px; pointer-events: none;
}
.card-facil .badge { background: rgba(123,47,190,0.2); border: 1px solid rgba(123,47,190,0.5); color: #b06ef0; }
.card-facil .badge-dot { background: #b06ef0; box-shadow: 0 0 8px rgba(176,110,240,0.8); }
.card-facil .headline { font-size: 72px; font-weight: 800; line-height: 1.0; letter-spacing: -0.03em; color: #f4ebd0; }
.card-facil .headline em { font-style: italic; color: #b06ef0; }
.card-facil .sub { margin-top: 18px; font-size: 20px; color: rgba(244,235,208,0.4); line-height: 1.5; max-width: 560px; font-weight: 300; }
.facil-prize-block {
  position: relative; z-index: 1;
  margin: 0 -72px; padding: 36px 72px;
  background: linear-gradient(90deg, rgba(123,47,190,0.18), rgba(123,47,190,0.05));
  border-top: 1px solid rgba(123,47,190,0.25);
  border-bottom: 1px solid rgba(123,47,190,0.25);
}
.card-facil .prize-label { color: rgba(176,110,240,0.7); }
.card-facil .prize-value { color: #f4ebd0; }
.card-facil .prize-value .rs { color: #b06ef0; }
.card-facil .prize-sub { color: #f4ebd0; }
.card-facil .cta-btn { background: #7B2FBE; color: #f4ebd0; box-shadow: 0 0 32px rgba(123,47,190,0.4); }
.card-facil .mascot-bubble { border-color: rgba(123,47,190,0.5); }

/* ═══ CARD — QUINA ══════════════════════════════════════════════════════════ */
.card-quina { background: #02080F; }
.quina-glow-tl {
  position: absolute; top: -180px; left: -180px;
  width: 650px; height: 650px; border-radius: 50%;
  background: radial-gradient(circle, rgba(107,140,218,0.28) 0%, transparent 65%);
  pointer-events: none;
}
.quina-glow-br {
  position: absolute; bottom: -280px; right: -100px;
  width: 750px; height: 750px; border-radius: 50%;
  background: radial-gradient(circle, rgba(107,140,218,0.12) 0%, transparent 60%);
  pointer-events: none;
}
.quina-lines {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(107,140,218,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(107,140,218,0.04) 1px, transparent 1px);
  background-size: 54px 54px; pointer-events: none;
}
.card-quina .badge { background: rgba(107,140,218,0.14); border: 1px solid rgba(107,140,218,0.4); color: #6b8cda; }
.card-quina .badge-dot { background: #6b8cda; box-shadow: 0 0 8px rgba(107,140,218,0.8); }
.card-quina .headline { font-size: 68px; font-weight: 800; line-height: 1.05; letter-spacing: -0.03em; color: #f4ebd0; }
.card-quina .headline em { font-style: italic; color: #6b8cda; }
.quina-prize-block {
  position: relative; z-index: 1;
  margin: 0 -72px; padding: 40px 72px;
  background: linear-gradient(90deg, rgba(107,140,218,0.12), rgba(107,140,218,0.04));
  border-top: 1px solid rgba(107,140,218,0.2);
  border-bottom: 1px solid rgba(107,140,218,0.2);
}
.card-quina .prize-label { color: rgba(107,140,218,0.7); }
.card-quina .prize-value { color: #f4ebd0; }
.card-quina .prize-value .rs { color: #6b8cda; }
.card-quina .prize-sub { color: #f4ebd0; }
.card-quina .cta-btn { background: rgba(107,140,218,0.18); border: 1.5px solid rgba(107,140,218,0.5); color: #6b8cda; }
.card-quina .mascot-bubble { border-color: rgba(107,140,218,0.5); }

/* ═══ CARD — LOTOMANIA ══════════════════════════════════════════════════════ */
.card-lm { background: #0A0400; }
.lm-glow-tl {
  position: absolute; top: -200px; left: -200px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232,119,34,0.25) 0%, transparent 65%);
  pointer-events: none;
}
.lm-glow-br {
  position: absolute; bottom: -300px; right: -150px;
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232,119,34,0.10) 0%, transparent 60%);
  pointer-events: none;
}
.card-lm .badge { background: rgba(232,119,34,0.15); border: 1px solid rgba(232,119,34,0.4); color: #e87722; }
.card-lm .badge-dot { background: #e87722; box-shadow: 0 0 8px #e87722; }
.card-lm .headline { font-size: 72px; font-weight: 800; line-height: 1.0; letter-spacing: -0.03em; color: #f4ebd0; }
.card-lm .headline em { font-style: italic; color: #e87722; }
.lm-prize-block {
  position: relative; z-index: 1;
  margin: 0 -72px; padding: 40px 72px;
  background: linear-gradient(90deg, rgba(232,119,34,0.14), rgba(232,119,34,0.04));
  border-top: 1px solid rgba(232,119,34,0.2);
  border-bottom: 1px solid rgba(232,119,34,0.2);
}
.card-lm .prize-label { color: rgba(232,119,34,0.7); }
.card-lm .prize-value { color: #f4ebd0; }
.card-lm .prize-value .rs { color: #e87722; }
.card-lm .prize-sub { color: #f4ebd0; }
.card-lm .cta-btn { background: #e87722; color: #0A0400; }
.card-lm .mascot-bubble { border-color: rgba(232,119,34,0.5); }

/* ═══ CARD — DUPLA SENA ═════════════════════════════════════════════════════ */
.card-ds { background: #00080A; }
.ds-glow-tl {
  position: absolute; top: -180px; left: -180px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(0,180,204,0.25) 0%, transparent 65%);
  pointer-events: none;
}
.ds-glow-br {
  position: absolute; bottom: -300px; right: -150px;
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(0,180,204,0.10) 0%, transparent 60%);
  pointer-events: none;
}
.card-ds .badge { background: rgba(0,180,204,0.15); border: 1px solid rgba(0,180,204,0.4); color: #00b4cc; }
.card-ds .badge-dot { background: #00b4cc; box-shadow: 0 0 8px #00b4cc; }
.card-ds .headline { font-size: 72px; font-weight: 800; line-height: 1.0; letter-spacing: -0.03em; color: #f4ebd0; }
.card-ds .headline em { font-style: italic; color: #00b4cc; }
.ds-prize-block {
  position: relative; z-index: 1;
  margin: 0 -72px; padding: 40px 72px;
  background: linear-gradient(90deg, rgba(0,180,204,0.14), rgba(0,180,204,0.04));
  border-top: 1px solid rgba(0,180,204,0.2);
  border-bottom: 1px solid rgba(0,180,204,0.2);
}
.card-ds .prize-label { color: rgba(0,180,204,0.7); }
.card-ds .prize-value { color: #f4ebd0; }
.card-ds .prize-value .rs { color: #00b4cc; }
.card-ds .prize-sub { color: #f4ebd0; }
.card-ds .cta-btn { background: #00b4cc; color: #00080A; }
.card-ds .mascot-bubble { border-color: rgba(0,180,204,0.5); }

/* ═══ CARD — TIMEMANIA ══════════════════════════════════════════════════════ */
.card-tm { background: #020800; }
.tm-glow-tl {
  position: absolute; top: -200px; left: -200px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(124,179,0,0.25) 0%, transparent 65%);
  pointer-events: none;
}
.tm-glow-br {
  position: absolute; bottom: -300px; right: -150px;
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(124,179,0,0.10) 0%, transparent 60%);
  pointer-events: none;
}
.card-tm .badge { background: rgba(124,179,0,0.15); border: 1px solid rgba(124,179,0,0.4); color: #7cb300; }
.card-tm .badge-dot { background: #7cb300; box-shadow: 0 0 8px #7cb300; }
.card-tm .headline { font-size: 72px; font-weight: 800; line-height: 1.0; letter-spacing: -0.03em; color: #f4ebd0; }
.card-tm .headline em { font-style: italic; color: #7cb300; }
.tm-prize-block {
  position: relative; z-index: 1;
  margin: 0 -72px; padding: 40px 72px;
  background: linear-gradient(90deg, rgba(124,179,0,0.14), rgba(124,179,0,0.04));
  border-top: 1px solid rgba(124,179,0,0.2);
  border-bottom: 1px solid rgba(124,179,0,0.2);
}
.card-tm .prize-label { color: rgba(124,179,0,0.7); }
.card-tm .prize-value { color: #f4ebd0; }
.card-tm .prize-value .rs { color: #7cb300; }
.card-tm .prize-sub { color: #f4ebd0; }
.card-tm .cta-btn { background: #7cb300; color: #020800; }
.card-tm .mascot-bubble { border-color: rgba(124,179,0,0.5); }

/* ═══ CARD — DIA DE SORTE ═══════════════════════════════════════════════════ */
.card-dds { background: #0A0205; }
.dds-glow-tl {
  position: absolute; top: -180px; left: -180px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(196,64,110,0.25) 0%, transparent 65%);
  pointer-events: none;
}
.dds-glow-br {
  position: absolute; bottom: -300px; right: -150px;
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(196,64,110,0.10) 0%, transparent 60%);
  pointer-events: none;
}
.card-dds .badge { background: rgba(196,64,110,0.15); border: 1px solid rgba(196,64,110,0.4); color: #c4406e; }
.card-dds .badge-dot { background: #c4406e; box-shadow: 0 0 8px #c4406e; }
.card-dds .headline { font-size: 72px; font-weight: 800; line-height: 1.0; letter-spacing: -0.03em; color: #f4ebd0; }
.card-dds .headline em { font-style: italic; color: #c4406e; }
.dds-prize-block {
  position: relative; z-index: 1;
  margin: 0 -72px; padding: 40px 72px;
  background: linear-gradient(90deg, rgba(196,64,110,0.14), rgba(196,64,110,0.04));
  border-top: 1px solid rgba(196,64,110,0.2);
  border-bottom: 1px solid rgba(196,64,110,0.2);
}
.card-dds .prize-label { color: rgba(196,64,110,0.7); }
.card-dds .prize-value { color: #f4ebd0; }
.card-dds .prize-value .rs { color: #c4406e; }
.card-dds .prize-sub { color: #f4ebd0; }
.card-dds .cta-btn { background: #c4406e; color: #f4ebd0; }
.card-dds .mascot-bubble { border-color: rgba(196,64,110,0.5); }

/* ═══ CARD — MILIONÁRIA ═════════════════════════════════════════════════════ */
.card-ml { background: #06030F; }
.ml-glow-tl {
  position: absolute; top: -200px; left: -200px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(147,51,234,0.28) 0%, transparent 65%);
  pointer-events: none;
}
.ml-glow-br {
  position: absolute; bottom: -300px; right: -150px;
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(147,51,234,0.12) 0%, transparent 60%);
  pointer-events: none;
}
.card-ml .badge { background: rgba(147,51,234,0.15); border: 1px solid rgba(147,51,234,0.4); color: #9333ea; }
.card-ml .badge-dot { background: #9333ea; box-shadow: 0 0 8px #9333ea; }
.card-ml .headline { font-size: 68px; font-weight: 800; line-height: 1.05; letter-spacing: -0.03em; color: #f4ebd0; }
.card-ml .headline em { font-style: italic; color: #9333ea; }
.ml-prize-block {
  position: relative; z-index: 1;
  margin: 0 -72px; padding: 40px 72px;
  background: linear-gradient(90deg, rgba(147,51,234,0.14), rgba(147,51,234,0.04));
  border-top: 1px solid rgba(147,51,234,0.2);
  border-bottom: 1px solid rgba(147,51,234,0.2);
}
.card-ml .prize-label { color: rgba(147,51,234,0.7); }
.card-ml .prize-value { color: #f4ebd0; }
.card-ml .prize-value .rs { color: #9333ea; }
.card-ml .prize-sub { color: #f4ebd0; }
.card-ml .cta-btn { background: #9333ea; color: #f4ebd0; }
.card-ml .mascot-bubble { border-color: rgba(147,51,234,0.5); }

/* ═══ CARD — ANALISADOR ═════════════════════════════════════════════════════ */
.card-analisa { background: #060D0A; }
.analisa-glow-c {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 900px; height: 900px; border-radius: 50%;
  background: radial-gradient(circle, rgba(212,168,75,0.08) 0%, transparent 60%);
  pointer-events: none;
}
.analisa-glow-bl {
  position: absolute; bottom: -100px; left: -100px;
  width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, rgba(76,175,125,0.1) 0%, transparent 60%);
  pointer-events: none;
}
.card-analisa .badge { background: rgba(212,168,75,0.1); border: 1px solid rgba(212,168,75,0.35); color: #d4a84b; }
.card-analisa .badge-dot { background: #d4a84b; box-shadow: 0 0 8px rgba(212,168,75,0.6); }
.card-analisa .headline { font-size: 72px; font-weight: 800; line-height: 1.0; letter-spacing: -0.03em; color: #f4ebd0; max-width: 680px; }
.card-analisa .headline em { font-style: italic; color: #d4a84b; display: block; }
.analisa-mockup { position: relative; z-index: 1; margin: 32px 0; }
.mockup-hint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
  color: rgba(244,235,208,0.28); margin-bottom: 18px;
}
.mockup-balls { display: flex; gap: 14px; margin-bottom: 28px; }
.num-ball {
  width: 80px; height: 80px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 700; font-family: 'JetBrains Mono', monospace;
}
.num-ball.hot { background: rgba(212,168,75,0.15); border: 2px solid rgba(212,168,75,0.5); color: #d4a84b; }
.num-ball.cold { background: rgba(107,140,218,0.12); border: 2px solid rgba(107,140,218,0.35); color: #6b8cda; }
.num-ball.mid { background: rgba(244,235,208,0.06); border: 2px solid rgba(244,235,208,0.15); color: rgba(244,235,208,0.5); }
.mockup-bars { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.bar-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(244,235,208,0.35); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; }
.bar-track { height: 6px; background: rgba(244,235,208,0.07); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; }
.bar-fill.good { background: #4caf7d; width: 78%; }
.bar-fill.mid  { background: #d4a84b; width: 55%; }
.bar-fill.blue { background: #6b8cda; width: 70%; }
.bar-value { font-family: 'JetBrains Mono', monospace; font-size: 12px; margin-top: 6px; }
.bar-value.good { color: #4caf7d; }
.bar-value.mid  { color: #d4a84b; }
.bar-value.blue { color: #6b8cda; }
.card-analisa .cta-btn { background: rgba(212,168,75,0.12); border: 1.5px solid rgba(212,168,75,0.5); color: #d4a84b; }
.card-analisa .mascot-bubble { border-color: rgba(212,168,75,0.5); }

@media print {
  body { background: #0d0d0d; padding: 0; }
  .guide, .card-label { display: none; }
  .card { page-break-after: always; border-radius: 0; }
}
</style>
</head>
<body>

<div class="guide">
  <h2>📸 CARDS PALPITIAR — ${todayStr}</h2>
  Gerado automaticamente em ${new Date().toLocaleTimeString('pt-BR')} · Dados em tempo real da API da Caixa.<br>
  Total de cards gerados hoje: <strong>${totalCards}</strong> (loterias com sorteio + analisador).<br><br>
  <strong>Como capturar:</strong> No Chrome, pressione <strong>F12 → ⋮ → More tools → Capture node screenshot</strong> em cada .card,<br>
  ou use a extensão <strong>GoFullPage</strong> para capturar todos de uma vez e cortar depois.<br>
  Cada card mede <strong>1080 × 1080 px</strong> — pronto para Instagram e Facebook.
</div>

${megaSection}
${facilSection}
${quinaSection}
${lmSection}
${dsSection}
${tmSection}
${ddsSection}
${mlSection}
${analisaSection}

</body>
</html>`;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🎲 Gerador de Cards Palpitiar\n');
  console.log('⏳ Buscando dados em tempo real...\n');

  const [megaRaw, facilRaw, quinaRaw, lmRaw, dsRaw, tmRaw, ddsRaw, mlRaw] = await Promise.all([
    fetchCaixa('megasena'),
    fetchCaixa('lotofacil'),
    fetchCaixa('quina'),
    fetchCaixa('lotomania'),
    fetchCaixa('duplasena'),
    fetchCaixa('timemania'),
    fetchCaixa('diadesorte'),
    fetchCaixa('maismilionaria'),
  ]);

  const ms  = extrairDados(megaRaw,  'Mega-Sena',    'mega-sena-historico.json');
  const lf  = extrairDados(facilRaw, 'Lotofácil',    'lotofacil-historico.json');
  const qn  = extrairDados(quinaRaw, 'Quina',        'quina-historico.json');
  const lm  = extrairDados(lmRaw,    'Lotomania',    null);
  const ds  = extrairDados(dsRaw,    'Dupla Sena',   null);
  const tm  = extrairDados(tmRaw,    'Timemania',    null);
  const dds = extrairDados(ddsRaw,   'Dia de Sorte', null);
  const ml  = extrairDados(mlRaw,    'Milionária',   null);

  const today = new Date();

  // Relatório
  console.log('  Loteria        Concurso     Prêmio         Hoje?   Próximo concurso');
  console.log('  ' + '─'.repeat(72));
  [ms, lf, qn, lm, ds, tm, dds, ml].forEach(d => {
    if (!d.ok) {
      console.log(`  ❌ ${d.nome.padEnd(14)} —`);
      return;
    }
    const sorteioHoje = hasDrawToday(d, today);
    const icon = sorteioHoje ? '✅' : '⬜';
    console.log(`  ${icon} ${d.nome.padEnd(14)} #${String(d.proximo).padEnd(6)} ${formatPremio(d.premio).padStart(14)}  ${sorteioHoje ? 'SIM' : 'não'}   ${d.dataProx || '?'}`);
  });
  console.log();

  const cardsDir = path.join(process.cwd(), 'cards');
  if (!fs.existsSync(cardsDir)) fs.mkdirSync(cardsDir, { recursive: true });

  const fileDate = today.toISOString().slice(0, 10);
  const filename = path.join(cardsDir, `cards-${fileDate}.html`);

  const html = gerarHTML({ ms, lf, qn, lm, ds, tm, dds, ml }, today);
  fs.writeFileSync(filename, html, 'utf8');

  console.log(`✅ Arquivo gerado: cards/cards-${fileDate}.html`);
  console.log(`\n📸 Como capturar:`);
  console.log(`   1. Abra o arquivo no Chrome`);
  console.log(`   2. F12 → clique com botão direito em .card → "Capture node screenshot"`);
  console.log(`   3. Repita para cada card`);
  console.log(`   Cada card: 1080×1080 px — pronto para Instagram e Facebook.\n`);
}

main().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
