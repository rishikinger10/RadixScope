import express from 'express';
import cors from 'cors';
import { loadConfig } from './config';
import { router as apiRouter } from './api';

const cfg = loadConfig();

const app = express();

app.use(cors({
  origin: '*', // for local dev
}));
app.use(express.json());

app.use('/api', apiRouter);

// Fallback for SPA or simple health
app.get('/', (req, res) => {
  res.send('RadixScope Server API');
});

app.listen(cfg.port, () => {
  console.log(`[Server] RadixScope API listening on port ${cfg.port}`);
});
