export function cognitoProfileFetcher(auth, fetchImpl = fetch) {
    return async (accessToken) => {
        const res = await fetchImpl(`https://cognito-idp.${auth.region}.amazonaws.com/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.GetUser',
            },
            body: JSON.stringify({ AccessToken: accessToken }),
        });
        const body = (await res.json().catch(() => ({})));
        if (!res.ok)
            throw new Error(`Cognito GetUser failed: ${body.message ?? res.status}`);
        const attr = (name) => body.UserAttributes?.find((a) => a.Name === name)?.Value;
        const email = attr('email');
        if (!email)
            throw new Error('Cognito user has no email attribute');
        return { email, name: attr('name'), orgSlug: attr('custom:org') };
    };
}
/** The two built-in development users. */
export const DEV_USERS = {
    staff: {
        sub: 'dev-staff-0000-4000-8000-000000000001',
        email: 'staff@demo.cafe',
        name: 'Sam (staff)',
        groups: ['staff'],
    },
    manager: {
        sub: 'dev-manager-0000-4000-8000-000000000002',
        email: 'manager@demo.cafe',
        name: 'Mia (manager)',
        groups: ['manager'],
    },
};
export const devProfileFetcher = async (_token, claims) => {
    const user = Object.values(DEV_USERS).find((u) => u.sub === claims.sub);
    if (!user)
        throw new Error(`Unknown development user ${claims.sub}`);
    return { email: user.email, name: user.name };
};
//# sourceMappingURL=profile.js.map