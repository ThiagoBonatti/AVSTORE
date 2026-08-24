require('dotenv').config();
const admin = require('firebase-admin');

// Resolve as credenciais do Firebase Admin SDK a partir de uma das
// estrategias abaixo (nessa ordem de prioridade). Veja o README para
// instrucoes de como gerar cada uma no console do Firebase.
function loadCredential() {
  // 1) Arquivo de chave de servico apontado por GOOGLE_APPLICATION_CREDENTIALS
  //    (forma recomendada para desenvolvimento local)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.credential.applicationDefault();
  }

  // 2) JSON completo da chave de servico em uma unica variavel de ambiente
  //    (util em plataformas de hospedagem sem upload de arquivo, ex: Render/Railway)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return admin.credential.cert(serviceAccount);
  }

  // 3) Variaveis separadas
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Em arquivos .env a quebra de linha da chave privada costuma vir escapada como \n
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }

  throw new Error(
    'Credenciais do Firebase nao encontradas. Configure GOOGLE_APPLICATION_CREDENTIALS, ' +
      'FIREBASE_SERVICE_ACCOUNT_JSON ou as variaveis FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
      'FIREBASE_PRIVATE_KEY no arquivo .env. Veja o README para o passo a passo.'
  );
}

if (!admin.apps.length) {
  const options = { credential: loadCredential() };

  if (process.env.FIREBASE_STORAGE_BUCKET) {
    options.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
  }

  // Permite apontar para os emuladores locais durante o desenvolvimento
  // (as variaveis abaixo sao lidas automaticamente pelo SDK quando definidas
  // via firebase emulators:start / firebase.json "env").
  admin.initializeApp(options);
}

const db = admin.firestore();
const bucket = admin.storage().bucket();
const auth = admin.auth();

module.exports = { admin, db, bucket, auth };
