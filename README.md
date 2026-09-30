# Central de Pesquisas

Um "Google Forms" seu, hospedado no Netlify (mesmo esquema que você já usa: Netlify Functions + Netlify Blobs). Você cria a pesquisa, edita perguntas/opções/cores/fundo/logo a qualquer momento, manda o link no WhatsApp, e só você (admin) vê tudo.

## Como colocar no ar (do jeito que você já faz)

1. Crie um repositório novo no GitHub (ou use um existente) e suba estes arquivos pela própria interface do GitHub (Add file → Upload files), mantendo a pasta `netlify/functions/` exatamente como está.
2. No Netlify, conecte esse repositório (New site from Git). Não precisa mexer em nada nas configurações de build — o `netlify.toml` já diz tudo.
3. Espere o deploy terminar e abra o site.

## Primeiro acesso (importante!)

O painel de admin não aparece em nenhum menu — ele só existe atrás de um link secreto que **você mesmo inventa** na primeira vez:

1. Escolha uma palavra-chave longa e difícil de adivinhar, por exemplo `pi2026-xk92mdq`.
2. Acesse `https://SEUSITE.netlify.app/#/admin/pi2026-xk92mdq`
3. Vai aparecer uma tela pedindo senha — digite a senha que você quer usar dali pra frente e clique em Entrar.
4. Pronto: esse link completo (com a sua palavra-chave) + essa senha viram sua chave de acesso permanente. Guarde o link nos favoritos. Se alguém mais tentar acessar `#/admin/qualquercoisa` com outra palavra-chave, não vai funcionar — só a primeira palavra-chave usada fica válida.

Dentro do painel, na aba **Configurações**, esse link fica sempre visível caso você esqueça, e dá pra trocar a senha quando quiser.

## Como funciona

- **Uso simples (o caminho mais rápido)**: crie a pesquisa, adicione as perguntas, publique, copie o link e mande no WhatsApp. Não precisa mexer em "Grupos" pra nada disso — na primeira pesquisa o sistema cria um grupo "Geral" sozinho, por baixo dos panos, só pra pesquisa ter um dono.
- **Grupos (opcional, só se um dia precisar)**: se algum dia você quiser que outra pessoa acompanhe só uma pesquisa específica (sem ver as outras), aí sim cria um grupo próprio pra ela em **Grupos**, com usuário/senha de coordenador — ela entra por `#/coord` e só vê o que for daquele grupo. Pra maioria dos casos você pode simplesmente ignorar essa aba.
- **Pesquisas**: crie, edite perguntas (texto curto/longo, múltipla escolha, caixas de seleção, lista suspensa, data, número, arquivo/imagem, localização GPS), reordene, marque obrigatórias, e customize cores, imagem de fundo, logo e o nome/descrição — tudo isso mesmo depois de já ter respostas. O status controla se o formulário está recebendo respostas (Rascunho/Publicada/Encerrada).
- **Opções com foto (ex: lista de candidatos)**: nas perguntas do tipo "Múltipla escolha (uma opção)" ou "Caixas de seleção", cada opção pode ter uma foto e um subtítulo (ex: partido/número), além do nome. Isso faz o formulário mostrar um "cartão" com a foto ao lado do nome — ótimo para enquetes de intenção de voto com foto de cada candidato.
- **Mensagem de convite**: na tela de edição da pesquisa dá pra escrever a mensagem que vai mandar no WhatsApp e clicar em "Copiar mensagem + link" — ele já cola a mensagem seguida do link do formulário, prontinho pra colar na conversa.
- **Resumo de votos/cliques**: na aba "Respostas", se a pesquisa tiver perguntas de múltipla escolha, aparece um botão "Ver resumo de votos" que soma quantas pessoas marcaram cada opção (com %) — útil pra estimar quantos votos/intenções cada candidato teria.
- **Localização**: ao adicionar uma pergunta do tipo "Localização (GPS)", o navegador da pessoa pede permissão de localização na hora de enviar o formulário e a coordenada fica salva junto com a resposta (aparece como link "ver no mapa" pra você).
- **Link do formulário**: botão "Copiar link" gera `#/f/<id>` — é esse link que você manda no WhatsApp. Ninguém precisa de conta ou senha pra responder.
- **Respostas**: só ficam visíveis para você (admin) e, se você optar por usar grupos, para o coordenador daquele grupo. Dá pra baixar anexos e exportar tudo em CSV (abre certinho no Excel/Google Sheets) — com muitas respostas, o CSV é o jeito mais prático de olhar tudo de uma vez.

## Limitações que vale saber

- **Segurança é "de aplicação", não de nível bancário**: as senhas ficam com hash (não em texto puro), mas isso roda num arquivo de função só, sem as camadas extras de um sistema de login profissional. Bom o suficiente para uso interno de escola/negócio; não use para dados extremamente sensíveis.
- **Arquivos**: limite de ~4MB por arquivo enviado. Fotos maiores são comprimidas automaticamente no celular/computador de quem responde antes de enviar; documentos (PDF, Word etc.) não são comprimidos, então peça pra comprimir se passar do limite.
- **Escala**: testado/preparado para uma leva de milhares de cadastros numa mesma pesquisa (a lista de respostas busca em lotes paralelos, não um por um). Se um dia isso crescer para dezenas de milhares de respostas de uma vez, pode valer a pena revisar a tela de respostas para carregar por páginas.
- **Localização**: só funciona se a pessoa permitir o acesso no navegador/celular dela; sem sinal de GPS ou permissão negada, a resposta é enviada mesmo assim (a não ser que você marque a pergunta como obrigatória).

## Se der erro "MissingBlobsEnvironmentError"

Às vezes o Netlify falha em configurar o armazenamento (Netlify Blobs) automaticamente num site novo — é um problema conhecido do próprio Netlify, não do código. Se aparecer esse erro no log da função:

1. Primeiro tente o mais simples: no site, vá em **Deploys** → menu "Trigger deploy" → **Clear cache and deploy site**. Muitas vezes já resolve.
2. Se persistir, configure manualmente:
   - No Netlify, clique no seu avatar (canto superior direito) → **User settings** → **Applications** → **Personal access tokens** → **New access token**. Dê um nome qualquer e copie o token gerado (ele só aparece uma vez).
   - No site, vá em **Site configuration** → **Environment variables** → **Add a variable** → nome `NETLIFY_BLOBS_TOKEN`, valor: o token que você copiou. Salve.
   - Rode um novo deploy (Trigger deploy → Deploy site) para a função pegar a variável nova.
   - O `api.js` já está preparado para usar essa variável automaticamente quando ela existir.

## Estrutura dos arquivos

```
index.html                     → todo o front-end (público, admin e coordenador)
netlify.toml                   → configuração do Netlify (rotas /api/*)
package.json                   → dependência (@netlify/blobs)
netlify/functions/api.js       → toda a lógica do servidor (login, CRUD, respostas, arquivos)
```

Para mexer em qualquer coisa, edite o arquivo correspondente direto pelo GitHub (ícone de lápis) — o Netlify republica sozinho a cada commit.
