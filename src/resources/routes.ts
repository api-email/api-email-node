import { path, type HttpClient, type PostOptions, type RequestOptions } from '../http';
import { paginate } from '../pagination';
import type { CreateRouteParams, CreatedRoute, Page, Route } from '../types';

export class Routes {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Forwards matching incoming email to a URL. The returned `secret` signs every delivery. */
  async create(params: CreateRouteParams, options?: PostOptions): Promise<CreatedRoute> {
    return this.#http.request<CreatedRoute>({ method: 'POST', path: '/routes', body: params, options });
  }

  async list(params: { cursor?: string } = {}, options?: RequestOptions): Promise<Page<Route>> {
    return this.#http.request<Page<Route>>({ method: 'GET', path: '/routes', query: { cursor: params.cursor }, options });
  }

  listAll(options?: RequestOptions): AsyncIterable<Route> {
    return paginate((cursor) => this.list({ cursor }, options));
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.#http.request<unknown>({ method: 'DELETE', path: path`/routes/${id}`, options });
  }
}
