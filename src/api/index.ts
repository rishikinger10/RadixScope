import express from 'express';
import { startRun, RunInProgressError } from '../benchmark/runner';
import { getRunProjection, listRunSummaries, ping as redisPing } from '../store';
import { health as sglangHealth } from '../sglang';

export const router = express.Router();

router.post('/benchmark', async (req, res) => {
  const normalizeSecondRun = req.body.normalizeSecondRun ?? true;

  try {
    const runId = await startRun(normalizeSecondRun);
    res.status(202).json({ runId });
  } catch (err) {
    if (err instanceof RunInProgressError) {
      res.status(409).json({ error: 'A benchmark run is already in progress' });
    } else {
      console.error('[API] POST /benchmark error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.get('/benchmark/:runId', async (req, res) => {
  try {
    const projection = await getRunProjection(req.params.runId);
    if (!projection) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(projection);
  } catch (err) {
    console.error('[API] GET /benchmark/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const summaries = await listRunSummaries(20);
    res.json({ runs: summaries });
  } catch (err) {
    console.error('[API] GET /runs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/health', async (req, res) => {
  try {
    const sglangOk = await sglangHealth();
    const redisOk = await redisPing();
    
    if (sglangOk && redisOk) {
      res.json({ status: 'ok', sglang: true, redis: true });
    } else {
      res.status(503).json({ 
        status: 'degraded', 
        sglang: sglangOk, 
        redis: redisOk 
      });
    }
  } catch (err) {
    res.status(500).json({ status: 'error' });
  }
});
