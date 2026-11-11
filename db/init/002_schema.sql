-- RooRoom schema. Every table hangs off courses and enrollments.
-- Every user-written row records author_role (student, professor or system): the provenance label.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role       AS ENUM ('student', 'professor');
CREATE TYPE author_role     AS ENUM ('student', 'professor', 'system');
CREATE TYPE doc_visibility  AS ENUM ('class', 'private');
CREATE TYPE doc_kind        AS ENUM ('module', 'syllabus', 'assignment', 'quiz');
CREATE TYPE doc_status      AS ENUM ('pending', 'processing', 'ready', 'failed', 'no_text');
CREATE TYPE event_source    AS ENUM ('voice', 'syllabus', 'manual');
CREATE TYPE event_kind      AS ENUM ('study', 'deadline', 'exam', 'class');
CREATE TYPE event_status    AS ENUM ('confirmed', 'suggested');
CREATE TYPE question_status AS ENUM ('pending', 'clustered', 'answered', 'rejected');
CREATE TYPE cluster_status  AS ENUM ('forming', 'digest', 'answered');
CREATE TYPE note_status     AS ENUM ('held', 'blocked', 'queued', 'delivered');

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext UNIQUE NOT NULL,
  password_hash     text NOT NULL,
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_verifications (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Sessions live in Postgres. Only a hash of the cookie value is stored.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text UNIQUE NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

CREATE TABLE profiles (
  id                    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name          text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  role                  user_role NOT NULL,
  preferred_language    text NOT NULL DEFAULT 'en',
  timezone              text NOT NULL DEFAULT 'America/Chicago',
  visible_to_classmates boolean NOT NULL DEFAULT false,
  activity_course_id    uuid,
  activity_line         text,
  activity_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- courses
CREATE TABLE courses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL,
  title               text NOT NULL,
  term                text NOT NULL,
  professor_id        uuid REFERENCES profiles(id),
  description         text,
  cluster_threshold   int  NOT NULL DEFAULT 3 CHECK (cluster_threshold >= 2),
  similarity_cutoff   real NOT NULL DEFAULT 0.80,
  notes_enabled       boolean NOT NULL DEFAULT true,
  notes_muted_until   timestamptz,
  notes_weekly_limit  int NOT NULL DEFAULT 3,
  color               text NOT NULL DEFAULT '#3B5BDB',
  UNIQUE (code, term)
);

CREATE TABLE enrollments (
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  role_in_course user_role NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
CREATE INDEX ON enrollments (course_id);

-- ---------------------------------------------------------------- study materials
CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  uploader_id  uuid NOT NULL REFERENCES profiles(id),
  author_role  author_role NOT NULL,
  visibility   doc_visibility NOT NULL,
  kind         doc_kind NOT NULL,
  title        text NOT NULL,
  module       text,
  filename     text NOT NULL,
  storage_key  text NOT NULL,
  size_bytes   bigint NOT NULL,
  status       doc_status NOT NULL DEFAULT 'pending',
  status_note  text,
  page_count   int,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON documents (course_id);

CREATE TABLE clusters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  summary        text,
  module         text,
  question_count int NOT NULL DEFAULT 0,
  status         cluster_status NOT NULL DEFAULT 'forming',
  centroid       vector(384),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON clusters (course_id);

CREATE TABLE clarifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id     uuid REFERENCES clusters(id) ON DELETE SET NULL,
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  author_id      uuid NOT NULL REFERENCES profiles(id),
  author_role    author_role NOT NULL DEFAULT 'professor',
  question_summary text,
  answer_english text NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON clarifications (course_id);

-- Chunks carry visibility and owner so a private upload never shows up in a classmate's search.
CREATE TABLE chunks (
  id               bigserial PRIMARY KEY,
  document_id      uuid REFERENCES documents(id) ON DELETE CASCADE,
  clarification_id uuid REFERENCES clarifications(id) ON DELETE CASCADE,
  course_id        uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  visibility       doc_visibility NOT NULL,
  owner_id         uuid NOT NULL REFERENCES profiles(id),
  doc_kind         doc_kind,
  page             int,
  content          text NOT NULL,
  embedding        vector(384) NOT NULL,
  tsv              tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  CHECK ((document_id IS NULL) <> (clarification_id IS NULL))
);
CREATE INDEX ON chunks (course_id);
CREATE INDEX ON chunks USING gin (tsv);
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------- clarification loop
-- Professors have no policy on this table at all: they only ever see clusters.
CREATE TABLE questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  author_id      uuid NOT NULL REFERENCES profiles(id),
  author_role    author_role NOT NULL DEFAULT 'student',
  text_original  text NOT NULL CHECK (length(text_original) BETWEEN 3 AND 1500),
  lang_original  text,
  text_english   text,
  text_redacted  text,
  embedding      vector(384),
  cluster_id     uuid REFERENCES clusters(id) ON DELETE SET NULL,
  module         text,
  status         question_status NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON questions (course_id);

-- ---------------------------------------------------------------- calendar
CREATE TABLE events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES courses(id) ON DELETE SET NULL,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  kind        event_kind NOT NULL DEFAULT 'study',
  source      event_source NOT NULL DEFAULT 'manual',
  status      event_status NOT NULL DEFAULT 'confirmed',
  weight      text,
  author_role author_role NOT NULL DEFAULT 'student',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX ON events (user_id, starts_at);

-- ---------------------------------------------------------------- study buddy chat
CREATE TABLE threads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  is_group   boolean NOT NULL DEFAULT false,
  title      text,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE thread_members (
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX ON thread_members (user_id);

-- Message bodies are encrypted by the app (AES-256-GCM) with a key that is not in the database.
CREATE TABLE messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES profiles(id),
  author_role author_role NOT NULL DEFAULT 'student',
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (thread_id, created_at);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid NOT NULL REFERENCES profiles(id),
  reported_user_id uuid REFERENCES profiles(id),
  message_id       uuid REFERENCES messages(id) ON DELETE SET NULL,
  note_id          uuid,
  course_id        uuid REFERENCES courses(id),
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'open',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- anonymous notes
CREATE TABLE anon_notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  author_role       author_role NOT NULL DEFAULT 'student',
  body_original     text NOT NULL,   -- encrypted
  body_english      text,            -- encrypted, redacted
  lang_original     text,
  moderation_labels text[] NOT NULL DEFAULT '{}',
  status            note_status NOT NULL DEFAULT 'held',
  deliver_after     timestamptz,
  delivered_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON anon_notes (course_id, status);

-- Kept apart from anon_notes. The app can write here but never read; only the moderator role reads.
CREATE TABLE note_authors (
  note_id   uuid PRIMARY KEY REFERENCES anon_notes(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES profiles(id)
);

CREATE TABLE note_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     uuid NOT NULL REFERENCES anon_notes(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES profiles(id),
  author_role author_role NOT NULL DEFAULT 'professor',
  body        text NOT NULL,         -- encrypted
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strikes (
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id       uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  count           int NOT NULL DEFAULT 0,
  suspended_until timestamptz,
  last_reason     text,
  PRIMARY KEY (user_id, course_id)
);

-- ---------------------------------------------------------------- shared services
CREATE TABLE translations (
  text_hash   text NOT NULL,
  target_lang text NOT NULL,
  translated  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (text_hash, target_lang)
);

-- Outside AI clients (Claude, ChatGPT) connect to the MCP server with one of these.
-- Read-only, short-lived, revocable, and tied to one user. There is no service key.
CREATE TABLE mcp_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label        text NOT NULL,
  token_hash   text UNIQUE NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz
);

-- Rate limits and read volume. One row per counted action.
CREATE TABLE usage_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  course_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON usage_events (user_id, kind, created_at);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid,
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE security_alerts (
  id         bigserial PRIMARY KEY,
  user_id    uuid,
  kind       text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
