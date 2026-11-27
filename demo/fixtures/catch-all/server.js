import express from 'express';

const app = express();
app.get('/v2/refunds/:id', (request, response) => response.json({ id: request.params.id }));
app.get('*', (_request, response) => response.send('Frontend shell'));
