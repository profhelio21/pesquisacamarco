// Votação simplificada — Dr. Ricardo Camarço
// Um único arquivo cuida de: registrar o voto (com verificação de nome
// duplicado) e mostrar o resumo de votos pra quem tiver a senha.

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Lista de cargos e candidatos indicados. Pra trocar algum nome/partido no
// futuro, edite só aqui (e o mesmo bloco dentro de index.html).
const RACES = [
  { id: 'presidente', label: 'Presidente', candidato: 'Lula', partido: 'PT' },
  { id: 'governador', label: 'Governador', candidato: 'Rafael Fonteles', partido: 'PT' },
  { id: 'senador1', label: 'Senador (1ª vaga)', candidato: 'Ciro Nogueira', partido: 'PP' },
  { id: 'senador2', label: 'Senador (2ª vaga)', candidato: 'Marcelo Castro', partido: 'MDB' },
  { id: 'dep_estadual', label: 'Deputado Estadual', candidato: 'Firmino Paulo', partido: 'PT' },
  { id: 'dep_federal', label: 'Deputado Federal', candidato: 'Julio Arcoverde', partido: 'PP' },
];
const RACE_IDS = RACES.map((r) => r.id);

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

// Mesmo contorno usado no Central de Pesquisas pro bug conhecido do Netlify
// (MissingBlobsEnvironmentError): se houver um token manual configurado, usa
// ele; senão cai no modo automático padrão.
function makeStore(name) {
  if (process.env.NETLIFY_BLOBS_TOKEN && process.env.SITE_ID) {
    return getStore({ name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  }
  return getStore(name);
}
const votosStore = () => makeStore('votos');
const configStore = () => makeStore('config');

function normalizeName(nome) {
  return String(nome || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
}
function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function ensureConfig() {
  const store = configStore();
  let cfg = await store.get('app', { type: 'json' });
  if (!cfg) {
    cfg = { salt: crypto.randomBytes(8).toString('hex'), passwordHash: null };
    await store.setJSON('app', cfg);
  }
  return cfg;
}

async function handleVotar(body) {
  const nome = String((body && body.nome) || '').trim();
  const respostas = (body && body.respostas) || {};
  if (!nome) return json(400, { error: 'nome_obrigatorio' });
  for (const id of RACE_IDS) {
    const v = respostas[id];
    if (v !== 'sim' && v !== 'nao') return json(400, { error: 'resposta_invalida', cargo: id });
  }
  const key = normalizeName(nome);
  if (!key) return json(400, { error: 'nome_obrigatorio' });

  const store = votosStore();
  const existing = await store.get(key, { type: 'json' });
  if (existing) return json(409, { error: 'ja_votou' });

  await store.setJSON(key, { nome, respostas, submittedAt: Date.now() });
  return json(200, { ok: true });
}

async function handleResultados(body) {
  const { senha } = body || {};
  if (!senha) return json(400, { error: 'senha_obrigatoria' });

  const cfg = await ensureConfig();
  if (!cfg.passwordHash) {
    // Primeiro acesso define a senha (mesmo esquema do Central de Pesquisas).
    cfg.passwordHash = hashPassword(senha, cfg.salt);
    await configStore().setJSON('app', cfg);
  } else {
    const hash = hashPassword(senha, cfg.salt);
    if (!timingSafeEq(hash, cfg.passwordHash)) return json(401, { error: 'senha_incorreta' });
  }

  const store = votosStore();
  const { blobs } = await store.list();
  const CHUNK = 200;
  const all = [];
  for (let i = 0; i < blobs.length; i += CHUNK) {
    const chunk = blobs.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((b) => store.get(b.key, { type: 'json' }).catch(() => null)));
    for (const r of results) if (r) all.push(r);
  }

  const tally = RACES.map((r) => {
    let sim = 0;
    let nao = 0;
    for (const v of all) {
      const resp = v.respostas || {};
      if (resp[r.id] === 'sim') sim++;
      else if (resp[r.id] === 'nao') nao++;
    }
    return { ...r, sim, nao };
  });

  return json(200, { total: all.length, tally });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

  let path = event.path || '';
  path = path.replace(/^\/\.netlify\/functions\/votar/, '').replace(/^\/api\/votar/, '');

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
    } catch (e) {
      body = {};
    }
  }

  try {
    if (event.httpMethod === 'POST' && (path === '' || path === '/')) return handleVotar(body);
    if (event.httpMethod === 'POST' && path === '/resultados') return handleResultados(body);
    return json(404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'internal_error', message: String((err && err.message) || err) });
  }
};
