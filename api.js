// Central de Pesquisas — backend (Netlify Functions + Netlify Blobs)
// Um único arquivo cuida de toda a API: login de admin/coordenador, CRUD de
// grupos e pesquisas, recebimento de respostas (com arquivos) e download de
// arquivos. Propositalmente "feio e direto" — fácil de editar num arquivo só
// pelo site do GitHub.

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MAX_FILE_BYTES = 4.5 * 1024 * 1024; // ~4.5MB por arquivo (após base64)

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

// ---------- helpers de criptografia simples ----------

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signToken(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  if (!timingSafeEq(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// ---------- stores ----------
// Em condições normais, getStore(name) recebe siteID/token automaticamente
// dentro de uma Netlify Function. Em alguns sites isso falha (bug conhecido
// do lado do Netlify: MissingBlobsEnvironmentError mesmo dentro do handler).
// Se as variáveis de ambiente SITE_ID e NETLIFY_BLOBS_TOKEN existirem, usamos
// configuração explícita para contornar isso; senão caímos no modo automático.
function makeStore(name) {
  if (process.env.NETLIFY_BLOBS_TOKEN && process.env.SITE_ID) {
    return getStore({ name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  }
  return getStore(name);
}

const configStore = () => makeStore('config');
const groupsStore = () => makeStore('groups');
const surveysStore = () => makeStore('surveys');
const responsesStore = () => makeStore('responses');
const filesStore = () => makeStore('files');

async function ensureConfig() {
  const store = configStore();
  let cfg = await store.get('app', { type: 'json' });
  if (!cfg) {
    cfg = {
      secret: randomToken(24),
      adminSalt: randomToken(8),
      adminPasswordHash: null,
      adminSecretToken: null,
      createdAt: Date.now(),
    };
    await store.setJSON('app', cfg);
  }
  return cfg;
}

// ---------- admin ----------

async function handleAdminLogin(body) {
  const { password, secretToken } = body || {};
  if (!password || !secretToken) return json(400, { error: 'missing_fields' });
  const store = configStore();
  let cfg = await ensureConfig();

  if (!cfg.adminPasswordHash) {
    // Primeiro acesso: quem chegar aqui primeiro define a senha e "trava" o link secreto.
    cfg = {
      ...cfg,
      adminPasswordHash: hashPassword(password, cfg.adminSalt),
      adminSecretToken: secretToken,
    };
    await store.setJSON('app', cfg);
  } else {
    if (!timingSafeEq(cfg.adminSecretToken, secretToken)) return json(401, { error: 'invalid_token' });
    const hash = hashPassword(password, cfg.adminSalt);
    if (!timingSafeEq(hash, cfg.adminPasswordHash)) return json(401, { error: 'invalid_credentials' });
  }

  const token = signToken({ role: 'admin', exp: Date.now() + 12 * 3600 * 1000 }, cfg.secret);
  return json(200, { token });
}

async function handleAdminChangePassword(body) {
  const cfg = await ensureConfig();
  const { oldPassword, newPassword } = body || {};
  if (!oldPassword || !newPassword) return json(400, { error: 'missing_fields' });
  const oldHash = hashPassword(oldPassword, cfg.adminSalt);
  if (!timingSafeEq(oldHash, cfg.adminPasswordHash)) return json(401, { error: 'invalid_credentials' });
  cfg.adminPasswordHash = hashPassword(newPassword, cfg.adminSalt);
  await configStore().setJSON('app', cfg);
  return json(200, { ok: true });
}

// ---------- grupos ----------

async function listGroups() {
  const store = groupsStore();
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    const g = await store.get(b.key, { type: 'json' });
    if (g) out.push({ id: g.id, name: g.name, coordUsername: g.coordUsername, createdAt: g.createdAt });
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

async function createGroup(body) {
  const { name, coordUsername, coordPassword } = body || {};
  if (!name || !coordUsername || !coordPassword) return json(400, { error: 'missing_fields' });
  const id = randomToken(5);
  const coordSalt = randomToken(8);
  const g = {
    id,
    name,
    coordUsername,
    coordSalt,
    coordPasswordHash: hashPassword(coordPassword, coordSalt),
    createdAt: Date.now(),
  };
  await groupsStore().setJSON(id, g);
  return json(200, { id, name, coordUsername });
}

async function updateGroup(id, body) {
  const store = groupsStore();
  const g = await store.get(id, { type: 'json' });
  if (!g) return json(404, { error: 'not_found' });
  if (body.name) g.name = body.name;
  if (body.coordUsername) g.coordUsername = body.coordUsername;
  if (body.coordPassword) {
    g.coordSalt = randomToken(8);
    g.coordPasswordHash = hashPassword(body.coordPassword, g.coordSalt);
  }
  await store.setJSON(id, g);
  return json(200, { ok: true });
}

async function deleteGroup(id) {
  const { blobs } = await surveysStore().list();
  for (const b of blobs) {
    const s = await surveysStore().get(b.key, { type: 'json' });
    if (s && s.groupId === id) return json(409, { error: 'group_has_surveys' });
  }
  await groupsStore().delete(id);
  return json(200, { ok: true });
}

async function handleCoordLogin(body) {
  const { username, password } = body || {};
  if (!username || !password) return json(400, { error: 'missing_fields' });
  const store = groupsStore();
  const { blobs } = await store.list();
  const groupIds = [];
  for (const b of blobs) {
    const g = await store.get(b.key, { type: 'json' });
    if (g && g.coordUsername === username) {
      const hash = hashPassword(password, g.coordSalt);
      if (timingSafeEq(hash, g.coordPasswordHash)) groupIds.push(g.id);
    }
  }
  if (!groupIds.length) return json(401, { error: 'invalid_credentials' });
  const cfg = await ensureConfig();
  const token = signToken({ role: 'coord', groupIds, username, exp: Date.now() + 12 * 3600 * 1000 }, cfg.secret);
  return json(200, { token, groupIds });
}

// ---------- pesquisas ----------

function defaultTheme() {
  return {
    bgColor: '#f2f4f8',
    cardColor: '#ffffff',
    textColor: '#1f2430',
    accentColor: '#4f46e5',
    buttonTextColor: '#ffffff',
    backgroundImage: null,
    logoImage: null,
  };
}

async function listSurveysAll() {
  const store = surveysStore();
  const { blobs } = await store.list();
  const respStore = responsesStore();
  const out = [];
  for (const b of blobs) {
    const s = await store.get(b.key, { type: 'json' });
    if (!s) continue;
    const { blobs: rb } = await respStore.list({ prefix: `${s.id}::` });
    out.push({
      id: s.id,
      groupId: s.groupId,
      title: s.title,
      status: s.status,
      updatedAt: s.updatedAt,
      responseCount: rb.length,
    });
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

async function createSurvey(body) {
  const { groupId, title } = body || {};
  if (!groupId || !title) return json(400, { error: 'missing_fields' });
  const g = await groupsStore().get(groupId, { type: 'json' });
  if (!g) return json(400, { error: 'invalid_group' });
  const id = randomToken(5);
  const survey = {
    id,
    groupId,
    title,
    description: '',
    invitationMessage: '',
    status: 'draft',
    theme: defaultTheme(),
    questions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await surveysStore().setJSON(id, survey);
  return json(200, survey);
}

async function getSurveyFull(id) {
  const s = await surveysStore().get(id, { type: 'json' });
  if (!s) return json(404, { error: 'not_found' });
  return json(200, s);
}

async function updateSurvey(id, body) {
  const store = surveysStore();
  const existing = await store.get(id, { type: 'json' });
  if (!existing) return json(404, { error: 'not_found' });
  const updated = {
    ...existing,
    title: body.title ?? existing.title,
    description: body.description ?? existing.description,
    invitationMessage: body.invitationMessage ?? existing.invitationMessage,
    theme: body.theme ?? existing.theme,
    questions: body.questions ?? existing.questions,
    status: body.status ?? existing.status,
    groupId: body.groupId ?? existing.groupId,
    updatedAt: Date.now(),
  };
  await store.setJSON(id, updated);
  return json(200, updated);
}

async function deleteSurvey(id) {
  const survey = await surveysStore().get(id, { type: 'json' });
  if (!survey) return json(404, { error: 'not_found' });
  const { blobs } = await responsesStore().list({ prefix: `${id}::` });
  for (const b of blobs) {
    const r = await responsesStore().get(b.key, { type: 'json' });
    if (r && r.files) {
      for (const qid of Object.keys(r.files)) {
        for (const f of r.files[qid]) await filesStore().delete(f.fileId).catch(() => {});
      }
    }
    await responsesStore().delete(b.key);
  }
  if (survey.theme) {
    if (survey.theme.backgroundImage) await filesStore().delete(survey.theme.backgroundImage).catch(() => {});
    if (survey.theme.logoImage) await filesStore().delete(survey.theme.logoImage).catch(() => {});
  }
  await surveysStore().delete(id);
  return json(200, { ok: true });
}

async function getSurveyPublic(id) {
  const survey = await surveysStore().get(id, { type: 'json' });
  if (!survey) return json(404, { error: 'not_found' });
  if (survey.status !== 'published') return json(200, { closed: true, title: survey.title });
  const { title, description, theme, questions } = survey;
  return json(200, { id: survey.id, title, description, theme, questions });
}

async function submitResponse(surveyId, body) {
  const survey = await surveysStore().get(surveyId, { type: 'json' });
  if (!survey || survey.status !== 'published') return json(404, { error: 'not_found_or_closed' });
  const { answers, files } = body || {};
  const responseId = randomToken(8);
  const storedFiles = {};
  if (Array.isArray(files)) {
    for (const f of files) {
      if (!f || !f.dataBase64) continue;
      const buf = Buffer.from(f.dataBase64, 'base64');
      if (buf.length > MAX_FILE_BYTES) return json(413, { error: 'file_too_large', field: f.questionId });
      const fileId = randomToken(10);
      await filesStore().set(fileId, toArrayBuffer(buf), {
        metadata: { name: f.name || 'arquivo', mime: f.mime || 'application/octet-stream', size: buf.length, kind: 'attachment', surveyId, groupId: survey.groupId },
      });
      (storedFiles[f.questionId] = storedFiles[f.questionId] || []).push({ fileId, name: f.name, mime: f.mime, size: buf.length });
    }
  }
  const resp = { id: responseId, surveyId, groupId: survey.groupId, answers: answers || {}, files: storedFiles, submittedAt: Date.now() };
  await responsesStore().setJSON(`${surveyId}::${responseId}`, resp);
  return json(200, { ok: true, id: responseId });
}

async function listResponses(surveyId) {
  const store = responsesStore();
  const { blobs } = await store.list({ prefix: `${surveyId}::` });
  // Busca em paralelo (em lotes) em vez de um por vez — com milhares de
  // respostas, buscar sequencialmente estouraria o tempo da função.
  const out = [];
  const CHUNK = 200;
  for (let i = 0; i < blobs.length; i += CHUNK) {
    const chunk = blobs.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((b) => store.get(b.key, { type: 'json' }).catch(() => null)));
    for (const r of results) if (r) out.push(r);
  }
  out.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
  return out;
}

async function deleteResponse(surveyId, responseId) {
  const key = `${surveyId}::${responseId}`;
  const r = await responsesStore().get(key, { type: 'json' });
  if (!r) return json(404, { error: 'not_found' });
  if (r.files) {
    for (const qid of Object.keys(r.files)) {
      for (const f of r.files[qid]) await filesStore().delete(f.fileId).catch(() => {});
    }
  }
  await responsesStore().delete(key);
  return json(200, { ok: true });
}

async function uploadThemeImage(body) {
  const { name, mime, dataBase64 } = body || {};
  if (!dataBase64) return json(400, { error: 'missing_data' });
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length > MAX_FILE_BYTES) return json(413, { error: 'file_too_large' });
  const fileId = randomToken(10);
  await filesStore().set(fileId, toArrayBuffer(buf), { metadata: { name: name || 'imagem', mime: mime || 'image/jpeg', size: buf.length, kind: 'theme' } });
  return json(200, { fileId });
}

async function serveFile(fileId, auth) {
  const store = filesStore();
  const result = await store.getWithMetadata(fileId, { type: 'arrayBuffer' });
  if (!result) return json(404, { error: 'not_found' });
  const { data, metadata } = result;
  const m = metadata || {};
  if (m.kind === 'attachment') {
    const okAdmin = auth && auth.role === 'admin';
    const okCoord = auth && auth.role === 'coord' && Array.isArray(auth.groupIds) && auth.groupIds.includes(m.groupId);
    if (!okAdmin && !okCoord) return json(auth ? 403 : 401, { error: auth ? 'forbidden' : 'unauthorized' });
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': m.mime || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(m.name || fileId)}"`,
      'Cache-Control': m.kind === 'theme' ? 'public, max-age=31536000, immutable' : 'no-store',
      ...CORS_HEADERS,
    },
    body: Buffer.from(data).toString('base64'),
    isBase64Encoded: true,
  };
}

// ---------- roteamento ----------

async function routeAdmin(parts, method, body) {
  if (parts[0] === 'change-password' && method === 'POST') return handleAdminChangePassword(body);

  if (parts[0] === 'groups') {
    if (method === 'GET' && !parts[1]) return json(200, await listGroups());
    if (method === 'POST' && !parts[1]) return createGroup(body);
    if (method === 'PUT' && parts[1]) return updateGroup(parts[1], body);
    if (method === 'DELETE' && parts[1]) return deleteGroup(parts[1]);
  }

  if (parts[0] === 'surveys') {
    if (method === 'GET' && !parts[1]) return json(200, await listSurveysAll());
    if (method === 'POST' && !parts[1]) return createSurvey(body);
    if (parts[1] && parts[2] === 'responses') {
      if (method === 'GET') return json(200, await listResponses(parts[1]));
      if (method === 'DELETE' && parts[3]) return deleteResponse(parts[1], parts[3]);
    }
    if (parts[1] && method === 'GET') return getSurveyFull(parts[1]);
    if (parts[1] && method === 'PUT') return updateSurvey(parts[1], body);
    if (parts[1] && method === 'DELETE') return deleteSurvey(parts[1]);
  }

  if (parts[0] === 'upload-theme-image' && method === 'POST') return uploadThemeImage(body);

  return json(404, { error: 'not_found' });
}

async function routeCoord(parts, method, body, auth) {
  if (parts[0] === 'surveys' && method === 'GET' && !parts[1]) {
    const all = await listSurveysAll();
    return json(200, all.filter((s) => auth.groupIds.includes(s.groupId)));
  }
  if (parts[0] === 'surveys' && parts[1] && parts[2] === 'responses' && method === 'GET') {
    const survey = await surveysStore().get(parts[1], { type: 'json' });
    if (!survey) return json(404, { error: 'not_found' });
    if (!auth.groupIds.includes(survey.groupId)) return json(403, { error: 'forbidden' });
    return json(200, await listResponses(parts[1]));
  }
  if (parts[0] === 'surveys' && parts[1] && !parts[2] && method === 'GET') {
    const survey = await surveysStore().get(parts[1], { type: 'json' });
    if (!survey) return json(404, { error: 'not_found' });
    if (!auth.groupIds.includes(survey.groupId)) return json(403, { error: 'forbidden' });
    return json(200, survey);
  }
  return json(404, { error: 'not_found' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

  let path = event.path || '';
  path = path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '');
  const parts = path.split('/').filter(Boolean);
  const method = event.httpMethod;

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
    } catch (e) {
      body = {};
    }
  }

  try {
    const cfg = await ensureConfig();
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const auth = token ? verifyToken(token, cfg.secret) : null;

    if (method === 'GET' && parts[0] === 'survey' && parts[1]) return getSurveyPublic(parts[1]);
    if (method === 'POST' && parts[0] === 'survey' && parts[1] && parts[2] === 'responses') return submitResponse(parts[1], body);
    if (method === 'GET' && parts[0] === 'files' && parts[1]) return serveFile(parts[1], auth);

    if (method === 'POST' && parts[0] === 'admin' && parts[1] === 'login') return handleAdminLogin(body);
    if (method === 'POST' && parts[0] === 'coord' && parts[1] === 'login') return handleCoordLogin(body);

    if (parts[0] === 'admin') {
      if (!auth || auth.role !== 'admin') return json(401, { error: 'unauthorized' });
      return routeAdmin(parts.slice(1), method, body);
    }
    if (parts[0] === 'coord') {
      if (!auth || auth.role !== 'coord') return json(401, { error: 'unauthorized' });
      return routeCoord(parts.slice(1), method, body, auth);
    }

    return json(404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'internal_error', message: String((err && err.message) || err) });
  }
};
