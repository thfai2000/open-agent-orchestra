import * as jose from 'jose';
import type { AuthUser, JwtPayload } from './types.js';

const JWT_EXPIRY = '7d';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return new TextEncoder().encode(secret);
}

export async function createJwt(user: AuthUser): Promise<string> {
  return new jose.SignJWT({
    userId: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jose.jwtVerify(token, getSecret());
  return payload as unknown as JwtPayload;
}
