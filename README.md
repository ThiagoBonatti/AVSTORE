# AVSTORE

E-commerce simples com area publica de vendas e painel administrativo para gerenciamento do catalogo de produtos.

## Stack utilizada

- **Backend:** Node.js + Express
- **Banco de dados:** Cloud Firestore (Google Firebase)
- **Armazenamento de imagens:** Firebase Storage
- **Autenticacao:** Firebase Authentication (e-mail/senha), com a permissao de administrador controlada por uma *custom claim* (`admin: true`)
- **Frontend:** HTML, CSS e JavaScript puros (sem framework/build step), servidos como arquivos estaticos pelo proprio Express. O SDK do Firebase e carregado direto via CDN (`https://www.gstatic.com/firebasejs/...`) apenas nas paginas do painel administrativo.

## Por que essa arquitetura

- O **backend Express** usa o **Firebase Admin SDK**, que tem acesso total ao Firestore/Storage/Auth e ignora as regras de seguranca — por isso a API e o unico caminho de escrita no banco (o navegador nunca fala direto com o Firestore).
- O **login do admin** acontece inteiramente no navegador via **Firebase Authentication** (`signInWithEmailAndPassword`). O frontend guarda a sessao do jeito que o SDK do Firebase gerencia (nao usamos cookie de sessao do Express). A cada chamada as rotas protegidas da API (criar/editar/excluir produto), o navegador envia o **ID token** do Firebase no header `Authorization: Bearer <token>`; o backend valida esse token e confere se o usuario tem a claim `admin: true`.
- Como nao ha mais sessao de servidor, a pagina `dashboard.html` e servida normalmente para qualquer um — a protecao de verdade esta nas rotas de escrita da API (que exigem token valido) e pode ser reforcada nas Firestore/Storage Rules caso voce decida acessar o banco direto do navegador no futuro.

## Estrutura de pastas

```
AVSTORE/
├── package.json
├── .env.example              # copie para .env e preencha com suas credenciais
├── render.yaml                 # blueprint de deploy no Render (free tier)
├── firebase.json              # config dos emuladores locais do Firebase
├── firestore.rules            # regras de seguranca do Firestore
├── firestore.indexes.json     # indices compostos usados pelas consultas
├── storage.rules              # regras de seguranca do Storage
├── server/
│   ├── index.js                # servidor Express (rotas + static files)
│   ├── firebase.js              # inicializacao do Firebase Admin SDK
│   ├── storage.js                # upload/remocao de imagens no Storage
│   ├── searchKeywords.js          # geracao dos prefixos usados na busca
│   ├── seed.js                     # cria admin + produtos de exemplo
│   ├── scripts/
│   │   └── rebuildFilters.js        # reconstroi a lista de filtros (categoria/cor)
│   ├── middleware/
│   │   ├── auth.js                   # valida o ID token do Firebase + claim admin
│   │   └── upload.js                  # configuracao do multer (upload em memoria)
│   └── routes/
│       ├── auth.js                     # GET /api/auth/me
│       └── products.js                  # CRUD de produtos (publico + admin)
└── public/
    ├── firebase-config.js       # config do app Web do Firebase (preencha!)
    ├── index.html                # loja (area publica)
    ├── css/style.css
    ├── js/store.js                 # listagem, filtros, scroll infinito, modal
    ├── js/cart.js                    # carrinho (localStorage)
    └── admin/
        ├── login.html                  # login com Firebase Authentication
        ├── dashboard.html
        ├── css/admin.css
        └── js/admin.js                    # cadastro, listagem, edicao, exclusao
```

## Modelo de dados no Firestore

**Colecao `products`** — o **codigo do produto e usado como ID do documento**, o que garante unicidade automaticamente (o backend usa `.create()`, que falha se o codigo ja existir).

| campo           | tipo               | observacao                                  |
|------------------|--------------------|-----------------------------------------------|
| `description`    | string             | descricao                                       |
| `category`       | string             | categoria (usada nos filtros)                    |
| `color`          | string             | cor (usada nos filtros)                           |
| `size`           | string             | tamanho                                            |
| `price`          | number             | preco (>= 0)                                        |
| `imageUrl`       | string             | URL publica de download da imagem no Storage         |
| `imagePath`      | string             | caminho do arquivo no bucket (usado para excluir)      |
| `searchKeywords`  | array\<string\>    | prefixos gerados a partir do codigo + descricao (busca) |
| `createdAt`       | timestamp          | data de criacao                                          |
| `updatedAt`        | timestamp          | data da ultima atualizacao                                |

**Documento `meta/catalog`** — mantem a lista de categorias e cores ja usadas (alimentada via `arrayUnion` a cada produto criado/editado), pois o Firestore nao tem um "SELECT DISTINCT" nativo. Se voce excluir o ultimo produto de uma categoria, ela continua aparecendo no filtro ate voce rodar `npm run rebuild-filters`.

**Firebase Authentication** — cada admin e um usuario normal do Firebase Auth (e-mail/senha) com a *custom claim* `admin: true`, definida pelo script de seed ou manualmente (ver abaixo).

### Sobre a busca por texto

O Firestore nao tem busca "contains" nativa. A busca da loja usa o truque classico de indexar prefixos das palavras (`server/searchKeywords.js`): digitar "cam" encontra produtos cujo **codigo ou alguma palavra da descricao comece** com "cam". Isso cobre bem o caso de uso de uma loja pequena/media, mas nao e uma busca por frase completa nem full-text de verdade. Para busca textual robusta em producao, integre um servico dedicado (Algolia, Typesense, Meilisearch) alimentado a partir do Firestore.

## Passo a passo: configurar o projeto no Firebase

1. Acesse o [console do Firebase](https://console.firebase.google.com/) e abra (ou crie) o seu projeto.
2. **Firestore Database** → crie o banco em modo **Producao** (as regras de `firestore.rules` deste projeto ja bloqueiam acesso direto de clientes).
3. **Storage** → ative o Storage (mesmo processo, modo Producao).
4. **Authentication** → aba "Sign-in method" → ative o provedor **E-mail/senha**.
5. **App Web**: em "Configuracoes do projeto" → "Geral" → "Seus apps", clique no icone `</>` para criar um app Web (se ainda nao existir). Copie o objeto de configuracao gerado para `public/firebase-config.js`.
6. **Chave de servico (backend)**: em "Configuracoes do projeto" → "Contas de servico" → "Gerar nova chave privada". Salve o arquivo baixado como `serviceAccountKey.json` na raiz do projeto (ele ja esta no `.gitignore`).
7. Anote o **nome do bucket do Storage** (aparece na aba Storage, algo como `seu-projeto.appspot.com` ou `seu-projeto.firebasestorage.app`).

## Como rodar (ambiente de desenvolvimento)

Pre-requisito: Node.js 18 ou superior.

1. Instale as dependencias:

   ```bash
   npm install
   ```

2. Copie o arquivo de variaveis de ambiente e preencha com os dados do seu projeto:

   ```bash
   cp .env.example .env
   ```

   No minimo, defina `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json`, `FIREBASE_STORAGE_BUCKET` e `ADMIN_EMAIL` / `ADMIN_PASSWORD` (veja os comentarios no `.env.example` para as opcoes alternativas de credencial).

3. Preencha `public/firebase-config.js` com a config do app Web copiada no passo 5 acima.

4. Rode o seed para criar o usuario administrador (no Firebase Authentication, com a claim `admin: true`) e alguns produtos de exemplo no Firestore/Storage:

   ```bash
   npm run seed
   ```

5. Inicie o servidor:

   ```bash
   npm start
   ```

6. Acesse:

   - Loja: http://localhost:3000/
   - Painel admin: http://localhost:3000/admin/login.html (use o `ADMIN_EMAIL` / `ADMIN_PASSWORD` definidos no `.env`)

`npm run dev` reinicia o servidor automaticamente a cada alteracao. `npm run rebuild-filters` reconstroi a lista de categorias/cores dos filtros varrendo os produtos atuais.

### Testando com os emuladores locais do Firebase (opcional, sem custo)

Este projeto ja inclui `firebase.json`, `firestore.rules`, `storage.rules` e `firestore.indexes.json` prontos para os emuladores:

```bash
npm install -g firebase-tools   # se ainda nao tiver
firebase emulators:start --project demo-avstore
```

Em outro terminal, antes de `npm run seed` / `npm start`, exporte as variaveis que fazem o Admin SDK conversar com os emuladores em vez do projeto real:

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
export GOOGLE_APPLICATION_CREDENTIALS=   # deixe vazio, o emulador nao exige credencial real
```

E defina `USE_FIREBASE_EMULATOR = true` em `public/firebase-config.js` para o painel admin (login) tambem usar o emulador de Authentication. A UI dos emuladores fica em http://127.0.0.1:4000.

### Indices do Firestore

As consultas que combinam filtro (categoria e/ou cor) com ordenacao por data de criacao exigem indices compostos. Eles ja estao descritos em `firestore.indexes.json`; para criar no seu projeto real:

```bash
firebase deploy --only firestore:indexes --project SEU_PROJETO_ID
```

Se voce esquecer esse passo, a primeira vez que uma consulta faltando indice for executada o Firestore retorna um erro com um **link direto** para criar o indice faltante em um clique — normal e esperado, so seguir o link.

### Regras de seguranca

`firestore.rules` e `storage.rules` bloqueiam toda leitura/escrita feita por clientes (`allow read, write: if false`). Isso e intencional: hoje **todo** acesso ao Firestore/Storage passa pelo backend (Admin SDK, que ignora regras). As imagens dos produtos continuam publicamente visiveis porque a URL gerada inclui um *download token* — ele concede leitura aquele arquivo especifico independente das regras, exatamente como as URLs que o proprio SDK do Firebase gera. Para publicar as regras no seu projeto:

```bash
firebase deploy --only firestore:rules,storage:rules --project SEU_PROJETO_ID
```

## Deploy no Render (gratis)

O [Render](https://render.com) foi escolhido por ter um plano free genuino (sem cartao de credito exigido) que roda o Express normalmente, sem precisar reescrever nada como funcao serverless. A unica limitacao do plano free e que o servico "dorme" apos 15 minutos sem trafego e leva ~1 minuto para acordar na proxima visita — aceitavel para uma loja pequena/demo.

O projeto ja vem pronto para isso: `render.yaml` (deploy via Blueprint), `engines` no `package.json`, rota `/healthz` e `trust proxy` configurados.

### 1. Suba o codigo para o GitHub

O Render precisa de um repositorio Git para fazer o deploy. Na pasta do projeto:

```bash
git init
git add .
git commit -m "AVSTORE"
```

Crie um repositorio vazio no [GitHub](https://github.com/new) e siga as instrucoes que ele mostra para conectar e enviar (`git remote add origin ...` + `git push -u origin main`). Como `.env` e `serviceAccountKey.json` estao no `.gitignore`, nenhum segredo vai junto — bom, isso e o esperado.

> **Antes de commitar**, preencha `public/firebase-config.js` com a config real do seu app Web do Firebase (passo 5 da secao "Configurar o projeto no Firebase" acima). Esses valores nao sao secretos — sao normais em qualquer app Firebase para navegador — entao podem ir para o repositorio sem problema.

### 2. Crie o Web Service no Render

**Opcao A — Blueprint (mais rapido):** no dashboard do Render, "New +" → "Blueprint" → selecione o repositorio. O Render le o `render.yaml` e monta o servico sozinho, so pedindo para voce preencher as variaveis marcadas como secretas (passo 3).

**Opcao B — manual:** "New +" → "Web Service" → selecione o repositorio → confirme:
- **Runtime:** Node
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Plan:** Free

### 3. Configure as variaveis de ambiente

Na aba "Environment" do servico, adicione:

| chave | valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | conteudo **inteiro** do `serviceAccountKey.json` colado como uma unica variavel (o backend ja sabe ler essa opcao — veja `server/firebase.js`) |
| `FIREBASE_STORAGE_BUCKET` | o bucket do seu projeto (ex.: `seu-projeto.appspot.com`) |

Nao e preciso configurar `PORT` (o Render define automaticamente) nem `ADMIN_EMAIL`/`ADMIN_PASSWORD` (so sao usados pelo `npm run seed`, que voce roda localmente — veja o passo 4).

### 4. Popule o Firestore (rode o seed local, nao no Render)

O plano free do Render nao da acesso a shell/SSH do servico. Isso nao e um problema: o `npm run seed` fala diretamente com o Firestore/Storage/Auth na nuvem — **nao precisa rodar no mesmo lugar onde o site esta hospedado**. Basta ter o `.env` local (o mesmo `serviceAccountKey.json` do passo 3) e rodar `npm run seed` do seu computador, apontando para o mesmo projeto Firebase usado no Render.

### 5. Deploy

Cada `git push` para a branch conectada dispara um novo deploy automatico. Ao final, o Render te da uma URL publica (`https://avstore-xxxx.onrender.com`) — a loja fica em `/` e o painel admin em `/admin/login.html`.

### Alternativa: deploy assistido por um agente

Existe um conector oficial do Render para o Claude/Cowork que permite criar e gerenciar o Web Service por linguagem natural, sem passar pelo dashboard manualmente. Se preferir esse caminho, conecte o conector "Render" (Configuracoes → Conectores, em claude.ai) e volte aqui pedindo para eu criar o Web Service e configurar as variaveis de ambiente — eu cuido do resto a partir do repositorio no GitHub.

## Funcionalidades

### Area publica (loja)

- Listagem de produtos com **scroll infinito** (paginacao por cursor no Firestore)
- Filtros por **categoria** e **cor**, alem de busca por prefixo (codigo/descricao)
- Modal com imagem, descricao, tamanho, cor, codigo e preco de cada produto
- Carrinho de compras persistido no `localStorage` do navegador
- Layout responsivo (desktop e mobile)

### Painel administrativo

- Login com **Firebase Authentication** (e-mail/senha)
- Todas as rotas de escrita da API (`POST`, `PUT`, `DELETE` em `/api/products`) exigem um ID token valido com a claim `admin: true`
- Cadastro de produto com os campos obrigatorios: codigo, descricao, categoria, cor, tamanho, imagem e preco
- Upload de imagem (JPG, PNG, WEBP ou GIF, ate 5MB) direto para o Firebase Storage
- Edicao de produtos existentes (o codigo nao pode ser alterado, pois e o ID do documento; imagem e opcional na edicao)
- Exclusao de produtos (remove tambem o arquivo de imagem associado no Storage)
- Listagem completa dos produtos cadastrados em tabela

## Como criar/promover outro administrador

Rode o seed com um novo `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `.env`, ou promova um usuario ja existente manualmente com um script Node (usando `firebase-admin`) chamando:

```js
const { auth } = require('./server/firebase');
const user = await auth.getUserByEmail('outra-pessoa@empresa.com');
await auth.setCustomUserClaims(user.uid, { admin: true });
```

O usuario precisa relogar (ou ter o token atualizado) para a claim entrar em vigor.

## Seguranca

- Senha do admin gerenciada inteiramente pelo Firebase Authentication (nunca passa nem e armazenada pelo nosso backend)
- Rotas de escrita da API exigem ID token do Firebase valido **e** a custom claim `admin: true` — um usuario autenticado sem essa claim recebe 403
- Validacao de campos obrigatorios e tipo/tamanho de imagem no backend (nao confia apenas no frontend)
- Codigo de produto com unicidade garantida pelo proprio Firestore (`docRef.create()`), retornando erro 409 em caso de duplicidade
- `firestore.rules` / `storage.rules` bloqueiam qualquer acesso direto de clientes ao banco/armazenamento

Para producao, recomenda-se: rodar atras de HTTPS, restringir a API Key do Firebase Web (Google Cloud Console → Credenciais) ao seu dominio, revisar as Firestore/Storage Rules se algum acesso direto do navegador for adicionado no futuro, e considerar um servico de busca dedicado caso o catalogo cresca muito.

> **Nota sobre `npm audit`:** ao instalar as dependencias, o `npm audit` pode apontar algumas vulnerabilidades "moderate" transitivas dentro da propria cadeia de dependencias do Google Cloud usada pelo `firebase-admin` (`gaxios`/`teeny-request`/`retry-request` → `uuid`). Isso e um problema conhecido, upstream, do SDK oficial do Google (nao deste projeto) sem caminho de exploracao alcancavel pelo uso normal do `firebase-admin`; `npm audit fix --force` sugeriria um downgrade do `firebase-admin`, o que nao e recomendado. Acompanhe atualizacoes do `firebase-admin` periodicamente.

## Observacao sobre as imagens do seed

As imagens de exemplo criadas pelo `npm run seed` sao placeholders SVG gerados automaticamente e enviados ao Firebase Storage (sem depender de imagens externas). Voce pode substituir os produtos de exemplo por outros reais direto pelo painel administrativo.
