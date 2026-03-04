export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface StoredSession {
  id: string;
  cookies: StoredCookie[];
  url: string;
  createdAt: string;
  updatedAt: string;
}
