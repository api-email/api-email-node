import { path, type HttpClient, type RequestOptions } from '../http';
import { paginate } from '../pagination';
import type { InboundEmail, Page } from '../types';

export class Inbound {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** One received message, with the same fields as the `email.received` delivery. */
  async get(id: string, options?: RequestOptions): Promise<InboundEmail> {
    return this.#http.request<InboundEmail>({ method: 'GET', path: path`/inbound/${id}`, options });
  }

  /** One page of received messages, newest first. */
  async list(params: { cursor?: string } = {}, options?: RequestOptions): Promise<Page<InboundEmail>> {
    return this.#http.request<Page<InboundEmail>>({ method: 'GET', path: '/inbound', query: { cursor: params.cursor }, options });
  }

  listAll(options?: RequestOptions): AsyncIterable<InboundEmail> {
    return paginate((cursor) => this.list({ cursor }, options));
  }

  /** Downloads attachment number `index` (from 0), kept for 7 days after the message arrived. */
  async attachment(id: string, index: number, options?: RequestOptions): Promise<Uint8Array> {
    if (!Number.isInteger(index) || index < 0) {
      throw new TypeError(`api-email: attachment index must be a whole number from 0, got ${index}`);
    }
    return this.#http.request<Uint8Array>({ method: 'GET', path: path`/inbound/${id}/attachments/${index}`, options, binary: true });
  }
}
