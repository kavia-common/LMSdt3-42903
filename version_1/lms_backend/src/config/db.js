const path = require('path');
const fs = require('fs');
const { DataSource } = require('typeorm');

/**
 * Small helper to parse an integer env var safely.
 * @param {string|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function parseIntEnv(value, fallback) {
  const n = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Returns a minimal, secret-free description of the target DB.
 * @param {{host: string, port: number, database: string}} target
 * @returns {string}
 */
function describeTarget(target) {
  return `${target.host}:${target.port}/${target.database}`;
}

/**
 * Build AWS RDS-compatible TLS options for mysql2.
 *
 * Behavior:
 * - Enabled by default (RDS-safe) unless explicitly disabled (DB_SSL=false).
 * - Looks for an RDS CA bundle file named `global-bundle.pem` at the backend root
 *   (same folder as package.json), or via DB_SSL_CA_PATH.
 * - Uses `rejectUnauthorized=false` (common when using AWS RDS bundle + older client defaults).
 *
 * @returns {false|{ca?: string, rejectUnauthorized: boolean}}
 */
function buildMySqlSslOptionsFromEnv() {
  const sslEnabledRaw = process.env.DB_SSL || process.env.DB_SSL_ENABLED;

  // RDS-safe default: ON unless explicitly disabled.
  const sslEnabled =
    sslEnabledRaw === undefined || sslEnabledRaw === null
      ? true
      : !['false', '0', 'no'].includes(String(sslEnabledRaw).toLowerCase());

  if (!sslEnabled) {
    return false;
  }

  const caPathFromEnv = process.env.DB_SSL_CA_PATH;
  const defaultCaPath = path.join(process.cwd(), 'global-bundle.pem');
  const caPath =
    caPathFromEnv && String(caPathFromEnv).trim().length > 0
      ? String(caPathFromEnv).trim()
      : defaultCaPath;

  let ca;
  try {
    if (fs.existsSync(caPath)) {
      ca = fs.readFileSync(caPath, 'utf8');
    }
  } catch {
    // If we can't read CA for any reason, fall back to no explicit CA.
    // We still keep rejectUnauthorized=false as requested.
    ca = undefined;
  }

  return {
    ...(ca ? { ca } : {}),
    rejectUnauthorized: false,
  };
}

/**
 * Decide whether preview MySQL port override should be used.
 *
 * The key safety requirement: preview overrides must NOT accidentally override an RDS/production
 * port (3306), which can happen when the backend inherits preview system env vars.
 *
 * We only apply MYSQL_PREVIEW_PORT when explicitly enabled:
 * - DB_USE_PREVIEW_PORT=true, OR
 * - NODE_ENV/APP_ENV indicates preview.
 *
 * @returns {boolean}
 */
function shouldUsePreviewDbPort() {
  const explicit = (process.env.DB_USE_PREVIEW_PORT || '').toLowerCase();
  if (['true', '1', 'yes'].includes(explicit)) return true;
  if (['false', '0', 'no'].includes(explicit)) return false;

  const env = (process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
  return env === 'preview';
}

/**
 * Build MySQL DataSource config from env vars.
 *
 * Canonical env vars (preferred):
 * - DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DEFAULT_DB
 *
 * Back-compat / alternate names:
 * - MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
 * - RDS_HOSTNAME, RDS_PORT, RDS_USERNAME, RDS_PASSWORD, RDS_DB_NAME
 */
function buildMySqlDataSourceOptionsFromEnv() {
  // Support multiple env-var naming conventions to avoid "mismatch" failures across environments.
  const host =
    process.env.DB_HOST ||
    process.env.MYSQL_HOST ||
    process.env.MYSQLHOST ||
    process.env.RDS_HOSTNAME;
  const username =
    process.env.DB_USERNAME ||
    process.env.MYSQL_USER ||
    process.env.MYSQL_USERNAME ||
    process.env.RDS_USERNAME;
  const password =
    process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || process.env.RDS_PASSWORD;
  const database =
    process.env.DEFAULT_DB ||
    process.env.MYSQL_DB ||
    process.env.MYSQL_DATABASE ||
    process.env.RDS_DB_NAME;

  // Port selection (RDS-safe):
  // - Prefer DB_PORT / MYSQL_PORT / RDS_PORT when set
  // - Only allow MYSQL_PREVIEW_PORT to override if explicitly enabled (or env indicates preview)
  const configuredPort = parseIntEnv(process.env.DB_PORT || process.env.MYSQL_PORT || process.env.RDS_PORT, 3306);
  const previewPort = parseIntEnv(process.env.MYSQL_PREVIEW_PORT, configuredPort);

  const port = shouldUsePreviewDbPort() ? previewPort : configuredPort;

  const connectTimeout = parseIntEnv(process.env.DB_CONNECT_TIMEOUT_MS, 20000);
  const poolSize = parseIntEnv(process.env.DB_POOL_SIZE, 10);

  const missing = [];
  if (!host) missing.push('DB_HOST (or MYSQL_HOST/RDS_HOSTNAME)');
  if (!username) missing.push('DB_USERNAME (or MYSQL_USER/RDS_USERNAME)');
  if (!password) missing.push('DB_PASSWORD (or MYSQL_PASSWORD/RDS_PASSWORD)');
  if (!database) missing.push('DEFAULT_DB (or MYSQL_DB/RDS_DB_NAME)');

  if (missing.length > 0) {
    const err = new Error(`MySQL env vars missing: ${missing.join(', ')}`);
    err.code = 'MYSQL_ENV_MISSING';
    throw err;
  }

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const ssl = buildMySqlSslOptionsFromEnv();

  return {
    type: 'mysql',
    host,
    port,
    username,
    password,
    database,

    /**
     * AWS RDS SSL/TLS.
     * TypeORM passes this through to mysql2 as `ssl`.
     */
    ssl,

    /**
     * Improve resilience for long-lived TLS connections (AWS RDS) from local dev.
     * These options are passed through to mysql2's pool.
     */
    connectTimeout,
    extra: {
      connectionLimit: poolSize,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    },

    // TypeORM entities.
    entities: [
      require('../entities/User').UserEntity,
      require('../entities/Course').CourseEntity,
      require('../entities/Lesson').LessonEntity,
      require('../entities/MediaMetadata').MediaMetadataEntity,
      require('../entities/Notification').NotificationEntity,
      require('../entities/AiQuizAttempt').AiQuizAttemptEntity,
      require('../entities/Quiz').QuizEntity,
      require('../entities/QuizAttempt').QuizAttemptEntity,
      require('../entities/UserProgress').UserProgressEntity,
      require('../entities/CourseCompletion').CourseCompletionEntity,
      require('../entities/CourseEnrollment').CourseEnrollmentEntity,
      require('../entities/CalendarEvent').CalendarEventEntity,
      require('../entities/Assessment').AssessmentEntity,
      require('../entities/AssessmentSubmission').AssessmentSubmissionEntity,
    ],

    migrations: [path.join(migrationsDir, '*.js')],

    synchronize: process.env.TYPEORM_SYNC === 'true',
    migrationsRun: false,
    logging: false,
  };
}

let appDataSource = null;
let configuredDbMeta = null;

/**
 * When multiple requests (or startup + request) race to initialize the DataSource,
 * we want to ensure only a single initialize() happens.
 */
let initializationPromise = null;

// PUBLIC_INTERFACE
function getDataSource() {
  /** Returns the singleton TypeORM DataSource instance, if created. */
  return appDataSource;
}

// PUBLIC_INTERFACE
function getDbMeta() {
  /** Returns non-secret metadata about the configured DB (type/host/port/db). */
  return configuredDbMeta;
}

// PUBLIC_INTERFACE
function createDataSourceFromEnv() {
  /** Creates a non-initialized TypeORM DataSource using environment variables (MySQL-only). */
  const options = buildMySqlDataSourceOptionsFromEnv();
  return new DataSource(options);
}

// PUBLIC_INTERFACE
async function initializeDataSource() {
  /**
   * Initializes TypeORM DataSource using environment variables (MySQL-only).
   */
  if (appDataSource && appDataSource.isInitialized) {
    return appDataSource;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const options = buildMySqlDataSourceOptionsFromEnv();
    const target = { host: options.host, port: options.port, database: options.database };

    configuredDbMeta = {
      type: options.type,
      database: options.database,
      host: options.host,
      port: options.port,
    };

    console.log(`mysql configuring connection target: ${describeTarget(target)}`);

    appDataSource = new DataSource(options);
    await appDataSource.initialize();

    console.log(`mysql connected: ${describeTarget(target)}`);
    return appDataSource;
  })();

  try {
    return await initializationPromise;
  } finally {
    if (!appDataSource || !appDataSource.isInitialized) {
      initializationPromise = null;
    }
  }
}

// PUBLIC_INTERFACE
async function checkDatabaseConnectivity() {
  /** Checks DB connectivity (simple ping) and returns boolean. */
  try {
    if (!appDataSource || !appDataSource.isInitialized) {
      return false;
    }
    await appDataSource.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// PUBLIC_INTERFACE
function getConfiguredDbName() {
  /** Returns the configured database name (DEFAULT_DB), if known. */
  return process.env.DEFAULT_DB || null;
}

module.exports = {
  initializeDataSource,
  checkDatabaseConnectivity,
  getConfiguredDbName,
  getDataSource,
  createDataSourceFromEnv,
  getDbMeta,
};
