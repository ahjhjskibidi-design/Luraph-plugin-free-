import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscate } from './obfuscator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.0.0' });
});

app.post('/api/obfuscate', (req, res) => {
  const body = req.body || {};
  const code = body.code;
  const preset = body.preset || 'medium';
  if (typeof code !== 'string' || code.length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing code' });
  }
  try {
    const output = obfuscate(code, preset);
    res.json({ ok: true, output: output, preset: preset });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server on http://0.0.0.0:' + PORT);
});