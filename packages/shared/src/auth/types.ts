export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: string;
  workspaceId: string | null;
  workspaceSlug: string | null;
}

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  workspaceId: string | null;
  workspaceSlug: string | null;
  iat: number;
  exp: number;
}
