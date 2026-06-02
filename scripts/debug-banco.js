/**
 * Palpitiar — Debug: inspeciona o que está no banco Supabase
 * Roda manualmente via: node scripts/debug-banco.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function query(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('🔍 Palpitiar — Debug do Banco Supabase');
  console.log('═══════════════════════════════════════════\n');

  // 1. Mostra todos os valores distintos de status e loteria
  console.log('📋 Amostra das primeiras 20 combinações (todos os campos):');
  const amostra = await query('combinacoes?select=id,loteria,concurso,status&order=id.desc&limit=20');
  console.table(amostra);

  // 2. Conta por status (exato)
  console.log('\n📊 Valores distintos de STATUS no banco:');
  const todos = await query('combinacoes?select=status&limit=1000');
  const porStatus = {};
  for (const r of todos) {
    const s = JSON.stringify(r.status); // mostra null, "pendente", "Pendente", etc
    porStatus[s] = (porStatus[s] || 0) + 1;
  }
  console.table(porStatus);

  // 3. Conta por loteria (exato)
  console.log('\n📊 Valores distintos de LOTERIA no banco:');
  const porLoteria = {};
  for (const r of todos) {
    const l = JSON.stringify(r.loteria);
    porLoteria[l] = (porLoteria[l] || 0) + 1;
  }
  console.table(porLoteria);

  // 4. Testa a query exata que o script usa
  console.log('\n🔎 Teste da query exata do script (status=eq.pendente, loteria=eq.lotofacil):');
  const testeLotofacil = await query('combinacoes?loteria=eq.lotofacil&status=eq.pendente&select=id&limit=5');
  console.log(`  Resultado: ${testeLotofacil.length} registros`);

  // 5. Tenta variações
  const variações = [
    'combinacoes?status=eq.pendente&select=id&limit=3',
    'combinacoes?status=eq.Pendente&select=id&limit=3',
    'combinacoes?status=eq.PENDENTE&select=id&limit=3',
    'combinacoes?loteria=eq.lotofácil&status=eq.pendente&select=id&limit=3',
    'combinacoes?loteria=eq.Lotofácil&status=eq.pendente&select=id&limit=3',
  ];

  console.log('\n🔎 Testando variações de query:');
  for (const v of variações) {
    const r = await query(v);
    console.log(`  ${v.split('combinacoes?')[1].padEnd(55)} → ${r.length} registros`);
  }

  console.log('\n═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('ERRO:', err);
  process.exit(1);
});
