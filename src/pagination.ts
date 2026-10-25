import type { Page } from './types';

/** Yields every item across pages, following `next_cursor`. */
export async function* paginate<T>(fetchPage: (cursor: string | undefined) => Promise<Page<T>>): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    yield* page.data;
    const next = page.next_cursor;
    // A repeated cursor would loop forever: treat it as the end.
    if (!next || next === cursor) return;
    cursor = next;
  }
}
