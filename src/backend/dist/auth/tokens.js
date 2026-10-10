// Verifying access tokens — the same code path for Cognito and development mode.
//
// Cognito signs access tokens with a private key and publishes the public keys (JWKS) at
//   https://cognito-idp.<region>.amazonaws.com/<userPoolId>/.well-known/jwks.json
// aws-jwt-verify downloads (and caches) those keys, then checks the signature, expiry,
// issuer, token_use = "access" and client_id on every request.
//
// In development mode there is no real pool: we generate a key pair at start-up, hand its
// public key to the *same* verifier, and sign tokens that look exactly like Cognito's.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { SignJWT } from 'jose';
export function cognitoIssuer(region, userPoolId) {
    return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}
export function createVerifier(auth) {
    const verifier = CognitoJwtVerifier.create({
        userPoolId: auth.userPoolId,
        tokenUse: 'access',
        clientId: auth.clientId,
    });
    return {
        verify: async (token) => (await verifier.verify(token)),
        cacheJwks: (jwks) => verifier.cacheJwks(jwks),
    };
}
/** Signs Cognito-shaped access tokens with a local key (development mode and tests). */
export class LocalTokenIssuer {
    auth;
    privateKey;
    kid = `local-${randomUUID().slice(0, 8)}`;
    publicJwk;
    constructor(auth) {
        this.auth = auth;
        const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        this.privateKey = privateKey;
        this.publicJwk = {
            ...publicKey.export({ format: 'jwk' }),
            kid: this.kid,
            alg: 'RS256',
            use: 'sig',
        };
    }
    get jwks() {
        return { keys: [this.publicJwk] };
    }
    /** Issues an access token like Cognito's for the given user. */
    async issue(opts) {
        const now = Math.floor(Date.now() / 1000);
        const claims = {
            sub: opts.sub,
            'cognito:groups': opts.groups,
            iss: cognitoIssuer(this.auth.region, this.auth.userPoolId),
            client_id: this.auth.clientId,
            origin_jti: randomUUID(),
            event_id: randomUUID(),
            token_use: 'access',
            scope: 'aws.cognito.signin.user.admin',
            auth_time: now,
            iat: now,
            exp: now + (opts.expiresInSeconds ?? 3600),
            jti: randomUUID(),
            username: opts.username ?? opts.sub,
            ...opts.overrides,
        };
        return new SignJWT(claims)
            .setProtectedHeader({ alg: 'RS256', kid: this.kid, typ: 'JWT' })
            .sign(this.privateKey);
    }
}
//# sourceMappingURL=tokens.js.map