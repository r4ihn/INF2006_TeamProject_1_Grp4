import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import type { PrismaClient } from './db/client.js';
import { requireAuth, tokenAuthenticator, type Authenticator } from './auth/authenticate.js';
import { cognitoProfileFetcher, devProfileFetcher, type ProfileFetcher } from './auth/profile.js';
import { createVerifier, LocalTokenIssuer, type TokenVerifier } from './auth/tokens.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { authRouter } from './routes/auth.js';
import { forecastRouter } from './routes/forecast.js';
import { importsRouter } from './routes/imports.js';
import { healthRouter } from './routes/health.js';
import { itemsRouter } from './routes/items.js';
import { meRouter } from './routes/me.js';
import { stockRouter } from './routes/stock.js';
import { suppliersRouter } from './routes/suppliers.js';

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  /** Tests only: replace sign-in entirely (e.g. pick the org from a header). */
  authenticate?: Authenticator;
  /** Tests only: token verifier / Cognito GetUser stand-ins for Cognito mode. */
  verifier?: TokenVerifier;
  fetchProfile?: ProfileFetcher;
}

// Builds the Express app without starting a server, so tests can call it directly
// with Supertest and hand in their own database client and sign-in stand-ins.
export function createApp({ config, prisma, ...deps }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // The web app signs in by calling Cognito directly from the browser
          connectSrc: [
            "'self'",
            ...(config.auth.mode === 'cognito'
              ? [`https://cognito-idp.${config.auth.region}.amazonaws.com`]
              : []),
          ],
          // CloudFront already redirects http → https; upgrading here would break
          // http://localhost when trying a production build locally
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.use(
    '/health',
    healthRouter({
      pingDatabase: async () => {
        // Also checks the migrations have run: a fresh database answers but has no tables.
        const [row] = await prisma.$queryRaw<{ ready: boolean }[]>`
          SELECT to_regclass('public.organizations') IS NOT NULL AS ready`;
        return { tablesReady: Boolean(row?.ready) };
      },
    }),
  );

  // ── Sign-in ──
  // Development mode: a local key signs Cognito-shaped tokens, and the same Cognito
  // verifier checks them (it's given the local public key instead of downloading AWS's).
  let devIssuer: LocalTokenIssuer | null = null;
  let verifier = deps.verifier;
  if (!verifier) {
    const cognitoVerifier = createVerifier(config.auth);
    if (config.auth.mode === 'dev') {
      devIssuer = new LocalTokenIssuer(config.auth);
      cognitoVerifier.cacheJwks(devIssuer.jwks);
    }
    verifier = cognitoVerifier;
  }
  const fetchProfile =
    deps.fetchProfile ??
    (config.auth.mode === 'cognito' ? cognitoProfileFetcher(config.auth) : devProfileFetcher);
  const authenticate =
    deps.authenticate ??
    tokenAuthenticator({ prisma, verifier, fetchProfile, defaultOrgSlug: config.demoOrgSlug });

  app.use('/auth', authRouter(config.auth, devIssuer));

  // ── Everything under /api needs a signed-in user and is scoped to their café ──
  const api = express.Router();
  api.use(requireAuth(authenticate));
  api.use('/me', meRouter(prisma));
  api.use('/suppliers', suppliersRouter(prisma));
  api.use('/items', itemsRouter(prisma));
  api.use('/stock', stockRouter(prisma));
  api.use('/imports', importsRouter(prisma));
  api.use('/forecast', forecastRouter(prisma)); // managers only
  app.use('/api', api);

  if (config.staticDir) serveWebApp(app, config.staticDir);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Serves the built web app (production). Files under /assets have content hashes in their
 * names, so browsers and CloudFront may cache them for a year; index.html is never cached,
 * so a new release shows up on the next page load. Any other page address (e.g. /stock or
 * /forecast?item=…) gets index.html and the app's router takes over.
 */
function serveWebApp(app: Express, dir: string): void {
  const root = path.resolve(dir);
  const index = path.join(root, 'index.html');
  app.use(
    '/assets',
    express.static(path.join(root, 'assets'), { immutable: true, maxAge: '365d', index: false }),
  );
  app.use(express.static(root, { index: false, maxAge: 0 }));
  app.use((req, res, next) => {
    const isPage =
      (req.method === 'GET' || req.method === 'HEAD') &&
      !/^\/(api|auth|health|assets)(\/|$)/.test(req.path) &&
      req.accepts('html') === 'html';
    if (!isPage) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
