// CommonJS consumers: require() must load dist/index.cjs.
const sdk = require('../dist/index.cjs');

import('./smoke-checks.mjs')
  .then(({ run }) => run(sdk, 'node cjs'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
