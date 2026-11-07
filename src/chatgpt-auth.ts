import { createHash, randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

interface Credentials {
  hostId: string;
  clientId?: string;
  subject?: string;
  email?: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

export function authDir(): string {
  return process.env.CHATGPT_AUTH_DIR ?? path.join(os.homedir(), '.actual-ai-chatgpt');
}

function ensureDirectory(): string {
  const dir = authDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32' && fs.statSync(dir).mode % 0o100 !== 0) {
    throw new Error(`ChatGPT credential directory must be private (chmod 700): ${dir}`);
  }
  return dir;
}

function readCredentials(): Credentials | undefined {
  try {
    const file = path.join(authDir(), 'credentials.json');
    if (process.platform !== 'win32' && fs.statSync(file).mode % 0o100 !== 0) {
      throw new Error('ChatGPT credential file must be private (chmod 600).');
    }
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Credentials;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    throw new Error('Cannot read ChatGPT credentials. Check their format and permissions (chmod 600).');
  }
}

function saveCredentials(credentials: Credentials): void {
  const dir = ensureDirectory();
  const target = path.join(dir, 'credentials.json');
  const temporary = path.join(dir, `.credentials-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function withLock<T>(operation: () => Promise<T> | T): Promise<T> {
  const dir = ensureDirectory();
  const lock = path.join(dir, '.credentials.lock');
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      throw new Error('ChatGPT credentials are in use by another process. If it crashed, remove .credentials.lock only after confirming no other process is using it.');
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    fs.rmdirSync(lock);
  }
}

async function requestTokens(params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`ChatGPT authorization is temporarily unavailable (HTTP ${response.status}); retry later.`);
    }
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (body.error === 'invalid_grant') {
      throw new Error('ChatGPT session is no longer valid; sign in again.');
    }
    throw new Error(`ChatGPT authorization failed (HTTP ${response.status}).`);
  }
  return response.json() as Promise<TokenResponse>;
}

function requireTokenResponse(tokens: TokenResponse): void {
  if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in)
    || (tokens.expires_in ?? 0) <= 0 || tokens.token_type?.toLowerCase() !== 'bearer') {
    throw new Error('ChatGPT returned incomplete credentials; please sign in again.');
  }
}

let pendingToken: Promise<string> | undefined;

export function getAccessToken(): Promise<string> {
  pendingToken ??= withLock(async () => {
    const saved = readCredentials();
    if (!saved?.clientId || !saved.refreshToken || !saved.accessToken || !saved.expiresAt
        || !saved.scopes?.split(' ').includes('chatgpt.tokens.use.direct')) {
      throw new Error('ChatGPT is not connected. Run the ChatGPT login command first.');
    }
    if (saved.expiresAt > Date.now() + 60000) return saved.accessToken;
    const tokens = await requestTokens(new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: saved.clientId,
      refresh_token: saved.refreshToken,
      resource,
    }));
    requireTokenResponse(tokens);
    const grantedScopes = tokens.scope ?? saved.scopes;
    if (!grantedScopes?.split(' ').includes('chatgpt.tokens.use.direct')) {
      throw new Error('ChatGPT plan access was not granted; sign in again.');
    }
    saveCredentials({
      ...saved,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token ?? saved.idToken,
      scopes: grantedScopes,
      expiresAt: Date.now() + (tokens.expires_in!) * 1000,
    });
    return tokens.access_token!;
  }).finally(() => { pendingToken = undefined; });
  return pendingToken;
}

export async function initializeHost(): Promise<void> {
  await withLock(() => {
    if (!readCredentials()) saveCredentials({ hostId: `urn:uuid:${randomUUID()}` });
  });
}

export async function importSession(source: string): Promise<void> {
  await withLock(() => {
    const current = readCredentials();
    if (!current?.hostId) throw new Error('Initialize this host before importing a ChatGPT session.');
    if (current.refreshToken) throw new Error('A ChatGPT session is already active on this host; sign out before importing.');
    const incoming = JSON.parse(fs.readFileSync(source, 'utf8')) as Credentials;
    if (!incoming.clientId || !incoming.subject || !incoming.accessToken || !incoming.refreshToken
      || !incoming.expiresAt || !incoming.scopes?.split(' ').includes('chatgpt.tokens.use.direct')) {
      throw new Error('The imported ChatGPT session is incomplete.');
    }
    if (current.clientId && current.clientId !== incoming.clientId) {
      throw new Error('A different ChatGPT registration already exists on this host.');
    }
    saveCredentials({ ...incoming, hostId: current.hostId });
  });
}

export async function signIn(): Promise<string> {
  const portSetting = process.env.CHATGPT_CALLBACK_PORT ?? '0';
  if (!/^\d+$/.test(portSetting) || Number(portSetting) > 65535) {
    throw new Error('CHATGPT_CALLBACK_PORT must be an integer between 0 and 65535.');
  }
  const callbackPort = Number(portSetting);
  return withLock(async () => {
    const saved = readCredentials() ?? { hostId: `urn:uuid:${randomUUID()}` };
    if (!saved.hostId) throw new Error('ChatGPT host ID is missing.');
    if (!saved.clientId) saveCredentials(saved);
    const verifier = randomBytes(48).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(callbackPort, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not start the login callback.');
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const params = new URLSearchParams({
      client_id: saved.clientId ?? 'dynamic_agent_client',
      ext_agent_host_id: saved.hostId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      resource,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    if (!saved.clientId) params.set('agent_name_hint', 'actual-ai');
    // Do not print an id_token_hint: authorization URLs may be retained in terminal history.
    const url = `${issuer}/api/accounts/authorize?${params.toString()}`;
    console.log(`Continue with ChatGPT: open this URL in your browser:\n${url}`);
    try {
      const callback = await new Promise<{ code: string; clientId: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ChatGPT sign-in timed out.')), 600000);
        server.on('request', (req, res) => {
          const requestUrl = new URL(req.url ?? '/', redirectUri);
          if (requestUrl.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
          if (requestUrl.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid state'); return; }
          clearTimeout(timer);
          const code = requestUrl.searchParams.get('code');
          const callbackClient = requestUrl.searchParams.get('client_id');
          const clientId = saved.clientId ?? callbackClient;
          if (requestUrl.searchParams.has('error') || !code || !clientId || clientId === 'dynamic_agent_client'
            || (saved.clientId && callbackClient && callbackClient !== saved.clientId)) {
            res.writeHead(400).end('Sign-in failed. You may close this window.');
            reject(new Error('ChatGPT authorization was denied or returned an invalid callback.'));
            return;
          }
          res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('Authorization received. You may close this window.');
          resolve({ code, clientId });
        });
      });
      if (!saved.clientId) {
        saved.clientId = callback.clientId;
        saveCredentials(saved);
      }
      const tokens = await requestTokens(new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: callback.clientId,
        code: callback.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource,
      }));
      requireTokenResponse(tokens);
      if (!tokens.id_token || !tokens.scope?.split(' ').includes('chatgpt.tokens.use.direct')) {
        throw new Error('ChatGPT plan access was not granted.');
      }
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer,
        audience: callback.clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      });
      if (!payload.sub || payload.nonce !== nonce
        || (saved.subject && saved.subject !== payload.sub)) {
        throw new Error('ChatGPT identity validation failed.');
      }
      saveCredentials({
        hostId: saved.hostId,
        clientId: callback.clientId,
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        idToken: tokens.id_token,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in!) * 1000,
        scopes: tokens.scope,
      });
      return typeof payload.email === 'string' ? payload.email : payload.sub;
    } finally {
      server.close();
    }
  });
}

export async function signOut(): Promise<boolean> {
  return withLock(async () => {
    const saved = readCredentials();
    if (!saved?.refreshToken || !saved.clientId) return true;
    let revoked = false;
    try {
      const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(30000) });
      if (!discovery.ok) throw new Error('Could not discover the revocation endpoint.');
      const metadata = await discovery.json() as { revocation_endpoint?: string };
      const endpoint = new URL(metadata.revocation_endpoint ?? '');
      if (endpoint.origin !== issuer || endpoint.protocol !== 'https:') throw new Error('Invalid revocation endpoint.');
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: saved.refreshToken, token_type_hint: 'refresh_token', client_id: saved.clientId }),
      });
      revoked = response.ok;
    } catch { /* Local sign-out must still clear credentials. */ }
    saveCredentials({
      hostId: saved.hostId, clientId: saved.clientId, subject: saved.subject, email: saved.email,
    });
    return revoked;
  });
}
