// Load the repository-root .env regardless of the working directory the API was started from.
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });
