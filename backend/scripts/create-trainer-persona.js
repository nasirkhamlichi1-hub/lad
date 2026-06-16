'use strict';

// Creates (or previews) the Tavus persona for the AI Trainer.
//
//   node scripts/create-trainer-persona.js          # create the persona
//   node scripts/create-trainer-persona.js --dry    # print the payload only
//
// Requires TAVUS_API_KEY and TAVUS_REPLICA_ID in the environment. On success
// it prints the persona_id — copy that into TAVUS_PERSONA_ID and redeploy.
//
// Run this once when you set up the trainer, and again whenever you change the
// persona's behaviour, voice (ElevenLabs), or perception queries in
// src/services/tavus.js.

require('dotenv').config();
const config = require('../src/config');
const tavus = require('../src/services/tavus');

async function main() {
  const dry = process.argv.includes('--dry');
  const payload = tavus.buildPersonaPayload();

  if (dry) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!config.tavus.apiKey || !config.tavus.replicaId) {
    console.error('[persona] TAVUS_API_KEY and TAVUS_REPLICA_ID are required. Set them in backend/.env first.');
    process.exit(1);
  }

  console.log('[persona] creating "LAD CLPD Expert Trainer"…');
  console.log('[persona]   perception model :', payload.layers.perception.perception_model);
  console.log('[persona]   voice            :', payload.layers.tts ? `ElevenLabs (${config.elevenlabs.voiceId})` : 'Tavus default');
  console.log('[persona]   replica          :', config.tavus.replicaId);

  try {
    const result = await tavus.createPersona();
    console.log('\n✅ Persona created.');
    console.log('   persona_id =', result.persona_id || result.id || JSON.stringify(result));
    console.log('\nNext: set this in backend/.env and redeploy:');
    console.log(`   TAVUS_PERSONA_ID=${result.persona_id || result.id}`);
  } catch (e) {
    console.error('\n❌ Persona creation failed:', e.message);
    if (e.detail) console.error(JSON.stringify(e.detail, null, 2));
    process.exit(1);
  }
}

main();
