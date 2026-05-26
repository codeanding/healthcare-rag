import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load the repo-root .env for local dev and CLI runs.
// In Docker the env comes from compose; missing .env is fine (override: false).
config({ path: resolve(__dirname, '..', '..', '..', '.env'), override: false });
