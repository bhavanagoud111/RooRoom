# RooRoom

A shared class workspace: every course a student joins becomes a card, and inside that card five
AI features read and write the same data. Students and professors, in the same room.

Built from *RooRoom Architecture* (Pouch_Architecture.pdf), with Docker Compose in place of a hosted
backend.

## Run it

```sh
./scripts/make-env.sh                 # generates .env with random secrets
# put your key in .env:  OPENROUTER_API_KEY=sk-or-...
docker compose up -d --build          # first build takes a few minutes (embedding model is baked in)
python3 scripts/scrape_umkc.py --term 5443   # optional: re-scrape (data/umkc/ already holds Fall 2026)
python3 scripts/import_umkc.py --term 5443 --label "Fall 2026"   # every UMKC course + professor
./scripts/reset-demo.sh               # loads the demo course through the real pipelines
open http://localhost:3300
```

Demo accounts (password `rooroom-demo`). Everyone starts in English; each person can pick a language in Settings:

| Account | Who |
|---|---|
| okafor@umkc.edu | Dr. Maya Okafor, professor of COMP-SCI 5520 |
| diego@umkc.edu | Student |
| priya@umkc.edu | Student |
| amara@umkc.edu | Student |
| wei, omar, sofia, lena, kenji, lucas, hana, jonah, fatima @umkc.edu | More students (jonah and fatima are hidden from the buddy list) |

Development mode with hot reload: `docker compose -f docker-compose.yml -f compose.dev.yml up -d`.

## Tests

```sh
node scripts/redteam.mjs              # 18 checks against the live stack, incl. 16 database rules
cd web && npm test                    # egress filter and prompt-wrapping unit tests
```

## Real UMKC courses and professors

`scripts/scrape_umkc.py` reads two public sources, politely (one request a second, pages cached,
resumable): the **UMKC catalog** (every subject and level: 4,951 courses with credits, description
and prerequisites) and the **guest Class Search** for a term (Fall 2026: 4,418 sections in 119
subjects, 1,151 named instructors, published under Missouri SB 389). Only course facts and
instructor names are kept, no emails or phone numbers.

`scripts/import_umkc.py` turns that into **rooms**: one per course and professor, with that
professor's sections and times. Students search the whole catalog (by code, title or topic,
filtered by subject and level), **choose their professor**, and can switch later. A course that is
not on the schedule can still get a room with no professor yet. Instructors are names until the
university provisions an account: `./scripts/provision-professor.sh "Name" email@umkc.edu` creates
one and makes them professor of every room they teach. Fall 2026 import: 5,091 courses, 1,132
professors, 3,932 rooms.

## What is in it

| Feature | Where | What makes it more than a single-user tool |
|---|---|---|
| Study AI | Course → Study AI | Answers only from the course's files **and the professor's published answers**, cites document and page, answers in the student's language. Two-layer guardrail: hints only near graded work. |
| Clarification loop | Course → Ask the professor / Clarifications | Anonymous questions in any language are translated, screened (abusive words removed, pure abuse refused), redacted, embedded and clustered. At 3 students the professor sees a one-line digest; one answer goes to the whole class, translated, and into the Study AI. |
| Anonymous notes | Course → Anonymous note / Anonymous notes | Word list + label-only moderation; abuse is never delivered; strikes and suspension; delivered in a daily batch with no author. |
| Study buddies & chat | Course → Study buddies | Classmates who opted in, what they are studying (from the Study AI) and shared free time (from the calendar). Encrypted 1:1 and group chat over WebSocket, block and report. |
| Calendar | Calendar | Manual (drag, resize, accessible form) and voice (Web Speech API → tool-calling agent that asks before deleting or double-booking). Syllabus deadlines arrive as suggestions. `.ics` export. |
| Translation | Everywhere | One `translate(text, lang)`; class-wide answers cached per language; private text never cached. |

The five links between features (design section 10) are all wired: published answer → Study AI,
syllabus → calendar, Study AI activity + calendar → buddy list, flagged note → question pool,
translation → everything.

## Architecture

```
browser ──► gateway (Caddy, 127.0.0.1:3300, the only published port)
              ├─ /       → web    (Next.js 15: pages + API routes)
              ├─ /ws     → chat   (WebSocket; Postgres LISTEN/NOTIFY)
web, worker ──► egress proxy (tinyproxy) ──► openrouter.ai only
internal network (no internet): db (Postgres 16 + pgvector), storage (S3), worker (Python: PDF → chunks → embeddings, syllabus extraction)
```

- **Models** live in `config/models.json`: `claude-haiku-5.5` for translation, redaction, moderation,
  flashcards and the guardrail check; `claude-sonnet-5.5` for answers, digests, syllabus extraction
  and the calendar agent. Embeddings are local (`bge-small-en-v1.5`, 384 dimensions) in the worker,
  so they cost nothing and student text stays inside the stack for that step.
- **Database roles**: `rooroom_app` (web, chat; every query runs as the signed-in user via
  `SET LOCAL app.user_id`), `rooroom_worker` (documents and chunks only), `rooroom_moderator`
  (clustering, digests, note delivery; the only role that can read who wrote a note). None can
  bypass Row Level Security. Schema: `db/init/`.

## Security (design section 12)

| Root cause | Control | Where |
|---|---|---|
| Trust | Provenance labels; user text wrapped in `<untrusted source=…>` with brackets neutralised, never in the system prompt; steps that read it have no tools; nothing reaches the class without the professor; strict nonce-based CSP; markdown rendered without HTML; files served only as downloads. | `web/src/lib/untrusted.ts`, `middleware.ts`, `components/Markdown.tsx` |
| Authority | RLS on every table, including for the AI agents; no service key; sessions expire after 2 h idle; university email required; professors can only claim an instructor on the class schedule, once. | `db/init/003_security.sql`, `lib/db.ts` |
| Egress | AI output loses every outside link and image; containers reach only OpenRouter; Postgres and storage have no public port; per-user rate limits; cross-course read alert; chat and notes encrypted with a key outside the database. | `lib/egress.ts`, `proxy/`, `lib/limits.ts`, `lib/crypto.ts` |

## Differences from the design document

- **Object storage is SeaweedFS, not MinIO.** MinIO no longer publishes free container images.
  SeaweedFS speaks the same S3 protocol, and the app and worker use the MinIO S3 client libraries
  against it unchanged.
- **Sessions are a small built-in module, not Auth.js.** Sessions are still stored in Postgres (as
  hashes), with idle and absolute expiry; sign-in goes through narrow database functions so the app
  role cannot read the users table at all.
- **Testing mode: no email code at sign-up.** Students and professors create their own accounts and are signed in straight away (`db/init/050_open_signup.sql`). Until a one-time email code (MFA) is added, anyone with a university address can sign up under any name, and a professor can claim any unclaimed instructor on the schedule. Fine for testing, not for a real class.
- **Embeddings run locally** in the worker (the design's fallback), not through OpenRouter.

## Known limits (honest list)

- Enrolment is self-declared; roster verification is future work.
- Scanned PDFs (no text layer) are detected and reported, not read.
- Upheld reports do not yet add strikes (there is no reviewer screen).
- The voice mic needs Chrome (Web Speech API); other browsers get the text box.
- The guardrail does not stop cheating — a student can open ChatGPT — but it makes RooRoom
  something a professor can safely recommend.
- Anonymity in a small class is weak however the app is built; the compose screen says so.
