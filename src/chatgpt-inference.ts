import { createHash } from 'crypto';

interface ResponseEvent {
  type?: string;
  delta?: unknown;
  code?: unknown;
  error?: { code?: unknown };
  response?: { error?: { code?: unknown } };
}

function safeCode(value: unknown): string {
  return typeof value === 'string' && /^[a-zA-Z0-9_]{1,100}$/.test(value)
    ? value : 'unknown_error';
}

async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  let code = 'unknown_error';
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    code = safeCode(body.error?.code);
  } catch { /* A non-JSON error body must not hide the HTTP status. */ }
  throw Object.assign(new Error(`ChatGPT request failed (HTTP ${response.status}): ${code}`), {
    statusCode: response.status,
    code,
    responseHeaders: { 'retry-after': response.headers.get('retry-after') ?? '' },
  });
}

let cachedCatalog: { tokenHash: string; model: string } | undefined;

async function discoverModel(accessToken: string, signal: AbortSignal): Promise<string> {
  const tokenHash = createHash('sha256').update(accessToken).digest('hex');
  if (cachedCatalog?.tokenHash === tokenHash) return cachedCatalog.model;
  const catalog = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${accessToken}` }, signal,
  });
  await checkResponse(catalog);
  const result = await catalog.json() as { models?: { visibility?: string; slug?: unknown }[] };
  const selected = result.models?.find((item) => item.visibility === 'list'
    && typeof item.slug === 'string' && item.slug.length > 0)?.slug;
  if (typeof selected !== 'string') throw new Error('No visible ChatGPT models are available for this account');
  cachedCatalog = { tokenHash, model: selected };
  return selected;
}

// Named export is used by the provider integration.
// eslint-disable-next-line import/prefer-default-export
export async function chatgptInference(
  prompt: string,
  accessToken: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const selectedModel = model || await discoverModel(accessToken, signal);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: selectedModel, input: [{ role: 'user', content: prompt }], store: false, stream: true,
    }),
    signal,
  });
  await checkResponse(response);
  if (!response.body) throw new Error('ChatGPT response has no stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let completed = false;
  let eventName = '';
  let data: string[] = [];

  const dispatch = () => {
    if (!data.length) { eventName = ''; return; }
    let event: ResponseEvent;
    try {
      event = JSON.parse(data.join('\n')) as ResponseEvent;
    } catch {
      throw new Error('Invalid ChatGPT stream event');
    }
    const type = event.type ?? eventName;
    data = [];
    eventName = '';
    if (type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') throw new Error('Invalid ChatGPT text event');
      text += event.delta;
    } else if (type === 'response.failed' || type === 'error') {
      const code = safeCode(event.response?.error?.code ?? event.error?.code ?? event.code);
      throw Object.assign(new Error(`ChatGPT response failed: ${code}`), { code });
    } else if (type === 'response.incomplete') {
      throw new Error('ChatGPT response incomplete');
    } else if (type === 'response.completed') {
      completed = true;
    }
  };

  const consume = (line: string) => {
    if (!line) { dispatch(); return; }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    if (field === 'data') data.push(value);
  };

  try {
    while (!completed) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value as Uint8Array | undefined, { stream: !chunk.done });
      for (;;) {
        const newline = /\r|\n/.exec(pending);
        if (!newline || (!chunk.done && newline[0] === '\r' && newline.index === pending.length - 1)) break;
        const end = newline.index;
        const width = pending[end] === '\r' && pending[end + 1] === '\n' ? 2 : 1;
        consume(pending.slice(0, end));
        pending = pending.slice(end + width);
        if (completed) break;
      }
      if (chunk.done) {
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (!completed) throw new Error('ChatGPT stream ended before completion');
  return text;
}
