import request from 'supertest';
import { createApp } from '../../src/app';

describe('app basics', () => {
  it('responds to health check with a JSON status field', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health');

    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty('status');
  });

  it('rejects registration when required fields are missing', async () => {
    const app = createApp();
    const response = await request(app).post('/api/v1/auth/register').send({});

    expect(response.status).toBe(400);
  });

  it('rejects login when required fields are missing', async () => {
    const app = createApp();
    const response = await request(app).post('/api/v1/auth/login').send({});

    expect(response.status).toBe(400);
  });
});
