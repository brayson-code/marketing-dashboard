// One-shot, idempotent Stripe provisioning for KeyPlayers Command Center.
// Reads STRIPE_SECRET_KEY from .env.local, then ensures:
//   - Product + recurring Price for Lite ($1,997/mo) and Pro ($3,297/mo)
//   - a Payment Link for each plan (cold webinar traffic)
//   - one Webhook Endpoint → prod /api/stripe/webhook (subscription + checkout)
// Safe to re-run: it reuses objects tagged with metadata.kpcc=plan, and recreates
// the webhook endpoint (so the signing secret is always returned).
//
// Run:  node scripts/stripe-setup.mjs
import fs from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
function readEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = readEnvLocal();
const key = env.STRIPE_SECRET_KEY;
if (!key) throw new Error('STRIPE_SECRET_KEY missing from .env.local');
const stripe = new Stripe(key);

const WEBHOOK_URL = 'https://keyplayers-command-center-woad.vercel.app/api/stripe/webhook';
const PLANS = [
  { plan: 'lite', name: 'KeyPlayers Command Center — Lite', amount: 199700 },
  { plan: 'pro', name: 'KeyPlayers Command Center — Pro', amount: 329700 },
];

async function ensureProduct(plan, name) {
  const found = await stripe.products.search({ query: `metadata['kpcc']:'${plan}'`, limit: 1 });
  if (found.data[0]) return found.data[0];
  return stripe.products.create({ name, metadata: { kpcc: plan } });
}

async function ensurePrice(product, amount, plan) {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = prices.data.find(
    (p) => p.unit_amount === amount && p.currency === 'usd' && p.recurring?.interval === 'month',
  );
  if (match) return match;
  return stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { kpcc: plan },
  });
}

async function ensurePaymentLink(price, plan) {
  const links = await stripe.paymentLinks.list({ limit: 100 });
  const existing = links.data.find((l) => l.active && l.metadata?.kpcc === plan);
  if (existing) return existing;
  return stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { kpcc: plan },
    subscription_data: { metadata: { kpcc: plan } },
    allow_promotion_codes: true,
    after_completion: {
      type: 'redirect',
      redirect: { url: 'https://keyplayers-command-center-woad.vercel.app/?purchased=1' },
    },
  });
}

async function ensureWebhook() {
  const eps = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const ep of eps.data) {
    if (ep.url === WEBHOOK_URL) await stripe.webhookEndpoints.del(ep.id);
  }
  return stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    enabled_events: [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ],
  });
}

const result = { prices: {}, paymentLinks: {} };
for (const { plan, name, amount } of PLANS) {
  const product = await ensureProduct(plan, name);
  const price = await ensurePrice(product, amount, plan);
  const link = await ensurePaymentLink(price, plan);
  result.prices[plan] = price.id;
  result.paymentLinks[plan] = link.url;
}
const wh = await ensureWebhook();
result.webhookId = wh.id;
result.webhookSecret = wh.secret;

console.log('RESULT_JSON_START');
console.log(JSON.stringify(result, null, 2));
console.log('RESULT_JSON_END');
