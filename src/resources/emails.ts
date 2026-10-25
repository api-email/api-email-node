import { toBase64 } from '../base64';
import { path, type HttpClient, type PostOptions, type RequestOptions } from '../http';
import { paginate } from '../pagination';
import type { Email, ListEmailsParams, Page, SendEmailParams, SendEmailResponse } from '../types';

export class Emails {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Sends an email. Pass `idempotencyKey` for anything your code might retry. */
  async send(params: SendEmailParams, options?: PostOptions): Promise<SendEmailResponse> {
    return this.#http.request<SendEmailResponse>({ method: 'POST', path: '/emails', body: toWire(params), options });
  }

  async get(id: string, options?: RequestOptions): Promise<Email> {
    return this.#http.request<Email>({ method: 'GET', path: path`/emails/${id}`, options });
  }

  /** One page of recent emails, newest first. */
  async list(params: ListEmailsParams = {}, options?: RequestOptions): Promise<Page<Email>> {
    const query = { status: params.status, to: params.to, tag: params.tag, cursor: params.cursor };
    return this.#http.request<Page<Email>>({ method: 'GET', path: '/emails', query, options });
  }

  /** Every matching email, page by page: `for await (const email of apiEmail.emails.listAll())`. */
  listAll(params: Omit<ListEmailsParams, 'cursor'> = {}, options?: RequestOptions): AsyncIterable<Email> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  /** Cancels a scheduled email that has not been sent yet. */
  async cancel(id: string, options?: RequestOptions): Promise<Email> {
    return this.#http.request<Email>({ method: 'DELETE', path: path`/emails/${id}`, options });
  }
}

function toWire(params: SendEmailParams): Record<string, unknown> {
  const { scheduled_at, attachments, ...rest } = params;
  const body: Record<string, unknown> = { ...rest };
  if (scheduled_at !== undefined) body.scheduled_at = scheduled_at instanceof Date ? scheduled_at.toISOString() : scheduled_at;
  if (attachments !== undefined) {
    body.attachments = attachments.map((a) => ({ ...a, content: typeof a.content === 'string' ? a.content : toBase64(a.content) }));
  }
  return body;
}
