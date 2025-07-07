import { NextFunction, Request, Response } from 'express';
import jwt, { JwtHeader, JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

interface DecodedToken extends JwtPayload {
    aud: string | string[];
    sub: string;
    iss: string;
}

const clientCache = new Map<string, ReturnType<typeof jwksClient>>();

export const auth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader?.toString().replace(/^Bearer\s+/i, '');

        if (!token) {
            console.warn("PREVENT:STEP 1 - No token provided");
            return res.status(401).send('Authentication error: No token provided');
        }

        const decoded = jwt.decode(token, { complete: true });
        if (!decoded || !decoded.header || !decoded.payload) {
            console.warn("PREVENT:STEP 2 - Invalid token format");
            return res.status(401).send('Access Denied: Invalid token format');
        }

        const { kid } = decoded.header as JwtHeader;
        const payload = decoded.payload as DecodedToken;

        if (!payload.iss || !payload.sub) {
            console.warn("PREVENT:STEP 3 - Missing issuer or subject");
            return res.status(401).send('Access Denied: Token missing issuer or subject');
        }

        // Reuse cached JWKS client per issuer
        const issuer = payload.iss;
        const client = clientCache.get(issuer) || jwksClient({
            jwksUri: `${issuer}/.well-known/jwks.json`,
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 10,
        });

        clientCache.set(issuer, client);

        const key = await client.getSigningKey(kid!);
        const publicKey = key.getPublicKey();

        jwt.verify(token, publicKey, { issuer }, (err, verifiedPayload) => {
            if (err || !verifiedPayload) {
                console.warn("PREVENT:STEP 4 - Token verification failed", err);
                return res.status(401).send('Access Denied: Invalid token');
            }

            const aud = (verifiedPayload as DecodedToken).aud;
            const audiences = Array.isArray(aud) ? aud : [aud];

            if (!audiences.includes('media')) {
                console.warn("PREVENT:STEP 5 - Invalid audience", audiences);
                return res.status(401).send('Access Denied: Invalid audience');
            }
            // ✅ Securely attach user info
            req.headers["x-user"] = payload.sub;
            next();
        });

    } catch (err) {
        console.error("PREVENT:STEP 6 - Uncaught error", err);
        return res.status(401).send('Authentication error');
    }
};
