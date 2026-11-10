export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordClient {
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  getUser(accessToken: string): Promise<DiscordUser>;
}

const API = 'https://discord.com/api';

export function createDiscordClient(cfg: { clientId: string; clientSecret: string }): DiscordClient {
  return {
    authorizeUrl(state, redirectUri) {
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify',
        state,
      });
      return `${API}/oauth2/authorize?${params}`;
    },
    async exchangeCode(code, redirectUri) {
      const res = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error(`discord token exchange failed: ${res.status}`);
      const body = (await res.json()) as { access_token: string };
      return body.access_token;
    },
    async getUser(accessToken) {
      const res = await fetch(`${API}/users/@me`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`discord user fetch failed: ${res.status}`);
      return (await res.json()) as DiscordUser;
    },
  };
}
