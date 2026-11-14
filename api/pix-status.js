/* Vercel Serverless: consulta o status do Pix na SyncPay (GET /api/pix-status?id=...) */
'use strict';
const https = require('https');
const SYNC_API = 'api.syncpayments.com.br';

function chamarAPI(metodo, rota, token) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      host: SYNC_API, path: '/api/partner/v1' + rota, method: metodo,
      headers: { 'Accept': 'application/json', 'Host': SYNC_API, 'Authorization': 'Bearer ' + token }
    }, function(res) {
      var buf = '';
      res.on('data', function(c){ buf += c; });
      res.on('end', function() {
        var json = null;
        try { json = JSON.parse(buf); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json || {});
        else reject(new Error('SyncPay HTTP ' + res.statusCode));
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, function(){ req.destroy(new Error('Timeout na SyncPay')); });
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
  if (req.method !== 'GET') { res.writeHead(405); return res.end(JSON.stringify({ error: 'Use GET' })); }

  try {
    var url = req.url.split('?');
    var qs = new URLSearchParams(url[1] || '');
    var id = (qs.get('id') || '').replace(/[^a-zA-Z0-9-]/g, '');
    if (!id) { res.writeHead(400); return res.end(JSON.stringify({ error: 'id obrigatório' })); }
    var token = await pegarToken();
    var d = await chamarAPI('GET', '/transaction/' + id, token);
    var st = String((d.data && d.data.status) || d.status || '').toLowerCase();
    var pago = st === 'completed';   /* conforme docs: pending | completed | failed | refunded | med */
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: st, pago: pago }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message }));
  }
};
