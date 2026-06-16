'use strict';

// One-command live smoke test for the Tavus avatar.
//
//   node scripts/tavus-test.js
//
// Reads TAVUS_API_KEY (and optional TAVUS_REPLICA_ID / TAVUS_PERSONA_ID) from
// the environment. Lists your replicas, creates a real conversation, and prints
// the join URL — open it in a browser to see the photoreal avatar that watches
// you. Requires the environment to allow egress to tavusapi.com.

require('dotenv').config();
const axios = require('axios');

const KEY = process.env.TAVUS_API_KEY;
const REPLICA = process.env.TAVUS_REPLICA_ID || '';
const PERSONA = process.env.TAVUS_PERSONA_ID || '';

if (!KEY) {
  console.error('✗ TAVUS_API_KEY is not set. Add it to backend/.env or as a cloud environment variable.');
  process.exit(1);
}

const http = axios.create({
  baseURL: 'https://tavusapi.com',
  headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' },
  timeout: 30000,
  validateStatus: () => true,
});

async function main() {
  // 1) Verify the key + find a replica
  console.log('→ Listing replicas…');
  const rl = await http.get('/v2/replicas?limit=50');
  if (rl.status === 403) { console.error('✗ Blocked: add tavusapi.com to the environment egress allowlist (needs a new session).'); process.exit(2); }
  if (rl.status >= 300) { console.error('✗ Tavus error', rl.status, JSON.stringify(rl.data)); process.exit(2); }

  const replicas = (rl.data && (rl.data.data || rl.data.replicas)) || [];
  console.log(`  found ${replicas.length} replica(s):`);
  replicas.slice(0, 20).forEach(r => console.log(`   • ${r.replica_id}  ${r.replica_name || ''}  [${r.status || '?'}]`));

  let replicaId = REPLICA;
  if (!replicaId) {
    const ready = replicas.find(r => (r.status || '').toLowerCase() === 'ready') || replicas[0];
    if (!ready) { console.error('✗ No replicas on this account. Create one in the Tavus dashboard, or set TAVUS_REPLICA_ID.'); process.exit(3); }
    replicaId = ready.replica_id;
    console.log(`→ Using replica ${replicaId} (no TAVUS_REPLICA_ID set — picked an available one).`);
  } else {
    console.log(`→ Using TAVUS_REPLICA_ID=${replicaId}`);
  }

  // 2) Create a conversation
  console.log('→ Creating a conversation…');
  const body = {
    replica_id: replicaId,
    conversation_name: 'LAD CLPD — live test',
    properties: { enable_closed_captions: true, max_call_duration: 1800 },
  };
  if (PERSONA) body.persona_id = PERSONA;

  const cv = await http.post('/v2/conversations', body);
  if (cv.status >= 300) { console.error('✗ Conversation failed', cv.status, JSON.stringify(cv.data)); process.exit(4); }

  console.log('\n✅ Live conversation created.');
  console.log('   conversation_id :', cv.data.conversation_id);
  console.log('   replica_id      :', replicaId);
  console.log('\n🔗 OPEN THIS URL IN A BROWSER:\n   ' + cv.data.conversation_url + '\n');
  console.log('   (or paste it into frontend/trainer-test.html → Live avatar tab)');
}

main().catch(e => { console.error('✗ Unexpected error:', e.message); process.exit(1); });
