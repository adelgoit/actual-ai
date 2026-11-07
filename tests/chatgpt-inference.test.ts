import { chatgptInference } from '../src/chatgpt-inference';

const originalFetch = global.fetch;
const encoder = new TextEncoder();

function streamResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => { global.fetch = originalFetch; });

test('streams fragmented SSE and sends the ChatGPT plan request contract', async () => {
  const fetchMock = jest.fn().mockResolvedValue(streamResponse([
    'event: response.output_text.delta\r',
    '\ndata: {"delta":"Caf',
    'è"}\r\n\r\nevent: response.completed\r\ndata: {}\r\n\r\n',
  ]));
  global.fetch = fetchMock;
  const { signal } = new AbortController();
  await expect(chatgptInference('hello', 'secret', 'my-model', signal)).resolves.toBe('Cafè');
  expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({
    signal,
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'my-model', input: [{ role: 'user', content: 'hello' }], store: false, stream: true,
    }),
  }));
});

test('discovers the first visible model when none is configured', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      models: [
        { slug: 'hidden', visibility: 'hide' }, { slug: 'usable', visibility: 'list' },
      ],
    })))
    .mockResolvedValueOnce(streamResponse(['event: response.completed\ndata: {}\n\n']));
  global.fetch = fetchMock;
  await chatgptInference('hello', 'secret', '', new AbortController().signal);
  const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
  const body = JSON.parse(calls[1][1].body) as { model: string };
  expect(body.model).toBe('usable');
});

test('ignores the SSE sentinel after a completed response in the same chunk', async () => {
  global.fetch = jest.fn().mockResolvedValue(streamResponse([
    'event: response.output_text.delta\ndata: {"delta":"ok"}\n\nevent: response.completed\ndata: {}\n\ndata: [DONE]\n\n',
  ]));
  await expect(chatgptInference('hello', 'secret', 'model', new AbortController().signal))
    .resolves.toBe('ok');
});

test('preserves structured HTTP errors without leaking the response body', async () => {
  global.fetch = jest.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
    error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'sensitive' },
  }), { status: 429, headers: { 'retry-after': '5' } })));
  await expect(chatgptInference('hello', 'secret', 'model', new AbortController().signal))
    .rejects.toMatchObject({
      statusCode: 429,
      code: 'subscription_sharing_usage_limit_exceeded',
      responseHeaders: { 'retry-after': '5' },
    });
  await expect(chatgptInference('hello', 'secret', 'model', new AbortController().signal))
    .rejects.not.toThrow('sensitive');
});

test('reuses the selected model only for the same token', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ slug: 'one', visibility: 'list' }] })))
    .mockResolvedValueOnce(streamResponse(['event: response.completed\ndata: {}\n\n']))
    .mockResolvedValueOnce(streamResponse(['event: response.completed\ndata: {}\n\n']))
    .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ slug: 'two', visibility: 'list' }] })))
    .mockResolvedValueOnce(streamResponse(['event: response.completed\ndata: {}\n\n']));
  global.fetch = fetchMock;
  const { signal } = new AbortController();
  await chatgptInference('hello', 'token-1', '', signal);
  await chatgptInference('hello', 'token-1', '', signal);
  await chatgptInference('hello', 'token-2', '', signal);
  const calls = fetchMock.mock.calls as unknown as [string, { body?: string }][];
  expect(calls.map(([url]) => url)).toEqual([
    'https://api.openai.com/v1/models', 'https://api.openai.com/v1/responses',
    'https://api.openai.com/v1/responses', 'https://api.openai.com/v1/models',
    'https://api.openai.com/v1/responses',
  ]);
  expect(JSON.parse(calls[4][1].body ?? '')).toMatchObject({ model: 'two' });
});

test.each([
  ['event: response.output_text.delta\ndata: {"delta":"partial"}\n\n', 'before completion'],
  ['event: response.incomplete\ndata: {}\n\n', 'incomplete'],
  ['event: response.failed\ndata: {"response":{"error":{"code":"subscription_sharing_usage_unavailable"}}}\n\n', 'subscription_sharing_usage_unavailable'],
  ['event: response.output_text.delta\ndata: not-json\n\n', 'Invalid ChatGPT stream event'],
])('rejects incomplete or failed stream', async (body, expected) => {
  global.fetch = jest.fn().mockResolvedValue(streamResponse([body]));
  await expect(chatgptInference('hello', 'secret', 'model', new AbortController().signal))
    .rejects.toThrow(expected);
});
