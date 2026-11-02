import WebSocket from 'ws';
import { createTicket } from '../src/lib/ticket.js';

const API_BASE = 'http://localhost:8787';
const WS_BASE = 'ws://localhost:8787';

async function req(user, method, path, body = null) {
  const headers = { 'X-Dev-User': user };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch (e) {
    return { status: res.status, text };
  }
}

async function waitForServer() {
  process.stdout.write('Waiting for wrangler dev on ' + API_BASE + '...');
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        console.log(' Connected!');
        return;
      }
    } catch (e) {}
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Server did not start in time.');
}

function connectWs(ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/realtime?ticket=${ticket}`);
    const events = [];
    ws.on('open', () => resolve({ ws, events }));
    ws.on('message', (data) => {
      console.log('[WS Message received]:', data.toString());
      try {
        events.push(JSON.parse(data.toString()));
      } catch (e) {
        events.push(data.toString());
      }
    });
    ws.on('error', (err) => reject(err));
  });
}

async function run() {
  console.log('\n============================================================');
  console.log('REALTIME DELIVERY & WEBSOCKET ISOLATION TEST (wrangler dev)');
  console.log('============================================================\n');

  await waitForServer();

  // 1. Setup users
  const aliceMe = (await req('alice', 'GET', '/me')).json;
  const bobMe = (await req('bob', 'GET', '/me')).json;
  const charlieMe = (await req('charlie', 'GET', '/me')).json;

  console.log(`[Setup] Alice ID: ${aliceMe.id}`);
  console.log(`[Setup] Bob ID:   ${bobMe.id}`);
  console.log(`[Setup] Charlie ID: ${charlieMe.id}\n`);

  // -------------------------------------------------------------------------
  // TEST 1: Expired ticket rejected
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Expired ticket rejected ---');
  // Create an expired ticket (expiresIn = -10 seconds)
  const expiredTicket = await createTicket('test-realtime-secret-key-32chars-min', aliceMe.id, -10);
  let expiredRejected = false;
  try {
    const res = await fetch(`${API_BASE}/realtime?ticket=${expiredTicket}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    if (res.status === 401) {
      expiredRejected = true;
    }
  } catch (e) {
    expiredRejected = true;
  }
  if (!expiredRejected) {
    // Try ws client
    try {
      await connectWs(expiredTicket);
    } catch (e) {
      expiredRejected = true;
    }
  }
  console.log(`Expired ticket rejected: ${expiredRejected ? 'PASS (HTTP 401 / Connection Refused)' : 'FAIL'}`);
  if (!expiredRejected) throw new Error('Expired ticket was not rejected!');

  // -------------------------------------------------------------------------
  // TEST 2: Realtime delivery from Alice to Bob (< 1s)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Realtime DM delivery (Alice -> Bob) with timing ---');
  const aliceTicket = (await req('alice', 'POST', '/realtime/ticket')).json.ticket;
  const bobTicket = (await req('bob', 'POST', '/realtime/ticket')).json.ticket;

  const aliceClient = await connectWs(aliceTicket);
  const bobClient = await connectWs(bobTicket);
  console.log('Connected WebSocket clients for Alice and Bob.');

  // Create DM conversation between Alice and Bob
  const dmRes = await req('alice', 'POST', '/conversations/dm', { userId: bobMe.id });
  const convId = dmRes.json.id;

  const testMsg = `Hello Bob! Realtime verification test ${Date.now()}`;
  const t0 = performance.now();

  // Alice sends message
  const sendRes = await req('alice', 'POST', `/conversations/${convId}/messages`, {
    kind: 'text',
    text: testMsg,
  });
  if (sendRes.status !== 201) throw new Error(`Failed to send message: ${JSON.stringify(sendRes)}`);

  // Wait for Bob to receive message.new
  let receivedMsg = null;
  let tDelivery = 0;
  for (let i = 0; i < 40; i++) {
    const found = bobClient.events.find(
      (ev) => ev.type === 'message.new' && (ev.message?.text === testMsg || ev.message?.body === testMsg)
    );
    if (found) {
      tDelivery = performance.now() - t0;
      receivedMsg = found;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!receivedMsg) {
    throw new Error('Bob did not receive message.new event within 2 seconds!');
  }

  console.log(`Received event type: "${receivedMsg.type}"`);
  console.log(`Message text:        "${receivedMsg.message?.text || receivedMsg.message?.body}"`);
  console.log(`Delivery latency:    ${tDelivery.toFixed(2)} ms`);
  console.log(`Latency < 1000 ms:   ${tDelivery < 1000 ? 'PASS' : 'FAIL'}`);
  if (tDelivery >= 1000) throw new Error('Latency exceeded 1000 ms threshold!');

  // -------------------------------------------------------------------------
  // TEST 3: Bob's socket does NOT receive messages from other conversations
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Non-member conversation message isolation ---');
  const bobEventCountBefore = bobClient.events.length;
  // Alice creates conversation with Charlie
  const charlieDm = await req('alice', 'POST', '/conversations/dm', { userId: charlieMe.id });
  const charlieConvId = charlieDm.json.id;

  const charlieMsg = `Charlie secret message ${Date.now()}`;
  await req('alice', 'POST', `/conversations/${charlieConvId}/messages`, {
    kind: 'text',
    text: charlieMsg,
  });

  // Wait 1.2 seconds to ensure nothing leaked to Bob
  await new Promise((r) => setTimeout(r, 1200));
  const bobLeaked = bobClient.events
    .slice(bobEventCountBefore)
    .find((ev) => (ev.message?.text === charlieMsg || ev.message?.body === charlieMsg));
  console.log(`Bob received Charlie's message: ${bobLeaked ? 'YES (LEAK FAIL)' : 'NO (ISOLATED PASS)'}`);
  if (bobLeaked) throw new Error('Bob received a message from a conversation he is not in!');

  // -------------------------------------------------------------------------
  // TEST 4: After Bob blocks Alice, no events
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Blocking stops event delivery ---');
  const blockRes = await req('bob', 'POST', `/users/${aliceMe.id}/block`);
  console.log(`Bob blocked Alice (status: ${blockRes.status})`);

  const bobEventCountBeforeBlockMsg = bobClient.events.length;
  const blockedMsg = `Alice trying to message after block ${Date.now()}`;

  const postBlocked = await req('alice', 'POST', `/conversations/${convId}/messages`, {
    kind: 'text',
    text: blockedMsg,
  });
  console.log(`Alice message POST status: ${postBlocked.status} (code: ${postBlocked.json?.code || 'OK'})`);

  // Wait 1 second to confirm Bob's socket received nothing
  await new Promise((r) => setTimeout(r, 1000));
  const bobReceivedBlockedMsg = bobClient.events
    .slice(bobEventCountBeforeBlockMsg)
    .find((ev) => (ev.message?.text === blockedMsg || ev.message?.body === blockedMsg));
  console.log(`Bob received event after block: ${bobReceivedBlockedMsg ? 'YES (FAIL)' : 'NO (BLOCKED PASS)'}`);
  if (bobReceivedBlockedMsg) throw new Error('Bob received an event from a blocked user!');

  // Close websockets
  aliceClient.ws.close();
  bobClient.ws.close();

  console.log('\n============================================================');
  console.log('ALL REALTIME DELIVERY & WEBSOCKET ISOLATION TESTS PASSED!');
  console.log('============================================================\n');
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nTEST FAILED:', e);
    process.exit(1);
  });
