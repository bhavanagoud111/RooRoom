// Seeds the demo course (COMP-SCI 5520) through the real API, so every pipeline runs for real:
// ingestion, syllabus extraction, translation, redaction, clustering, digests, moderation.
//
//   node scripts/seed-demo.mjs            (stack must be running; uses http://localhost:3300)
//
// The story it sets up for the stage demo:
//   - Syllabus, Module 4, Project Part 3 (assignment) and Quiz 4 (graded) uploaded by Dr. Okafor.
//     Syllabus deadlines appear as suggestions on every student's calendar.
//   - A HW3 deadline digest that the professor has already answered (extended to Monday), so the
//     Study AI now says Monday even though the syllabus says Friday: it cannot contradict her.
//   - A Part 3 "unit tests?" digest from 4 students in 4 languages, left open to answer on stage.
//   - One lone question below the threshold, which the professor never sees.
//   - Two fair anonymous notes delivered to the professor.
//   - Study activity and calendar blocks so the buddy list shows who studies what, and when.
//   - A Spanish chat message from Diego to Priya, to translate on tap.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.ROOROOM_URL ?? 'http://localhost:3300';
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo');
const PW = 'rooroom-demo';

const sessions = {};
async function login(who) {
  if (sessions[who]) return sessions[who];
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: `${who}@umkc.edu`, password: PW }),
  });
  if (!r.ok) throw new Error(`login ${who}: ${r.status} ${await r.text()}`);
  sessions[who] = r.headers.get('set-cookie').split(';')[0];
  return sessions[who];
}

async function call(who, method, url, body) {
  const cookie = await login(who);
  const isForm = body instanceof FormData;
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { cookie, origin: BASE, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${who} ${method} ${url}: ${r.status} ${typeof data === 'string' ? data.slice(0, 200) : data.error}`);
  return data;
}

const step = (s) => console.log(`\n▸ ${s}`);
const ok = (s) => console.log(`  ✓ ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const courses = await call('okafor', 'GET', '/api/courses?q=COMP-SCI%205520&offered=0');
  const course = courses.courses.find((c) => c.code === 'COMP-SCI 5520');
  const C = course.rooms.find((r) => r.source === 'demo').id;  // Dr. Okafor's demo room
  console.log(`Course ${course.code} ${C}`);

  step('Professor uploads course materials');
  const existing = (await call('okafor', 'GET', `/api/courses/${C}/documents`)).documents;
  const uploads = [
    ['syllabus.pdf', 'COMP-SCI 5520 Syllabus, Fall 2026', 'syllabus', ''],
    ['module4_transport.pdf', 'Module 4: The Transport Layer', 'module', 'Module 4'],
    ['project_part3.pdf', 'Networks Project Part 3', 'assignment', 'Module 4'],
    ['quiz4.pdf', 'Quiz 4: TCP Congestion Control', 'quiz', 'Module 4'],
  ];
  for (const [file, title, kind, mod] of uploads) {
    if (existing.some((d) => d.title === title)) { ok(`${title} (already there)`); continue; }
    const fd = new FormData();
    fd.set('file', new Blob([readFileSync(path.join(DIR, file))], { type: 'application/pdf' }), file);
    fd.set('title', title); fd.set('kind', kind); fd.set('module', mod); fd.set('visibility', 'class');
    await call('okafor', 'POST', `/api/courses/${C}/documents`, fd);
    ok(`uploaded ${title}`);
  }
  for (let i = 0; i < 90; i++) {
    const docs = (await call('okafor', 'GET', `/api/courses/${C}/documents`)).documents;
    if (docs.every((d) => !['pending', 'processing'].includes(d.status))) {
      docs.forEach((d) => ok(`${d.title}: ${d.status} (${d.status_note ?? ''})`));
      break;
    }
    await sleep(2000);
  }

  step('Cluster 1: HW3 deadline (will be answered)');
  const hw3 = [
    ['sofia', 'Will the HW3 deadline be extended because the campus network was down on Tuesday?'],
    ['lena', 'Will there be an extension for HW3 because of the network outage on Tuesday?'],
    ['kenji', 'HW3の締め切りは延長されますか？火曜日にネットワークが止まっていました。'],
  ];
  for (const [who, text] of hw3) {
    const r = await call(who, 'POST', `/api/courses/${C}/questions`, { text, module: 'Module 4', force: true });
    ok(`${who}: ${r.status ?? r.outcome ?? 'submitted'}`);
  }

  step('Professor answers the HW3 digest');
  // The dashboard reads digests server-side, so the seed looks the cluster up directly.
  const row = execSync(
    `docker exec rooroom-db-1 psql -U rooroom_owner -d rooroom -Atc "SELECT id || '|' || coalesce(summary,'') FROM clusters WHERE course_id = '${C}' AND status = 'digest' ORDER BY question_count DESC, created_at LIMIT 1"`,
  ).toString().trim();
  const hwCluster = row ? { id: row.split('|')[0], summary: row.split('|').slice(1).join('|') } : null;
  await call('okafor', 'POST', `/api/courses/${C}/clarifications`, {
    clusterId: hwCluster?.id ?? null,
    title: 'Homework 3 deadline',
    answer: 'Because of Tuesday’s campus network outage, Homework 3 is extended to Monday, November 16, 2026 at 11:59 pm Central. Nothing else changes: Quiz 4 is still Wednesday, November 18 in class.',
  });
  ok(hwCluster ? `published answer to digest: “${hwCluster.summary}”` : 'published as an announcement (digest not found by summary)');

  step('Cluster 2: Part 3 unit tests (left open for the live demo)');
  const part3 = [
    ['diego', '¿La parte 3 del proyecto necesita pruebas unitarias? Dice "well tested" pero no explica qué significa.'],
    ['priya', 'प्रोजेक्ट पार्ट 3 में "well tested" का मतलब क्या है? क्या यूनिट टेस्ट लिखना ज़रूरी है?'],
    ['wei', '项目第三部分要求"well tested"，是必须写单元测试吗？还是只要演示就可以？'],
    ['omar', 'هل يتطلب الجزء الثالث من المشروع كتابة اختبارات وحدة؟ المطلوب غير واضح.'],
  ];
  for (const [who, text] of part3) {
    const r = await call(who, 'POST', `/api/courses/${C}/questions`, { text, module: 'Module 4', force: true });
    ok(`${who}: ${r.status ?? r.outcome ?? 'submitted'}`);
  }

  step('A lone question below the threshold (professor never sees it)');
  await call('lucas', 'POST', `/api/courses/${C}/questions`,
    { text: 'Can we bring a calculator to Quiz 4?', module: 'Module 4', force: true });
  ok('lucas asked about calculators');

  step('Anonymous notes (fair criticism), delivered in the daily batch');
  for (const [who, text] of [
    ['hana', 'Module 4 lectures have been moving very fast. The congestion control examples went by before I could copy them. Could the slides be posted before class?'],
    ['sofia', 'Il mio gruppo di laboratorio non funziona: due persone non rispondono da due settimane. Non so come chiedere aiuto senza mettere nei guai nessuno.'],
  ]) {
    const r = await call(who, 'POST', `/api/courses/${C}/notes`, { text });
    ok(`${who}: ${r.status ?? r.outcome ?? JSON.stringify(r).slice(0, 60)}`);
  }
  const d = await call('okafor', 'POST', `/api/courses/${C}/notes/deliver`, {});
  ok(`delivered ${JSON.stringify(d.delivered)}`);

  step('Study AI activity (feeds the buddy list)');
  for (const [who, q] of [
    ['diego', '¿Cómo funciona el slow start en TCP?'],
    ['lena', 'What is the difference between flow control and congestion control?'],
    ['kenji', 'How is the retransmission timeout computed?'],
  ]) {
    const r = await call(who, 'POST', `/api/courses/${C}/study/ask`, { question: q, history: [] });
    ok(`${who} asked the Study AI (${(r.sources ?? []).length} sources${r.hintsOnly || r.mode === 'hints' ? ', hints only' : ''})`);
  }

  step('Calendar blocks so shared free time is visible');
  const tomorrow = new Date(Date.now() + 86400000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(tomorrow);
  const at = (h) => new Date(`${ymd}T${String(h).padStart(2, '0')}:00:00-06:00`).toISOString();
  for (const [who, from, to, title] of [
    ['diego', 10, 12, 'Module 4 review'],
    ['priya', 13, 15, 'Lab shift'],
    ['lena', 9, 11, 'Statistics lecture'],
  ]) {
    await call(who, 'POST', '/api/events', { title, starts_at: at(from), ends_at: at(to), kind: 'study', course_id: C, force: true });
    ok(`${who}: ${title} ${from}:00–${to}:00 tomorrow`);
  }

  step('A chat message in Spanish (translate on tap)');
  const buddies = await call('diego', 'GET', `/api/courses/${C}/buddies`);
  const priya = buddies.buddies.find((b) => /Priya/.test(b.display_name));
  if (priya) {
    const t = await call('diego', 'POST', '/api/threads', { courseId: C, memberIds: [priya.id] });
    await call('diego', 'POST', `/api/threads/${t.id}/messages`,
      { body: '¡Hola Priya! ¿Quieres repasar el control de congestión juntos mañana por la tarde? Estoy libre después de las 3.' });
    ok('diego → priya');
  }

  console.log('\nDemo seeded. Sign in at', BASE, 'with any demo account (password rooroom-demo).');
}

main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
