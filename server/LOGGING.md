# Log sanitization

All server logging goes through `src/logger.js`, which redacts secrets before output.

## Rules
- **Sensitive keys** — values of object keys matching `authorization`, `cookie`, `password`, `passphrase`, `secret`, `token`, `api_key`, `private_key`, `seed`, `mnemonic`, `signature` (case-insensitive) are replaced with `[REDACTED]`.
- **Value patterns** — masked anywhere inside strings (including error messages and stacks):
  - Stellar secret seeds (`S` + 55 base32 chars)
  - `Bearer <token>` credentials
  - JWTs (`eyJ...`)
  - PEM private key blocks
- **Headers** — request headers are logged via `sanitizeHeaders`, so `Authorization`, `Cookie`, `X-Admin-Token` etc. never appear.

## Usage
```js
import { logger, withRequestLogging } from './logger.js';
logger.error(err);                       // sanitized
http.createServer(withRequestLogging(app));
```
