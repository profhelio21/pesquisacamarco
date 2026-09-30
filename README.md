# Votação — Dr. Ricardo Camarço (versão simplificada)

Página única e direta: a pessoa digita o nome, marca em quais candidatos vai votar e envia. Sem painel de admin complicado — só o formulário e uma tela simples de resultados.

## Como colocar no ar

1. Suba estes arquivos pela interface do GitHub (Add file → Upload files), mantendo a pasta `netlify/functions/` como está.
2. Conecte o repositório no Netlify (New site from Git) — não precisa mexer em nada, o `netlify.toml` já configura tudo.
3. Espere o deploy terminar e copie o link do site (ex: `https://seusite.netlify.app`) — é esse link que você manda no WhatsApp.

## Como funciona

- A pessoa preenche o nome e escolhe, para cada cargo, "vou votar nele" ou "não vou votar nele".
- **Verificação de voto duplicado**: o sistema guarda o nome de quem já respondeu e recusa um segundo envio com o mesmo nome (ignorando maiúsculas/espaços extras). Além disso, o próprio celular/computador da pessoa lembra que ela já respondeu e nem mostra o formulário de novo.
  - Importante: como não pede documento nem telefone, alguém "malicioso" ainda poderia burlar usando um nome levemente diferente ou outro aparelho — é a limitação de manter simples. Se um dia precisar de algo à prova de fraude, dá pra evoluir pedindo o número de telefone também.
- **Ver os resultados**: no rodapé do formulário tem um link discreto "admin" (`#resultados`). Na primeira vez que você entrar lá, a senha que você digitar vira a senha definitiva — guarde ela. Lá aparece quantas pessoas responderam e quantos "sim"/"não" cada candidato recebeu, com porcentagem.

## Trocar candidatos/cargos

A lista de cargos e candidatos está em dois lugares (precisam ficar iguais):
- `index.html` — dentro do `<script>`, na constante `RACES`.
- `netlify/functions/votar.js` — no topo do arquivo, também `RACES`.

## Se der erro "MissingBlobsEnvironmentError"

Mesma correção do Central de Pesquisas: gere um Personal Access Token em `https://app.netlify.com/user/applications#personal-access-tokens`, adicione como variável de ambiente `NETLIFY_BLOBS_TOKEN` em Site configuration → Environment variables, e rode um novo deploy.
