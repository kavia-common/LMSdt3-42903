require('dotenv').config();

const app = require('./app');
const { initializeDataSource, getConfiguredDbName, getDbMeta } = require('./config/db');


/**
 * Backend preview contract:
 * - This service is expected to be reachable on port 3001 in preview.
 * - The manifest startCommand provides PORT=<port> which should be 3001.
 * As a safety net, if PORT is accidentally set to 3002 (db preview port), force 3001.
 */
const requestedPort = Number(process.env.PORT || 3001);
const PORT = requestedPort === 3002 ? 3001 : requestedPort;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const dbName = getConfiguredDbName() || '(unknown)';

  // Safe startup log (no secrets).
  const dbHost = process.env.DB_HOST || process.env.MYSQL_HOST || process.env.MYSQLHOST;
  const dbPort = process.env.MYSQL_PREVIEW_PORT || process.env.DB_PORT || process.env.MYSQL_PORT || '3306';
  console.log(
    dbHost ? `MySQL target: ${dbHost}:${dbPort}/${dbName}` : 'MySQL target: (DB_HOST/MYSQL_HOST not set yet)'
  );

  try {
    await initializeDataSource();
    console.log('Database Connected Successfully');
  } catch (err) {
    // Do not hard-fail startup: backend preview should boot even if DB isn't reachable yet.
    const code = err && err.code ? String(err.code) : null;

    if (code === 'MYSQL_ENV_MISSING') {
      console.warn(`DB not configured (missing env vars). Continuing to start server without DB. Error: ${err.message}`);
    } else {
      const meta = getDbMeta();
      const hint = meta ? `${meta.type} ${meta.host}:${meta.port}/${meta.database}` : 'unknown target';
      console.warn(`DB connection failed at startup (${hint}). Continuing to start server without DB. Error: ${err.message}`);
    }
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
    // Helpful for local dev convenience; binding is still controlled by HOST above.
    console.log(`Local access (if applicable): http://localhost:${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });

  return server;
}

module.exports = start();
