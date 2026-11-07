import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import {
  getAccessToken, importSession, initializeHost, signIn, signOut,
} from '../src/chatgpt-auth';

describe('ChatGPT credentials', () => {
  let dir: string;
  const originalFetch = global.fetch;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-ai-auth-'));
    process.env.CHATGPT_AUTH_DIR = dir;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.CHATGPT_AUTH_DIR;
    delete process.env.CHATGPT_CALLBACK_PORT;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(['-1', '65536', '123abc', '1.5', ''])('rejects an invalid callback port %s', async (port) => {
    process.env.CHATGPT_CALLBACK_PORT = port;
    await expect(signIn()).rejects.toThrow('CHATGPT_CALLBACK_PORT');
    expect(fs.existsSync(path.join(dir, 'credentials.json'))).toBe(false);
  });

  function store(expiry: number): void {
    fs.writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify({
      hostId: 'host',
      clientId: 'issued-client',
      subject: 'user',
      accessToken: 'old',
      refreshToken: 'refresh',
      expiresAt: expiry,
      scopes: 'openid chatgpt.tokens.use.direct',
    }), { mode: 0o600 });
  }

  it('serializes simultaneous refreshes and saves rotating credentials', async () => {
    store(Date.now() - 1);
    const mock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer',
      }),
    });
    global.fetch = mock as unknown as typeof fetch;
    await expect(Promise.all([getAccessToken(), getAccessToken()])).resolves.toEqual(['new', 'new']);
    expect(mock).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8')) as { refreshToken?: string; clientId?: string };
    expect(saved.refreshToken).toBe('new-refresh');
    expect(saved.clientId).toBe('issued-client');
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'credentials.json')).mode % 0o100).toBe(0);
  });

  it('fails closed when another process owns the credential lock', async () => {
    store(Date.now() - 1);
    fs.mkdirSync(path.join(dir, '.credentials.lock'));
    await expect(getAccessToken()).rejects.toThrow('another process');
  });

  it('clears local tokens even when remote revocation fails', async () => {
    store(Date.now() + 3600000);
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    await expect(signOut()).resolves.toBe(false);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8')) as { clientId?: string; refreshToken?: string };
    expect(saved.clientId).toBe('issued-client');
    expect(saved.refreshToken).toBeUndefined();
  });

  it('imports a session without replacing the destination host ID', async () => {
    await initializeHost();
    const target = path.join(dir, 'credentials.json');
    const { hostId } = JSON.parse(fs.readFileSync(target, 'utf8')) as { hostId: string };
    const input = path.join(dir, 'incoming.json');
    fs.writeFileSync(input, JSON.stringify({
      hostId: 'other-host',
      clientId: 'client',
      subject: 'user',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 50000,
      scopes: 'chatgpt.tokens.use.direct',
    }));
    await importSession(input);
    const result = JSON.parse(fs.readFileSync(target, 'utf8')) as { hostId: string; clientId: string };
    expect(result.hostId).toBe(hostId);
    expect(result.clientId).toBe('client');
    await expect(importSession(input)).rejects.toThrow('already active');
  });

  it('rejects invalid state and the dynamic registration placeholder', async () => {
    const probe = http.createServer();
    await new Promise<void>((resolve) => { probe.listen(0, '127.0.0.1', resolve); });
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('No callback port available');
    process.env.CHATGPT_CALLBACK_PORT = String(address.port);
    await new Promise<void>((resolve, reject) => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
    let announce!: (url: string) => void;
    const announced = new Promise<string>((resolve) => { announce = resolve; });
    const spy = jest.spyOn(console, 'log').mockImplementation((message: string) => {
      announce(message.split('\n')[1]);
    });
    try {
      const login = signIn();
      const rejected = expect(login).rejects.toThrow('invalid callback');
      const authorization = new URL(await announced);
      const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
      expect(redirect.hostname).toBe('127.0.0.1');
      expect(redirect.port).toBe(process.env.CHATGPT_CALLBACK_PORT);
      const request = (url: URL): Promise<number | undefined> => new Promise((resolve, reject) => {
        http.get(url, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
      });
      redirect.searchParams.set('state', 'incorrect');
      expect(await request(redirect)).toBe(400);
      redirect.searchParams.set('state', authorization.searchParams.get('state')!);
      redirect.searchParams.set('code', 'code');
      redirect.searchParams.set('client_id', 'dynamic_agent_client');
      expect(await request(redirect)).toBe(400);
      await rejected;
    } finally {
      spy.mockRestore();
    }
  });
});
