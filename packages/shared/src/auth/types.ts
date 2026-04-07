export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  iat: number;
  exp: number;
}
