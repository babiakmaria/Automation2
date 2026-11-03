import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { login, seedOrders } from './helpers';
import { expectSchema } from './schema';
import { orderListSchema, errorSchema } from './schemas/order.schema';

async function setup() {
  const app = createApp();
  const token = await login(app, 'bob@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  const totals = await seedOrders(app, token, [100, 500, 1200]);
  return { app, token, auth, totals };
}

const totalsOf = (body: { total: number }[]) => body.map((o) => o.total).sort((a, b) => a - b);

describe('GET /orders?minTotal=&maxTotal= — фільтрація за сумою', () => {
  it('повертає лише замовлення з діапазону: 200, JSON, схема, значення', async () => {
    const { app, auth, totals } = await setup();
    expect(totals).toEqual([160, 560, 1200]);           // передумова: розрахунок сум

    const res = await request(app)
      .get('/orders').query({ minTotal: 200, maxTotal: 1000 }).set(auth);

    expect(res.status).toBe(200);                       // рівень 1
    expectSchema(res.body, orderListSchema);            // рівень 2
    expect(totalsOf(res.body)).toEqual([560]);          // рівень 3
    expect(res.headers['content-type']).toMatch(/application\/json/); // рівень 4
  });

  it.each([
    { name: 'нижня межа включна',        query: { minTotal: '560' },                     expected: [560, 1200] },
    { name: 'трохи вище нижньої межі',   query: { minTotal: '560.01' },                  expected: [1200] },
    { name: 'верхня межа включна',       query: { maxTotal: '560' },                     expected: [160, 560] },
    { name: 'трохи нижче верхньої межі', query: { maxTotal: '559.99' },                  expected: [160] },
    { name: 'вироджений діапазон',       query: { minTotal: '560', maxTotal: '560' },    expected: [560] },
    { name: 'нульова нижня межа',        query: { minTotal: '0' },                       expected: [160, 560, 1200] },
    { name: 'діапазон без збігів',       query: { minTotal: '1200.01' },                 expected: [] },
  ])('межові значення: $name', async ({ query, expected }) => {
    const { app, auth } = await setup();
    const res = await request(app).get('/orders').query(query).set(auth);

    expect(res.status).toBe(200);
    expectSchema(res.body, orderListSchema);
    expect(totalsOf(res.body)).toEqual(expected);
  });

  it.each([
    { name: 'нечислове значення',     qs: 'minTotal=abc',               code: 'INVALID_TOTAL_FILTER' },
    { name: 'від’ємне значення',      qs: 'maxTotal=-1',                code: 'INVALID_TOTAL_FILTER' },
    { name: 'порожнє значення',       qs: 'minTotal=',                  code: 'INVALID_TOTAL_FILTER' },
    { name: 'повторений параметр',    qs: 'minTotal=10&minTotal=20',    code: 'INVALID_TOTAL_FILTER' },
    { name: 'нижня межа більша',      qs: 'minTotal=1000&maxTotal=100', code: 'INVALID_TOTAL_RANGE' },
  ])('відхиляє некоректні параметри: $name → $code', async ({ qs, code }) => {
    const { app, auth } = await setup();
    const res = await request(app).get(`/orders?${qs}`).set(auth);

    expect(res.status).toBe(400);
    expectSchema(res.body, errorSchema);
    expect(res.body.code).toBe(code);
  });

  it('фільтрація не змінює дані, а нове замовлення одразу враховується', async () => {
    const { app, token, auth } = await setup();

    await request(app).get('/orders').query({ minTotal: 200, maxTotal: 1000 }).set(auth);
    const all = await request(app).get('/orders').set(auth);
    expect(all.body).toHaveLength(3);                   // рівень 5: дані не змінено

    await seedOrders(app, token, [300]);                // 300 + 60 = 360
    const res = await request(app)
      .get('/orders').query({ minTotal: 200, maxTotal: 1000 }).set(auth);
    expect(totalsOf(res.body)).toEqual([360, 560]);
  });
});

describe('Доступ до фільтрації замовлень', () => {
  it.each([
    { name: 'без токена',        header: undefined },
    { name: 'підроблений токен', header: 'Bearer invalid-token' },
  ])('GET /orders з фільтром $name → 401', async ({ header }) => {
    const { app } = await setup();
    const req = request(app).get('/orders').query({ minTotal: 0 });
    if (header) req.set('Authorization', header);
    const res = await req;

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('фільтр не повертає чужих замовлень із того самого діапазону', async () => {
    const { app, auth } = await setup();
    const alice = await login(app, 'alice@example.com');
    const foreign = await request(app).post('/orders')
      .set('Authorization', `Bearer ${alice}`)
      .send({ items: [{ sku: 'SKU-A', price: 600, qty: 1 }] }); // gold: 540 + 60 = 600
    expect(foreign.body.total).toBe(600);

    const res = await request(app)
      .get('/orders').query({ minTotal: 500, maxTotal: 700 }).set(auth);

    expect(totalsOf(res.body)).toEqual([560]);
    expect(res.body.map((o: { id: string }) => o.id)).not.toContain(foreign.body.id);
  });
});
