/* ============================================================
   ZYON — Servidor Proxy SyncPay
   Resolve o erro "Failed to fetch": a API da SyncPay só aceita
   chamadas de servidor, não do navegador. Este servidor:
   1. Serve o site (abra http://localhost:3000)
   2. Guarda as chaves da SyncPay FORA do navegador (config.json)
   3. Faz as chamadas à API da SyncPay (token, cash-in, status)

   COMO USAR:
   1. Instale o Node.js (nodejs.org)
   2. Nesta pasta, rode:  node servidor.js
   3. Abra o site em:  http://localhost:3000/index.html
   4. Configure as chaves em admin_itens.html (vai para o servidor)
   ============================================================ */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORTA = 3000;
const PASTA_SITE = __dirname;
const ARQ_CONFIG = path.join(__dirname, 'config.json');
const SYNC_API = 'https://api.syncpayments.com.br/api/partner/v1';

/* ---------- Config ---------- */
function lerConfig() {
  try { return JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8')); }
  catch (e) { return {}; }
}
function salvarConfig(cfg) {
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
}

/* ---------- Token SyncPay (cache de 55 min) ---------- */
var tokenCache = { token: null, expira: 0 };
function pegarToken() {
  return new Promise(function(resolve, reject) {
    if (tokenCache.token && Date.now() < tokenCache.expira) return resolve(tokenCache.token);
    var cfg = lerConfig();
    if (!cfg.clientId || !cfg.clientSecret) return reject(new Error('SyncPay não configurada'));
    chamarAPI('POST', '/auth-token', {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret
    }).then(function(d) {
      tokenCache = { token: d.access_token, expira: Date.now() + ((d.expires_in || 3600) - 300) * 1000 };
      resolve(d.access_token);
    }).catch(reject);
  });
}

/* ---------- Chamada HTTPS à SyncPay ---------- */
function chamarAPI(metodo, rota, corpo, token) {
  return new Promise(function(resolve, reject) {
    var data = corpo ? JSON.stringify(corpo) : null;
    var headers = { 'Accept': 'application/json' };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var req = https.request(SYNC_API + rota, { method: metodo, headers: headers }, function(res) {
      var buf = '';
      res.on('data', function(c){ buf += c; });
      res.on('end', function() {
        var json = null;
        try { json = JSON.parse(buf); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json || {});
        else reject(new Error('SyncPay HTTP ' + res.statusCode + (json && json.message ? ': ' + json.message : '')));
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, function(){ req.destroy(new Error('Timeout na SyncPay')); });
    if (data) req.write(data);
    req.end();
  });
}

/* ---------- Servidor ---------- */
var MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function responder(res, codigo, tipo, corpo) {
  res.writeHead(codigo, {
    'Content-Type': tipo + (tipo.startsWith('text/') ? '; charset=utf-8' : ''),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(corpo);
}

function lerCorpo(req) {
  return new Promise(function(resolve) {
    var buf = '';
    req.on('data', function(c){ buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', function() {
      try { resolve(JSON.parse(buf)); } catch (e) { resolve({}); }
    });
  });
}

var server = http.createServer(async function(req, res) {
  var url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') { responder(res, 204, 'text/plain', ''); return; }

  /* ===== APIs do proxy ===== */
  try {
    if (url === '/api/ping') {
      return responder(res, 200, 'application/json', JSON.stringify({ ok: true, syncConfigurada: !!lerConfig().clientId }));

    } else if (url === '/api/config' && req.method === 'POST') {
      var cfg = await lerCorpo(req);
      if (!cfg.clientId || !cfg.clientSecret) return responder(res, 400, 'application/json', JSON.stringify({ error: 'clientId e clientSecret obrigatórios' }));
      var atual = lerConfig();
      atual.clientId = String(cfg.clientId).trim();
      atual.clientSecret = String(cfg.clientSecret).trim();
      salvarConfig(atual);
      tokenCache = { token: null, expira: 0 };
      console.log('✔ Config SyncPay salva');
      return responder(res, 200, 'application/json', JSON.stringify({ ok: true }));

    } else if (url === '/api/pix/criar' && req.method === 'POST') {
      var p = await lerCorpo(req);
      var token = await pegarToken();
      var d = await chamarAPI('POST', '/cash-in', {
        amount: Number(p.amount),
        description: String(p.description || 'Pedido ZYON'),
        client: p.client
      }, token);
      console.log('✔ Pix criado:', d.identifier);
      return responder(res, 200, 'application/json', JSON.stringify({ pix_code: d.pix_code, identifier: d.identifier }));

    } else if (url.startsWith('/api/pix/status/') && req.method === 'GET') {
      var id = url.replace('/api/pix/status/', '').replace(/[^a-zA-Z0-9-]/g, '');
      var token2 = await pegarToken();
      var d2 = await chamarAPI('GET', '/transaction/' + id, null, token2);
      var st = String((d2.status || (d2.data && d2.data.status) || '')).toLowerCase();
      var pago = ['paid', 'approved', 'pago', 'completed', 'confirmed', 'paid_out'].indexOf(st) >= 0;
      return responder(res, 200, 'application/json', JSON.stringify({ status: st, pago: pago }));

    /* ===== Arquivos do site ===== */
    } else if (req.method === 'GET') {
      var caminho = path.normalize(path.join(PASTA_SITE, url === '/' ? 'index.html' : url));
      if (!caminho.startsWith(PASTA_SITE)) return responder(res, 403, 'text/plain', 'Proibido');
      if (!fs.existsSync(caminho) || fs.statSync(caminho).isDirectory()) return responder(res, 404, 'text/plain', 'Página não encontrada');
      var ext = path.extname(caminho).toLowerCase();
      responder(res, 200, MIME[ext] || 'application/octet-stream', fs.readFileSync(caminho));
    } else {
      responder(res, 405, 'text/plain', 'Método não permitido');
    }
  } catch (e) {
    console.error('✖ Erro:', e.message);
    responder(res, 500, 'application/json', JSON.stringify({ error: e.message }));
  }
});

server.listen(PORTA, function() {
  var cfg = lerConfig();
  console.log('==========================================');
  console.log('  ZYON — Servidor rodando!');
  console.log('  Site:   http://localhost:' + PORTA + '/index.html');
  console.log('  Admin:  http://localhost:' + PORTA + '/admin.html');
  console.log('  Itens:  http://localhost:' + PORTA + '/admin_itens.html');
  console.log('  SyncPay: ' + (cfg.clientId ? '✔ configurada' : '✖ NÃO configurada (salve as chaves no admin_itens.html)'));
  console.log('==========================================');
});
