import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

for (const filename of ['.env.local', '.env']) {
  const fullPath = path.join(rootDir, filename);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath });
  }
}
