/* Vercel Serverless: cria o Pix na SyncPay (POST /api/pix-criar) */
'use strict';
const https = require('https');
const SYNC_API = 'api.syncpayments.com.br';

function chamarAPI(metodo, rota, corpo, token) {
  return new Promise(function(resolve, reject) {
    var data = corpo ? JSON.stringify(corpo) : null;
    var headers = { 'Accept': 'application/json', 'Host': SYNC_API };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = https.request({ host: SYNC_API, path: '/api/partner/v1' + rota, method: metodo, headers: headers }, function(res) {
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

var tokenCache = { token: null, expira: 0 };
async function pegarToken() {
  if (tokenCache.token && Date.now() < tokenCache.expira) return tokenCache.token;
  var clientId = process.env.SYNC_CLIENT_ID;
  var clientSecret = process.env.SYNC_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Variáveis de ambiente SYNC_CLIENT_ID / SYNC_CLIENT_SECRET não configuradas na Vercel');
  var d = await chamarAPI('POST', '/auth-token', { client_id: clientId, client_secret: clientSecret });
  tokenCache = { token: d.access_token, expira: Date.now() + ((d.expires_in || 3600) - 300) * 1000 };
  return d.access_token;
}

module.exports = async function(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(JSON.stringify({ error: 'Use POST' })); }

  var body = '';
  req.on('data', function(c){ body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', async function() {
    try {
      var p = JSON.parse(body || '{}');
      var token = await pegarToken();
      var d = await chamarAPI('POST', '/cash-in', {
        amount: Number(p.amount),
        description: String(p.description || 'Pedido ZYON'),
        client: p.client
      }, token);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ pix_code: d.pix_code, identifier: d.identifier }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
};
