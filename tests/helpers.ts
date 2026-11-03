import request from 'supertest';
import type { Express } from 'express';
 
export async function login(app: Express, email: string): Promise<string> {
  const res = await request(app).post('/auth/login')
    .send({ email, password: 'Secret123' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.body.accessToken;
}
 
export function makeOrderPayload(overrides: Partial<{ items: unknown }> = {}) {
  return { items: [{ sku: 'SKU-A', price: 500, qty: 1 }], ...overrides };
}

// Створює замовлення з одним товаром для кожної ціни й повертає їхні суми
export async function seedOrders(app: Express, token: string, prices: number[]) {
  const totals: number[] = [];
  for (const price of prices) {
    const res = await request(app).post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(makeOrderPayload({ items: [{ sku: `SKU-${price}`, price, qty: 1 }] }));
    if (res.status !== 201) throw new Error(`seed failed: ${res.status}`);
    totals.push(res.body.total);
  }
  return totals;
}
