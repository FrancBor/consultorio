import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

const PostgresSessionStore = connectPgSimple(session);

export function createPostgresSessionStore({ pool, logger }) {
  return new PostgresSessionStore({
    pool,
    tableName: 'sesiones_http',
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60,
    errorLog(message, error) {
      logger.error({ errorType: error?.name ?? 'Error' }, message);
    },
  });
}

export function createSessionMiddleware({
  store,
  secret,
  cookieName,
  ttlHours,
  secure,
}) {
  return session({
    name: cookieName,
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: ttlHours * 60 * 60 * 1_000,
    },
  });
}

export function createSessionRuntime({ pool, environment, logger }) {
  const store = createPostgresSessionStore({ pool, logger });
  const middleware = createSessionMiddleware({
    store,
    secret: environment.SESSION_SECRET,
    cookieName: environment.SESSION_COOKIE_NAME,
    ttlHours: environment.SESSION_TTL_HOURS,
    secure: environment.NODE_ENV === 'production',
  });

  return { middleware, store };
}
