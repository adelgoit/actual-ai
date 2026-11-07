import LlmService from '../src/llm-service';
import {
  LlmModelFactoryI, ActualApiServiceI, PromptGeneratorI, ProcessingStrategyI,
} from '../src/types';
import RateLimiter from '../src/utils/rate-limiter';
import TransactionProcessor from '../src/transaction/transaction-processor';
import BatchTransactionProcessor from '../src/transaction/batch-transaction-processor';
import TagService from '../src/transaction/tag-service';
import { getAccessToken } from '../src/chatgpt-auth';
import { chatgptInference } from '../src/chatgpt-inference';

jest.mock('../src/chatgpt-auth', () => ({ getAccessToken: jest.fn() }));
jest.mock('../src/chatgpt-inference', () => ({ chatgptInference: jest.fn() }));

const token = jest.mocked(getAccessToken);
const inference = jest.mocked(chatgptInference);
const factory: LlmModelFactoryI = {
  create: () => { throw new Error('ChatGPT must not create an API-key model'); },
  getProvider: () => 'chatgpt',
  getModelProvider: () => 'chatgpt',
};

describe('ChatGPT classification integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    token.mockResolvedValue('oauth-token');
  });

  test('passes the prompt and configured model to the ChatGPT plan', async () => {
    inference.mockResolvedValue('{"type":"existing","categoryId":"a1b2c3d4-1234-1234-1234-123456789abc"}');
    const service = new LlmService(factory, new RateLimiter(), true, undefined, { chatgptModel: 'example' });
    await expect(service.ask('prompt')).resolves.toMatchObject({
      type: 'existing', categoryId: 'a1b2c3d4-1234-1234-1234-123456789abc',
    });
    expect(inference).toHaveBeenCalledWith('prompt', 'oauth-token', 'example', expect.any(AbortSignal));
  });

  test('stops the batch without changing notes when ChatGPT is unavailable', async () => {
    inference.mockRejectedValue(Object.assign(new Error('ChatGPT usage limit reached'), {
      statusCode: 429, code: 'subscription_sharing_usage_limit_exceeded',
    }));
    const service = new LlmService(factory, new RateLimiter(), true);
    const updateTransactionNotes = jest.fn();
    const api = { updateTransactionNotes } as unknown as ActualApiServiceI;
    const prompts = { generate: jest.fn().mockReturnValue('prompt') } as unknown as PromptGeneratorI;
    const processor = new TransactionProcessor(api, service, prompts, new TagService('#miss', '#guessed'), []);
    const batch = new BatchTransactionProcessor(processor, 20);
    const transactions = [{ id: 'one' }, { id: 'two' }] as Parameters<typeof batch.process>[0];
    await expect(batch.process(transactions, [], [], [], [], new Map())).rejects.toThrow('ChatGPT usage limit reached');
    expect(inference).toHaveBeenCalledTimes(1);
    expect(updateTransactionNotes).not.toHaveBeenCalled();
  });

  test('passes a successful classification to the existing strategy', async () => {
    inference.mockResolvedValue('{"type":"existing","categoryId":"a1b2c3d4-1234-1234-1234-123456789abc"}');
    const service = new LlmService(factory, new RateLimiter(), true);
    const handle = jest.fn().mockResolvedValue(undefined);
    const strategy = {
      isSatisfiedBy: () => true, process: handle,
    } as unknown as ProcessingStrategyI;
    const prompts = { generate: () => 'prompt' } as unknown as PromptGeneratorI;
    const updateTransactionNotes = jest.fn();
    const api = { updateTransactionNotes } as unknown as ActualApiServiceI;
    const processor = new TransactionProcessor(api, service, prompts, new TagService('#miss', '#guessed'), [strategy]);
    const transaction = { id: 'one' } as Parameters<typeof processor.process>[0];
    await processor.process(transaction, [], [], [], [], new Map());
    expect(handle).toHaveBeenCalledTimes(1);
    expect(updateTransactionNotes).not.toHaveBeenCalled();
  });
});
