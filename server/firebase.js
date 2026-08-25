// override: true faz os valores do .env sempre vencerem, mesmo que ja
// exista uma variavel de ambiente com o mesmo nome definida no sistema
// operacional (ex: uma variavel de usuario/sistema no Windows, ou algo
// definido antes via "set" no terminal). Sem isso, dotenv so preenche
// variaveis que ainda nao existem em process.env.
require('dotenv').config({ override: true });

// A partir da v13/14, o firebase-admin usa API modular (mesma filosofia do
// SDK v9+ do Firebase para navegador): em vez de um objeto "admin" unico com
// tudo pendurado nele, cada area (app, firestore, storage, auth) e importada
// do seu proprio subcaminho.
const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { getAuth } = require('firebase-admin/auth');

// Normaliza a chave privada vinda de uma variavel de ambiente. Dependendo de
// como o valor foi colado/gerado (Windows, editores diferentes, paineis como
// o do Render que "explodem" um JSON colado em variaveis separadas), a quebra
// de linha pode chegar de formas diferentes:
//   - escapada como texto literal "\n" (dois caracteres: barra invertida + n)
//   - escapada como "\r\n"
//   - já como quebra de linha real, mas em CRLF (\r\n) em vez de LF (\n)
// O decodificador de chave do Node (OpenSSL) exige LF puro, então normalizamos
// tudo para "\n" antes de usar. Também removemos aspas extras que às vezes
// sobram de um copiar/colar malfeito e espaços/linhas em branco nas pontas.
function normalizePrivateKey(raw) {
  let key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }
  key = key
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return key.trim() + '\n';
}

// Resolve as credenciais do Firebase Admin SDK a partir de uma das
// estrategias abaixo (nessa ordem de prioridade). Veja o README para
// instrucoes de como gerar cada uma no console do Firebase.
function loadCredential() {
  // 1) Arquivo de chave de servico apontado por GOOGLE_APPLICATION_CREDENTIALS
  //    (forma recomendada para desenvolvimento local)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return applicationDefault();
  }

  // 2) JSON completo da chave de servico em uma unica variavel de ambiente
  //    (util em plataformas de hospedagem sem upload de arquivo, ex: Render/Railway)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return cert(serviceAccount);
  }

  // 3) Variaveis separadas
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    });
  }

  throw new Error(
    'Credenciais do Firebase nao encontradas. Configure GOOGLE_APPLICATION_CREDENTIALS, ' +
      'FIREBASE_SERVICE_ACCOUNT_JSON ou as variaveis FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
      'FIREBASE_PRIVATE_KEY no arquivo .env. Veja o README para o passo a passo.'
  );
}

if (!getApps().length) {
  const options = { credential: loadCredential() };

  if (process.env.FIREBASE_STORAGE_BUCKET) {
    options.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
  }

  // Permite apontar para os emuladores locais durante o desenvolvimento
  // (as variaveis abaixo sao lidas automaticamente pelo SDK quando definidas
  // via firebase emulators:start / firebase.json "env").
  initializeApp(options);
}

const db = getFirestore();
const bucket = getStorage().bucket();
const auth = getAuth();

module.exports = { db, bucket, auth, FieldValue };
