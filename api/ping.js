/* Vercel Serverless: verificação (GET /api/ping) */
module.exports = function(req, res) {
  var configurada = !!(process.env.SYNC_CLIENT_ID && process.env.SYNC_CLIENT_SECRET);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, syncConfigurada: configurada, modo: 'vercel' }));
};
