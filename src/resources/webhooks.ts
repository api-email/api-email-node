import { path, type HttpClient, type PostOptions, type RequestOptions } from '../http';
import { paginate } from '../pagination';
import type { CreateWebhookParams, CreatedWebhook, Page, Webhook } from '../types';

export class Webhooks {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Creates an endpoint for the given events. The returned `secret` signs every event. */
  async create(params: CreateWebhookParams, options?: PostOptions): Promise<CreatedWebhook> {
    return this.#http.request<CreatedWebhook>({ method: 'POST', path: '/webhooks', body: params, options });
  }

  async list(params: { cursor?: string } = {}, options?: RequestOptions): Promise<Page<Webhook>> {
    return this.#http.request<Page<Webhook>>({ method: 'GET', path: '/webhooks', query: { cursor: params.cursor }, options });
  }

  listAll(options?: RequestOptions): AsyncIterable<Webhook> {
    return paginate((cursor) => this.list({ cursor }, options));
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.#http.request<unknown>({ method: 'DELETE', path: path`/webhooks/${id}`, options });
  }
}
