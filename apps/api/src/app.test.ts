import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('GET /health', () => {
  const app = createApp();

  it('responds 200 with the service health payload', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'planning-poker-api',
    });
    expect(typeof response.body.uptime).toBe('number');
    expect(response.body.uptime).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown route', async () => {
    const response = await request(app).get('/health/not-a-route');

    expect(response.status).toBe(404);
  });
});
