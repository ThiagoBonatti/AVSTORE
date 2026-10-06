// Ajustes de dados executados automaticamente na subida do servidor
// (ex.: apos cada deploy no Cloud Run). Cada ajuste roda UMA unica vez: ao
// terminar, fica registrado no documento meta/migrations e nao roda mais.
// Para rodar de novo um ajuste, apague o campo correspondente desse documento.
const { db, FieldValue } = require('../firebase');
const { titleCaseProducts } = require('./titleCaseProducts');

const MIGRATIONS = [
  { id: 'titleCaseProducts_2026_10', run: () => titleCaseProducts({ apply: true, log: () => {} }) },
];

async function runPendingMigrations() {
  const ref = db.collection('meta').doc('migrations');
  for (const m of MIGRATIONS) {
    try {
      const snap = await ref.get();
      if (snap.exists && snap.get(m.id)) continue;
      console.log(`[migracao] executando ${m.id}...`);
      const result = await m.run();
      await ref.set({ [m.id]: { doneAt: FieldValue.serverTimestamp(), result } }, { merge: true });
      console.log(`[migracao] ${m.id} concluida:`, JSON.stringify(result));
    } catch (err) {
      // Nao derruba o servidor: tenta de novo na proxima subida.
      console.error(`[migracao] falha em ${m.id}:`, err);
    }
  }
}

module.exports = { runPendingMigrations };
