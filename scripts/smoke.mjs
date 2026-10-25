import * as sdk from '../dist/index.js';
import { run } from './smoke-checks.mjs';

const runtime = globalThis.Deno ? 'deno' : globalThis.Bun ? 'bun' : 'node';
await run(sdk, `${runtime} esm`);
