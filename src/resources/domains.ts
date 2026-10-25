import { path, type HttpClient, type PostOptions, type RequestOptions } from '../http';
import { paginate } from '../pagination';
import type { CreateDomainParams, Domain, Page } from '../types';

export class Domains {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Adds a domain and returns the two CNAME records to publish. */
  async create(params: CreateDomainParams, options?: PostOptions): Promise<Domain> {
    return this.#http.request<Domain>({ method: 'POST', path: '/domains', body: params, options });
  }

  /** The current verification status of the domain and each record. */
  async get(id: string, options?: RequestOptions): Promise<Domain> {
    return this.#http.request<Domain>({ method: 'GET', path: path`/domains/${id}`, options });
  }

  async list(params: { cursor?: string } = {}, options?: RequestOptions): Promise<Page<Domain>> {
    return this.#http.request<Page<Domain>>({ method: 'GET', path: '/domains', query: { cursor: params.cursor }, options });
  }

  listAll(options?: RequestOptions): AsyncIterable<Domain> {
    return paginate((cursor) => this.list({ cursor }, options));
  }

  /** Removes a domain; sending from it stops immediately. */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.#http.request<unknown>({ method: 'DELETE', path: path`/domains/${id}`, options });
  }
}
