import express from 'express';
import { loadConfig } from './config';
import { router } from './routes';

const config = loadConfig();
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.header('x-api-key') !== config.apiKey) {
    res.status(401).json({ error: 'invalid_api_key' });
    return;
  }
  next();
});
app.use(router);

app.listen(config.port, () => {
  console.log(`payments-api listening on ${config.port}`);
});
