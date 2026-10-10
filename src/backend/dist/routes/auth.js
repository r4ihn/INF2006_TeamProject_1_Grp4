import { Router } from 'express';
import { z } from 'zod';
import { DEV_USERS } from '../auth/profile.js';
const DEV_TOKEN_SECONDS = 12 * 60 * 60; // a working day, so demos don't expire mid-way
/**
 * Public (no sign-in needed):
 *   GET  /auth/config     — tells the web app how to sign in (Cognito ids are public by design)
 *   POST /auth/dev/login  — development mode only: get a token for the staff or manager user
 */
export function authRouter(auth, devIssuer) {
    const router = Router();
    router.get('/config', (_req, res) => {
        res.json({
            mode: auth.mode,
            region: auth.region,
            userPoolId: auth.userPoolId,
            clientId: auth.clientId,
        });
    });
    if (auth.mode === 'dev' && devIssuer) {
        const body = z.strictObject({
            role: z.enum(['staff', 'manager'], { error: 'Choose staff or manager' }),
        });
        router.post('/dev/login', async (req, res) => {
            const { role } = body.parse(req.body);
            const user = DEV_USERS[role];
            const accessToken = await devIssuer.issue({
                sub: user.sub,
                username: user.email,
                groups: [...user.groups],
                expiresInSeconds: DEV_TOKEN_SECONDS,
            });
            res.json({ accessToken, expiresIn: DEV_TOKEN_SECONDS, tokenType: 'Bearer' });
        });
    }
    return router;
}
//# sourceMappingURL=auth.js.map