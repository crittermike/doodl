/**
 * End-to-end smoke test against a real doodl server.
 *
 * These checks exist because the anti-cheat rules are the easiest thing in the
 * game to break silently: a refactor that broadcasts one extra field, or
 * forgets one authorization check, leaks the word to everyone and nothing else
 * fails. Unit tests can't catch that — it only shows up in the bytes actually
 * put on the wire.
 *
 *   node test/smoke.mjs          spawn a server on a scratch port and test it
 *   node test/smoke.mjs 8099     test an already-running server
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

const givenPort = process.argv[2];
const PORT = givenPort ?? '8123';
const URL = `ws://127.0.0.1:${PORT}/ws`;

let child = null;

async function startServerIfNeeded() {
  if (givenPort) return;

  // The static handler needs somewhere to serve from; a stub is enough.
  const clientDir = resolve(__dirname, '../../client/dist');
  mkdirSync(clientDir, { recursive: true });
  try {
    writeFileSync(resolve(clientDir, 'index.html'), '<!doctype html><title>doodl</title>', { flag: 'wx' });
  } catch {
    // Already present (a real client build) — leave it alone.
  }

  child = spawn(process.execPath, [resolve(__dirname, '../dist/index.js')], {
    env: { ...process.env, PORT, CLIENT_DIR: clientDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error('server did not become healthy');
}

function stopServer() {
  if (child && !child.killed) child.kill('SIGTERM');
}

const failures = [];
const notes = [];
function check(label, cond, extra = '') {
  if (cond) notes.push(`  ok   ${label}`);
  else failures.push(`  FAIL ${label} ${extra}`);
}

class C {
  constructor(name, avatar) {
    this.name = name;
    this.avatar = avatar;
    this.msgs = [];
    this.ws = new WebSocket(URL);
    this.ready = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
    });
  }
  send(o) {
    this.ws.send(JSON.stringify(o));
  }
  find(t) {
    return this.msgs.filter((m) => m.t === t);
  }
  last(t) {
    const a = this.find(t);
    return a[a.length - 1];
  }
  clear() {
    this.msgs = [];
  }
  async wait(t, ms = 3000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const m = this.find(t);
      if (m.length) return m[m.length - 1];
      await sleep(20);
    }
    throw new Error(`${this.name}: timed out waiting for "${t}". Got: ${this.msgs.map((x) => x.t).join(',')}`);
  }
  close() {
    this.ws.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await startServerIfNeeded();

  // --- health ---
  const health = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
  check('/healthz responds ok', health.ok === true, JSON.stringify(health));

  const spa = await fetch(`http://127.0.0.1:${PORT}/r/ABCDE`);
  check('SPA fallback serves index.html', spa.status === 200 && (await spa.text()).includes('<'));

  const traversal = await fetch(`http://127.0.0.1:${PORT}/../../../../etc/passwd`);
  const traversalBody = await traversal.text();
  check('path traversal does not escape the client dir', !traversalBody.includes('root:'));

  // --- create + join ---
  const host = new C('Host', '🐙');
  await host.ready;
  host.send({ t: 'create', name: 'Alice', avatar: '🐙' });
  const joined = await host.wait('joined');
  const code = joined.room.code;
  check('create returns a room code', /^[A-Z0-9]{5}$/.test(code), code);
  check('joined includes a session token', typeof joined.session === 'string' && joined.session.length > 10);
  check('joined includes server clock', typeof joined.now === 'number');
  check('host is host', joined.room.hostId === joined.you);

  const bob = new C('Bob', '🦊');
  await bob.ready;
  bob.send({ t: 'join', name: 'Bob', avatar: '🦊', code });
  const bobJoined = await bob.wait('joined');

  const carol = new C('Carol', '🐸');
  await carol.ready;
  carol.send({ t: 'join', name: 'Carol', avatar: '🐼' });
  const carolErr = await carol.wait('error');
  check('join without a code is rejected', carolErr.code === 'BAD_MESSAGE', JSON.stringify(carolErr));

  const carol2 = new C('Carol', '🐸');
  await carol2.ready;
  carol2.send({ t: 'join', name: 'alice', avatar: '🐸', code });
  const dupe = await carol2.wait('error');
  check('duplicate name is rejected', dupe.code === 'NAME_TAKEN', JSON.stringify(dupe));
  carol2.close();

  const carol3 = new C('Carol', '🐸');
  await carol3.ready;
  carol3.send({ t: 'join', name: 'Carol', avatar: '🐸', code });
  await carol3.wait('joined');

  const ghost = new C('Ghost', '🦁');
  await ghost.ready;
  ghost.send({ t: 'join', name: 'Ghost', avatar: '🦁', code: 'ZZZZZ' });
  const notFound = await ghost.wait('error');
  check('unknown room code is rejected', notFound.code === 'ROOM_NOT_FOUND');
  ghost.close();

  // --- authorization: non-host cannot start or change settings ---
  bob.clear();
  bob.send({ t: 'start' });
  const notHost = await bob.wait('error');
  check('non-host cannot start the game', notHost.code === 'NOT_HOST');

  bob.clear();
  bob.send({ t: 'settings', settings: { rounds: 9 } });
  const notHost2 = await bob.wait('error');
  check('non-host cannot change settings', notHost2.code === 'NOT_HOST');

  // --- validation ---
  host.clear();
  host.send({ t: 'settings', settings: { drawTime: 5 } });
  const badSettings = await host.wait('error');
  check('out-of-range drawTime rejected', badSettings.code === 'BAD_MESSAGE', JSON.stringify(badSettings));

  host.clear();
  host.send({ t: 'settings', settings: { rounds: 1, drawTime: 30, hints: 1 } });
  await sleep(100);
  const room = host.last('room');
  check('valid settings applied', room.room.settings.rounds === 1 && room.room.settings.drawTime === 30);

  host.clear();
  host.ws.send('not json at all');
  const badJson = await host.wait('error');
  check('malformed JSON rejected', badJson.code === 'BAD_MESSAGE');

  host.clear();
  host.send({ t: 'stroke', pts: [[99999, 0]], color: '#000000', width: 4, tool: 'brush', sid: 1 });
  const badPt = await host.wait('error');
  check('out-of-range stroke point rejected', badPt.code === 'BAD_MESSAGE', JSON.stringify(badPt));

  host.clear();
  host.send({ t: 'stroke', pts: [[10, 10]], color: 'red', width: 4, tool: 'brush', sid: 1 });
  const badColor = await host.wait('error');
  check('non-hex colour rejected', badColor.code === 'BAD_MESSAGE');

  // --- start the game ---
  for (const c of [host, bob, carol3]) c.clear();
  host.send({ t: 'start' });

  const chooseHost = await host.wait('choosing');
  const chooseBob = await bob.wait('choosing');
  const drawerId = chooseHost.drawerId;

  const clients = { [joined.you]: host, [bobJoined.you]: bob };
  const drawer = clients[drawerId] ?? host;
  const guesser = drawerId === joined.you ? bob : host;
  const guesser2 = carol3;

  check('drawer receives word choices', Array.isArray(drawer.last('choosing').choices));
  const nonDrawerChoosing = drawerId === joined.you ? chooseBob : chooseHost;
  check(
    'ANTI-CHEAT: non-drawer never receives word choices',
    nonDrawerChoosing.choices === undefined,
    JSON.stringify(nonDrawerChoosing),
  );

  // Non-drawer cannot pick the word.
  guesser.clear();
  guesser.send({ t: 'pick', index: 0 });
  const notDrawerPick = await guesser.wait('error');
  check('non-drawer cannot pick the word', notDrawerPick.code === 'NOT_DRAWER');

  const choices = drawer.last('choosing').choices;
  for (const c of [host, bob, carol3]) c.clear();
  drawer.send({ t: 'pick', index: 1 });

  const tsDrawer = await drawer.wait('turnStart');
  const tsGuesser = await guesser.wait('turnStart');
  const word = choices[1];

  check('drawer receives the word', tsDrawer.word === word, `${tsDrawer.word} vs ${word}`);
  check('ANTI-CHEAT: guesser never receives the word', tsGuesser.word === undefined);
  check('guesser receives word length', tsGuesser.wordLength === word.length);
  check('guesser receives a masked pattern', /^[_\sa-z'.-]+$/i.test(tsGuesser.pattern) && tsGuesser.pattern.includes('_'));
  check(
    'ANTI-CHEAT: masked pattern hides every letter initially',
    !tsGuesser.pattern.replace(/[\s_'.-]/g, '').length,
    tsGuesser.pattern,
  );

  // --- drawing authorization ---
  guesser.clear();
  guesser.send({ t: 'stroke', pts: [[100, 100], [200, 200]], color: '#000000', width: 4, tool: 'brush', sid: 1 });
  const notDrawerDraw = await guesser.wait('error');
  check('ANTI-CHEAT: non-drawer cannot draw', notDrawerDraw.code === 'NOT_DRAWER');

  guesser.clear();
  guesser.send({ t: 'clear' });
  const notDrawerClear = await guesser.wait('error');
  check('ANTI-CHEAT: non-drawer cannot clear', notDrawerClear.code === 'NOT_DRAWER');

  guesser.clear();
  guesser.send({ t: 'undo' });
  const notDrawerUndo = await guesser.wait('error');
  check('ANTI-CHEAT: non-drawer cannot undo', notDrawerUndo.code === 'NOT_DRAWER');

  // --- drawing propagation ---
  for (const c of [host, bob, carol3]) c.clear();
  drawer.send({ t: 'stroke', pts: [[100, 100], [400, 400]], color: '#dc2626', width: 10, tool: 'brush', sid: 7 });
  const gotStroke = await guesser.wait('stroke');
  check('stroke reaches other players', gotStroke.pts.length === 2 && gotStroke.color === '#dc2626');
  await sleep(80);
  check('stroke is NOT echoed to the drawer', drawer.find('stroke').length === 0);

  drawer.send({ t: 'fill', pt: [500, 500], color: '#22c55e' });
  const gotFill = await guesser.wait('fill');
  check('fill reaches other players', gotFill.color === '#22c55e');

  // --- late joiner gets a replay ---
  const late = new C('Late', '🦄');
  await late.ready;
  late.send({ t: 'join', name: 'Dave', avatar: '🦄', code });
  await late.wait('joined');
  const replay = await late.wait('replay');
  check('late joiner receives a canvas replay', replay.ops.length === 2, JSON.stringify(replay.ops.map((o) => o.t)));
  const lateTurn = await late.wait('turnStart');
  check('ANTI-CHEAT: late joiner does not receive the word', lateTurn.word === undefined);

  // --- undo removes the whole gesture ---
  for (const c of [host, bob, carol3, late]) c.clear();
  drawer.send({ t: 'stroke', pts: [[10, 10]], color: '#000000', width: 4, tool: 'brush', sid: 9 });
  drawer.send({ t: 'stroke', pts: [[20, 20]], color: '#000000', width: 4, tool: 'brush', sid: 9 });
  await sleep(120);
  drawer.send({ t: 'undo' });
  await drawer.wait('undo');
  check('undo is echoed to the drawer too', drawer.find('undo').length === 1);

  const late2 = new C('Late2', '🐝');
  await late2.ready;
  late2.send({ t: 'join', name: 'Erin', avatar: '🐝', code });
  await late2.wait('joined');
  const replay2 = await late2.wait('replay');
  check(
    'undo removed both segments of one gesture',
    replay2.ops.length === 2,
    `ops=${replay2.ops.length}`,
  );

  // --- wrong guess is echoed as chat ---
  for (const c of [host, bob, carol3, late, late2]) c.clear();
  guesser.send({ t: 'chat', text: 'definitelynotit' });
  const wrongChat = await drawer.wait('chat');
  check('wrong guess is echoed to chat', wrongChat.text === 'definitelynotit' && wrongChat.channel === 'all');

  // --- close guess ---
  const closeGuess = word.length >= 4 ? word.slice(0, -1) + (word.endsWith('z') ? 'y' : 'z') : null;
  if (closeGuess) {
    guesser.clear();
    guesser.send({ t: 'chat', text: closeGuess });
    try {
      await guesser.wait('close', 1200);
      check('one-edit guess gets a private "close" nudge', true);
      await sleep(80);
      check('"close" nudge is private', drawer.find('close').length === 0);
    } catch {
      check('one-edit guess gets a private "close" nudge', false, `word=${word} guess=${closeGuess}`);
    }
  }

  // --- correct guess ---
  for (const c of [host, bob, carol3, late, late2]) c.clear();
  guesser.send({ t: 'chat', text: `  ${word.toUpperCase()}!  ` });
  const guessedMsg = await drawer.wait('guessed');
  check('correct guess is recognised despite case/punctuation/whitespace', guessedMsg.place === 1);

  await sleep(150);
  const leaked = [host, bob, carol3, late, late2].flatMap((c) =>
    c.find('chat').filter((m) => m.text.toLowerCase().includes(word.toLowerCase())),
  );
  check('ANTI-CHEAT: correct guess is NEVER echoed to chat', leaked.length === 0, JSON.stringify(leaked));

  const sys = drawer.find('system').filter((m) => m.kind === 'correct');
  check('correct guess produces a system message instead', sys.length === 1 && !sys[0].text.toLowerCase().includes(word.toLowerCase()), JSON.stringify(sys));

  const roomAfter = drawer.last('room');
  const guesserPub = roomAfter.room.players.find((p) => p.id === (drawerId === joined.you ? bobJoined.you : joined.you));
  check('correct guesser earns points', guesserPub.score > 0, JSON.stringify(guesserPub));
  check('correct guesser is flagged hasGuessed', guesserPub.hasGuessed === true);

  // --- correct-guesser private channel ---
  for (const c of [host, bob, carol3, late, late2]) c.clear();
  guesser.send({ t: 'chat', text: 'i got it, it was easy' });
  await sleep(200);
  check('correct guesser chat goes to the private channel', drawer.find('chat').some((m) => m.channel === 'correct'));
  check(
    'ANTI-CHEAT: still-guessing players do NOT see the private channel',
    guesser2.find('chat').length === 0,
    JSON.stringify(guesser2.find('chat')),
  );

  for (const c of [host, bob, carol3, late, late2]) c.clear();
  drawer.send({ t: 'chat', text: 'so close everyone' });
  await sleep(200);
  check(
    'ANTI-CHEAT: drawer chat does not reach still-guessing players',
    guesser2.find('chat').length === 0,
    JSON.stringify(guesser2.find('chat')),
  );
  check('drawer chat reaches correct guessers', guesser.find('chat').some((m) => m.channel === 'correct'));

  // --- everyone guesses -> turn ends and the word is revealed ---
  for (const c of [host, bob, carol3, late, late2]) c.clear();
  for (const c of [guesser2, late, late2]) c.send({ t: 'chat', text: word });
  const turnEnd = await drawer.wait('turnEnd', 5000);
  check('turn ends when everyone has guessed', true);
  check('word is revealed at turn end', turnEnd.word === word);
  check('turn end includes score deltas', Array.isArray(turnEnd.deltas) && turnEnd.deltas.length >= 4);
  const drawerDelta = turnEnd.deltas.find((d) => d.playerId === drawerId);
  check('drawer earns points when everyone guessed', drawerDelta.delta > 0, JSON.stringify(drawerDelta));

  // --- rate limiting ---
  for (const c of [host, bob]) c.clear();
  for (let i = 0; i < 30; i++) guesser.send({ t: 'chat', text: `spam ${i}` });
  const limited = await guesser.wait('error', 2000);
  check('chat flooding is rate limited', limited.code === 'RATE_LIMITED');

  // --- reconnect ---
  const sess = bobJoined.session;
  bob.close();
  await sleep(200);
  const bobBack = new C('BobBack', '🦊');
  await bobBack.ready;
  bobBack.send({ t: 'join', name: 'Bob', avatar: '🦊', code, session: sess });
  const rejoined = await bobBack.wait('joined');
  check('reconnect with a session token restores the seat', rejoined.you === bobJoined.you);
  const bobPub = rejoined.room.players.find((p) => p.id === bobJoined.you);
  check('reconnected player keeps their score', bobPub && bobPub.connected === true, JSON.stringify(bobPub));

  for (const c of [host, bobBack, carol3, late, late2]) c.close();
  await sleep(200);

  // --- a complete two-player game, played to the podium ---
  // Separate room so the turn count stays small and the run stays quick.
  const p1 = new C('P1', '🐙');
  await p1.ready;
  p1.send({ t: 'create', name: 'Ann', avatar: '🐙' });
  const j1 = await p1.wait('joined');
  const code2 = j1.room.code;

  const p2 = new C('P2', '🦊');
  await p2.ready;
  p2.send({ t: 'join', name: 'Ben', avatar: '🦊', code: code2 });
  const j2 = await p2.wait('joined');

  const byId = { [j1.you]: p1, [j2.you]: p2 };

  p1.send({ t: 'settings', settings: { rounds: 1, drawTime: 30, hints: 0 } });
  await sleep(100);
  p1.send({ t: 'start' });

  let turnsPlayed = 0;
  let sawNobodyGuessedTurn = false;

  // 1 round x 2 players = 2 turns. Each is ended early by guessing.
  for (let turn = 0; turn < 2; turn++) {
    p1.clear();
    p2.clear();
    const choosing = await p1.wait('choosing', 10_000);
    const dc = byId[choosing.drawerId];
    const gc = choosing.drawerId === j1.you ? p2 : p1;

    const offered = (await dc.wait('choosing')).choices;
    dc.send({ t: 'pick', index: 0 });
    const ts = await dc.wait('turnStart', 5000);
    const secret = ts.word;
    check(`turn ${turn + 1}: drawer got the word`, typeof secret === 'string' && secret === offered[0]);

    if (turn === 0) {
      gc.send({ t: 'chat', text: secret });
      const te = await dc.wait('turnEnd', 10_000);
      const dd = te.deltas.find((d) => d.playerId === choosing.drawerId);
      check('drawer scores when the room guesses', dd.delta > 0, JSON.stringify(dd));
    } else {
      // Nobody guesses: let the clock run out, and verify the drawer gets zero.
      const te = await dc.wait('turnEnd', 45_000);
      const dd = te.deltas.find((d) => d.playerId === choosing.drawerId);
      check('drawer scores zero when nobody guesses', dd.delta === 0, JSON.stringify(dd));
      check('word is revealed even when nobody guessed', te.word === secret);
      sawNobodyGuessedTurn = true;
    }
    turnsPlayed++;
  }

  check('every player drew once in the round', turnsPlayed === 2);
  check('exercised the nobody-guessed path', sawNobodyGuessedTurn);

  const gameEnd = await p1.wait('gameEnd', 20_000);
  check('game ends after the configured rounds', Array.isArray(gameEnd.standings));
  check('standings cover every player', gameEnd.standings.length === 2);
  check('standings are ranked from 1', gameEnd.standings[0].rank === 1);
  check(
    'standings are sorted high to low',
    gameEnd.standings.every((s, i, a) => i === 0 || a[i - 1].score >= s.score),
  );

  // --- back to lobby ---
  const hostClient = j1.room.hostId === j1.you ? p1 : p2;
  hostClient.clear();
  hostClient.send({ t: 'playAgain' });
  await sleep(400);
  const lobby = hostClient.last('room');
  check('play again returns the room to the lobby', lobby.room.phase === 'lobby', lobby.room.phase);
  check('scores reset for the next game', lobby.room.players.every((p) => p.score === 0));

  p1.close();
  p2.close();
  await sleep(200);

  // --- host promotion --------------------------------------------------------
  const h1 = new C('H1', '🐙');
  await h1.ready;
  h1.send({ t: 'create', name: 'Hana', avatar: '🐙' });
  const hj1 = await h1.wait('joined');
  const code3 = hj1.room.code;
  check('the creator starts as host', hj1.room.hostId === hj1.you);

  const h2 = new C('H2', '🦊');
  await h2.ready;
  h2.send({ t: 'join', name: 'Ida', avatar: '🦊', code: code3 });
  const hj2 = await h2.wait('joined');

  const h3 = new C('H3', '🐸');
  await h3.ready;
  h3.send({ t: 'join', name: 'Jo', avatar: '🐸', code: code3 });
  await h3.wait('joined');

  h2.clear();
  h1.close();
  await sleep(400);
  const promoted = h2.last('room');
  check(
    'a new host is promoted when the host leaves',
    promoted.room.hostId !== hj1.you && promoted.room.hostId.length > 0,
    promoted.room.hostId,
  );

  const newHostIsPresent = promoted.room.players.some(
    (p) => p.id === promoted.room.hostId && p.connected,
  );
  check('the promoted host is a connected player', newHostIsPresent);

  // --- room capacity ---------------------------------------------------------
  const hostClient2 = promoted.room.hostId === hj2.you ? h2 : h3;
  hostClient2.send({ t: 'settings', settings: { maxPlayers: 2 } });
  await sleep(200);

  const overflow = new C('Overflow', '🦁');
  await overflow.ready;
  overflow.send({ t: 'join', name: 'Kit', avatar: '🦁', code: code3 });
  const full = await overflow.wait('error');
  check('joining a full room is rejected', full.code === 'ROOM_FULL', JSON.stringify(full));
  overflow.close();

  h2.close();
  h3.close();
  await sleep(200);

  // --- drawer leaving mid-turn ----------------------------------------------
  const d1 = new C('D1', '🐙');
  await d1.ready;
  d1.send({ t: 'create', name: 'Lena', avatar: '🐙' });
  const dj1 = await d1.wait('joined');
  const code4 = dj1.room.code;

  const d2 = new C('D2', '🦊');
  await d2.ready;
  d2.send({ t: 'join', name: 'Milo', avatar: '🦊', code: code4 });
  const dj2 = await d2.wait('joined');

  const d3 = new C('D3', '🐸');
  await d3.ready;
  d3.send({ t: 'join', name: 'Nia', avatar: '🐸', code: code4 });
  const dj3 = await d3.wait('joined');

  const dById = { [dj1.you]: d1, [dj2.you]: d2, [dj3.you]: d3 };

  d1.send({ t: 'settings', settings: { rounds: 1, drawTime: 120, hints: 0 } });
  await sleep(150);
  d1.send({ t: 'start' });

  const dChoose = await d1.wait('choosing', 10_000);
  const leaver = dById[dChoose.drawerId];
  const watchers = [d1, d2, d3].filter((c) => c !== leaver);

  await leaver.wait('choosing');
  leaver.send({ t: 'pick', index: 0 });
  await watchers[0].wait('turnStart', 5000);

  for (const w of watchers) w.clear();
  leaver.close();

  // With a 120s draw time, only the disconnect handler can end this quickly.
  const ended = await watchers[0].wait('turnEnd', 8000);
  check('the turn ends when the drawer leaves', true);
  check('the word is still revealed when the drawer leaves', typeof ended.word === 'string');

  const advanced = await watchers[0].wait('choosing', 15_000);
  check('play advances to the next drawer', advanced.drawerId !== dChoose.drawerId, advanced.drawerId);

  for (const c of watchers) c.close();
  await sleep(200);
}

main()
  .then(() => {
    stopServer();
    console.log(notes.join('\n'));
    console.log('');
    if (failures.length) {
      console.log(failures.join('\n'));
      console.log(`\n${failures.length} FAILED, ${notes.length} passed`);
      process.exit(1);
    }
    console.log(`ALL ${notes.length} CHECKS PASSED`);
    process.exit(0);
  })
  .catch((err) => {
    stopServer();
    console.log(notes.join('\n'));
    if (failures.length) console.log(failures.join('\n'));
    console.error('\nHARNESS ERROR:', err);
    process.exit(1);
  });
