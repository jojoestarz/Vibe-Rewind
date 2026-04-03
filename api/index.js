import '../promptlog/load-dotenv.js';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachPromptlogRoutes } from '../promptlog/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const app = express();
attachPromptlogRoutes(app);

app.get('/', (_req, res) => {
  const p = path.join(root, 'viewer.html');
  if (!fs.existsSync(p)) {
    res.status(404).send('viewer.html missing');
    return;
  }
  res.sendFile(p);
});

export default app;
