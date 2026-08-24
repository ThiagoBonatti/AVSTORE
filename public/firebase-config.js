// Configuracao do app Web do Firebase — estes valores NAO sao segredos
// (sao publicos por natureza em qualquer app Firebase para navegador), mas
// sao especificos do SEU projeto. Pegue-os em:
// Console do Firebase > Configuracoes do projeto > Geral > Seus apps > app Web
//
// Se ainda nao existir um "app Web" no seu projeto, clique no icone </>
// em "Seus apps" para criar um e copiar esses valores.
export const firebaseConfig = {
  apiKey: 'AIzaSyAZhfWe0zis2ropLyMfkfCHrKY1X2YBFZ8',
  authDomain: 'avstore-4f2fc.firebaseapp.com',
  projectId: 'avstore-4f2fc',
  storageBucket: 'avstore-4f2fc.firebasestorage.app',
  messagingSenderId: '584126451363',
  appId: '1:584126451363:web:ad26c0d7129a63588df916',
};

// Defina como true para conectar o painel admin aos emuladores locais do
// Firebase (npx firebase emulators:start) durante o desenvolvimento, em vez
// do projeto real na nuvem.
export const USE_FIREBASE_EMULATOR = false;
