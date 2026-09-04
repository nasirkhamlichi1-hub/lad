// CLPD credits ledger. Lawyers/firms hold a credit balance used to book/attend
// courses. Admins top up; users spend; users can buy (Stripe Checkout when a
// STRIPE_SECRET_KEY is configured, otherwise a purchase request an admin confirms).
//   GET  ?token=                     -> my balance + recent ledger
//   GET  ?scope=all&token/pass       -> (admin) all balances
//   GET  ?scope=requests&token/pass  -> (admin) pending purchase requests
//   POST { action:'topup', email, amount, note, token }   (admin)
//   POST { action:'spend', amount, reason, token }        (self)
//   POST { action:'buy',   amount, token }                (self)
//   POST { action:'confirm', id, token }                  (admin -> credit a request)
const S = require('../_shared');
const P = 'credits', L = 'credledger', RQ = 'credreq';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PRICE = Number(process.env.CREDIT_PRICE_AED || 50); // AED per credit

async function balance(c, email) { try { const e = await c.getEntity(P, email); return Number(e.balance) || 0; } catch (_) { return 0; } }
async function setBalance(c, email, bal) { await c.upsertEntity({ partitionKey: P, rowKey: email, email, balance: bal, updatedAt: new Date().toISOString() }, 'Replace'); }
async function ledger(c, email, delta, type, note, by) { try { await c.createEntity({ partitionKey: L, rowKey: email + '::' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), email, delta, type, note: String(note || '').slice(0, 200), by: by || '', at: new Date().toISOString() }); } catch (_) {} }

module.exports = async function (context, req) {
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  const m = req.method, q = req.query || {}, b = req.body || {};

  if (m === 'GET') {
    if (q.scope === 'all') {
      if (!S.adminOk(req)) return S.json(context, 401, { error: 'admin only' });
      const out = []; try { const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P}'` } });
        for await (const e of ents) out.push({ email: e.email || e.rowKey, balance: Number(e.balance) || 0 }); } catch (_) {}
      return S.json(context, 200, { accounts: out, pricePerCredit: PRICE });
    }
    if (q.scope === 'requests') {
      if (!S.adminOk(req)) return S.json(context, 401, { error: 'admin only' });
      const out = []; try { const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${RQ}'` } });
        for await (const e of ents) { if (e.status === 'pending') out.push({ id: e.rowKey, email: e.email, amount: e.amount, at: e.at }); } } catch (_) {}
      out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      return S.json(context, 200, { requests: out, pricePerCredit: PRICE });
    }
    const email = S.verify(q.token || ''); if (!email) return S.json(context, 401, { error: 'Please sign in.' });
    const bal = await balance(c, email);
    const tx = []; try { const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${L}'` } });
      for await (const e of ents) { if (String(e.email || '').toLowerCase() === email) tx.push({ delta: e.delta, type: e.type, note: e.note, at: e.at }); } } catch (_) {}
    tx.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return S.json(context, 200, { balance: bal, ledger: tx.slice(0, 50), pricePerCredit: PRICE });
  }

  const email = S.verify(b.token || '');

  if (b.action === 'topup') {
    if (!S.adminOk(req) && !(email && S.isSuper(email))) return S.json(context, 401, { error: 'admin only' });
    const target = String(b.email || '').trim().toLowerCase(); const amt = Math.round(Number(b.amount) || 0);
    if (!EMAIL_RE.test(target) || !amt) return S.json(context, 400, { error: 'A valid email and amount are required.' });
    const bal = await balance(c, target) + amt; await setBalance(c, target, bal); await ledger(c, target, amt, 'topup', b.note || 'Administrator credit', email || 'admin');
    return S.json(context, 200, { ok: true, email: target, balance: bal });
  }
  if (b.action === 'confirm') {
    if (!S.adminOk(req) && !(email && S.isSuper(email))) return S.json(context, 401, { error: 'admin only' });
    const id = String(b.id || ''); if (!id) return S.json(context, 400, { error: 'id required' });
    let e; try { e = await c.getEntity(RQ, id); } catch (_) { return S.json(context, 404, { error: 'Request not found.' }); }
    if (e.status !== 'pending') return S.json(context, 400, { error: 'Already handled.' });
    const bal = await balance(c, e.email) + (Number(e.amount) || 0); await setBalance(c, e.email, bal); await ledger(c, e.email, Number(e.amount) || 0, 'purchase', 'Purchase confirmed', email || 'admin');
    e.status = 'confirmed'; e.confirmedAt = new Date().toISOString(); try { await c.upsertEntity(e, 'Merge'); } catch (_) {}
    return S.json(context, 200, { ok: true, email: e.email, balance: bal });
  }

  if (!email) return S.json(context, 401, { error: 'Please sign in.' });

  if (b.action === 'spend') {
    const amt = Math.round(Number(b.amount) || 0); if (amt <= 0) return S.json(context, 400, { error: 'amount required' });
    const bal = await balance(c, email); if (bal < amt) return S.json(context, 400, { error: 'Insufficient credits.' });
    const nb = bal - amt; await setBalance(c, email, nb); await ledger(c, email, -amt, 'spend', b.reason || 'Spent', email);
    return S.json(context, 200, { ok: true, balance: nb });
  }

  if (b.action === 'buy') {
    const amt = Math.round(Number(b.amount) || 0); if (amt <= 0) return S.json(context, 400, { error: 'amount required' });
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    if (stripeKey) {
      const origin = (req.headers && (req.headers.origin || ('https://' + (req.headers.host || '')))) || '';
      const p = new URLSearchParams();
      p.append('mode', 'payment');
      p.append('success_url', origin + '/credits?status=success');
      p.append('cancel_url', origin + '/credits?status=cancel');
      p.append('client_reference_id', email);
      p.append('metadata[email]', email); p.append('metadata[credits]', String(amt));
      p.append('line_items[0][quantity]', '1');
      p.append('line_items[0][price_data][currency]', 'aed');
      p.append('line_items[0][price_data][unit_amount]', String(Math.round(PRICE * amt * 100)));
      p.append('line_items[0][price_data][product_data][name]', amt + ' CLPD credits');
      try {
        const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: 'Bearer ' + stripeKey, 'content-type': 'application/x-www-form-urlencoded' }, body: p.toString() });
        const d = await r.json(); if (r.ok && d.url) return S.json(context, 200, { ok: true, checkoutUrl: d.url });
        context.log.error('stripe', JSON.stringify(d).slice(0, 200)); return S.json(context, 502, { error: 'Payment could not be started.' });
      } catch (e) { context.log.error('stripe', e && e.message); return S.json(context, 502, { error: 'Payment is unavailable right now.' }); }
    }
    try { await c.createEntity({ partitionKey: RQ, rowKey: email + '::' + Date.now().toString(36), email, amount: amt, status: 'pending', at: new Date().toISOString() }); } catch (_) {}
    return S.json(context, 200, { ok: true, requested: true, message: 'Purchase request received — an administrator will confirm your credits shortly.' });
  }

  return S.json(context, 400, { error: 'bad request' });
};
