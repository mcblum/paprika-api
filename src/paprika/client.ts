import { z } from 'zod';
import {
  paprikaApiResponse,
  PaprikaGroceryItemSchema,
  PaprikaGroceryListSchema,
  PaprikaLoginResultSchema,
} from '../types/paprika.js';
import type { PaprikaGroceryItem, PaprikaGroceryList } from '../types/paprika.js';
import type { Logger } from '../logger.js';

const BASE_URL = 'https://www.paprikaapp.com/api/v2';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1_000;

const SHARED_HEADERS = {
  'User-Agent': 'Paprika Recipe Manager 3/3.3.1 (macOS)',
  'Accept-Encoding': 'gzip, deflate',
} as const;

function extractApiErrorHint(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const obj = body as Record<string, unknown>;
  const msg = obj['error'] ?? obj['message'] ?? obj['detail'];
  return typeof msg === 'string' ? msg : null;
}

interface CachedToken {
  readonly value: string;
  readonly expiresAt: number;
}

export class PaprikaClient {
  private cachedToken: CachedToken | null = null;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly logger: Logger,
  ) {}

  async getLists(): Promise<PaprikaGroceryList[]> {
    const schema = paprikaApiResponse(PaprikaGroceryListSchema.array());
    const data = await this.request('/sync/grocerylists/', schema);
    return data.result;
  }

  async getItems(): Promise<PaprikaGroceryItem[]> {
    const schema = paprikaApiResponse(PaprikaGroceryItemSchema.array());
    const data = await this.request('/sync/groceries/', schema);
    return data.result;
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken !== null && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.value;
    }
    return this.authenticate();
  }

  private async authenticate(): Promise<string> {
    this.logger.debug('Authenticating with Paprika API');

    const form = new FormData();
    form.append('email', this.email);
    form.append('password', this.password);

    const response = await fetch(`${BASE_URL}/account/login/`, {
      method: 'POST',
      body: form,
      headers: SHARED_HEADERS,
    });

    const json: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const hint = extractApiErrorHint(json);
      throw new Error(
        `Paprika authentication failed: ${response.status} ${response.statusText}` +
          (hint !== null ? ` — ${hint}` : ''),
      );
    }

    const parsed = paprikaApiResponse(PaprikaLoginResultSchema).safeParse(json);
    if (!parsed.success) {
      const hint = extractApiErrorHint(json);
      throw new Error(
        'Paprika authentication returned an unexpected response' +
          (hint !== null ? `: ${hint}` : '. Check your credentials and try again.'),
      );
    }

    this.cachedToken = {
      value: parsed.data.result.token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    };

    this.logger.debug('Paprika authentication successful');
    return this.cachedToken.value;
  }

  private async request<TSchema extends z.ZodTypeAny>(
    path: string,
    schema: TSchema,
    retryOnUnauthorized = true,
  ): Promise<z.infer<TSchema>> {
    const token = await this.getToken();

    const response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        ...SHARED_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 && retryOnUnauthorized) {
      this.logger.warn('Paprika returned 401, clearing token and re-authenticating');
      this.cachedToken = null;
      return this.request(path, schema, false);
    }

    if (!response.ok) {
      throw new Error(
        `Paprika request to ${path} failed: ${response.status} ${response.statusText}`,
      );
    }

    const json: unknown = await response.json();
    return schema.parse(json) as z.infer<TSchema>;
  }
}
