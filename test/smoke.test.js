'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Credenciais dummy ANTES de exigir o app: o db.js valida a presenca da secret
// key no load, mas nao abre conexao (createClient e lazy). Como definimos as
// envs antes do require, o dotenv nao as sobrescreve e nenhuma rota testada
// aqui toca a rede (Supabase/Deezer).
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-ref|sb_secret_dummy';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-dummy';
process.env.CORS_ORIGIN = '';

const { createApp } = require('../src/app');

let server;
let baseUrl;

test.before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET / responde 200 com metadados do servico', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'IF-back');
});

test('rotas /api protegidas exigem autenticacao (401 sem token)', async () => {
  const protectedPaths = [
    '/api/auth/me',
    '/api/settings',
    '/api/users',
    '/api/users/birthdays',
    '/api/ministries',
    '/api/music/search',
    '/api/schedules',
    '/api/permissions',
    '/api/roles',
    '/api/invites',
    '/api/audit',
    '/api/dashboard/kpis',
    '/api/reports/catalog',
    '/api/ai/status',
  ];

  for (const path of protectedPaths) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 401, `esperava 401 sem token em ${path}, recebi ${res.status}`);
  }
});

test('erro de autenticacao usa o envelope padronizado { error: { code, message } }', async () => {
  const res = await fetch(`${baseUrl}/api/ministries`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.error, 'esperava a chave "error" no corpo');
  assert.equal(body.error.code, 'UNAUTHENTICATED');
  assert.equal(typeof body.error.message, 'string');
});

test('rota publica POST /api/public/invites/:token/register valida o corpo com zod (400 + details)', async () => {
  const res = await fetch(`${baseUrl}/api/public/invites/token-qualquer/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  // Por ser publica, deve validar o corpo (400) em vez de barrar por falta de token (401).
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(body.error.details), 'esperava lista de problemas em error.details');
  assert.ok(body.error.details.length > 0, 'esperava ao menos um problema de validacao');
});

test('rota inexistente responde 404', async () => {
  const res = await fetch(`${baseUrl}/rota-que-nao-existe`);
  assert.equal(res.status, 404);
});
