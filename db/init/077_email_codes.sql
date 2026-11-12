-- 2026-11-12: one-time codes by email, for sign-in (two-step) and for "Forgot password".
--   auth_code_issue()       stores a new 6-digit code (only its hash), or reuses the one sent < 60 s ago.
--   auth_login_code()       checks a sign-in code; it must match the password step that asked for it.
--   auth_reset_with_code()  checks a reset code and sets the new password in one go.
--   auth_signup_v2()        like auth_signup_open(), but the email starts unverified when a code is needed.
-- A code lasts 10 minutes and allows 5 wrong tries. At most 5 emails per account per hour.
-- rooroom_app gets no access to the tables, only to the functions. Safe to re-run.

CREATE TABLE IF NOT EXISTS email_codes (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose        text NOT NULL CHECK (purpose IN ('login', 'reset')),
  code_hash      text NOT NULL,
  challenge_hash text,
  attempts       int  NOT NULL DEFAULT 0,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  PRIMARY KEY (user_id, purpose)
);

CREATE TABLE IF NOT EXISTS email_code_sends (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_code_sends_user ON email_code_sends (user_id, sent_at);

REVOKE ALL ON email_codes, email_code_sends FROM PUBLIC;

-- Returns 'send' (a new code was stored: email it), 'reused' (the code sent under a minute ago
-- still stands; it is now tied to this sign-in attempt, nothing is emailed) or 'too_many'.
CREATE OR REPLACE FUNCTION auth_code_issue(p_user uuid, p_purpose text, p_code_hash text, p_challenge_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM email_codes WHERE user_id = p_user AND purpose = p_purpose
              AND sent_at > now() - interval '60 seconds' AND expires_at > now() AND attempts < 5) THEN
    UPDATE email_codes SET challenge_hash = p_challenge_hash WHERE user_id = p_user AND purpose = p_purpose;
    RETURN 'reused';
  END IF;
  IF (SELECT count(*) FROM email_code_sends WHERE user_id = p_user AND sent_at > now() - interval '1 hour') >= 5 THEN
    RETURN 'too_many';
  END IF;
  INSERT INTO email_codes (user_id, purpose, code_hash, challenge_hash, expires_at)
       VALUES (p_user, p_purpose, p_code_hash, p_challenge_hash, now() + interval '10 minutes')
  ON CONFLICT (user_id, purpose) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, challenge_hash = EXCLUDED.challenge_hash,
           attempts = 0, sent_at = now(), expires_at = EXCLUDED.expires_at;
  INSERT INTO email_code_sends (user_id) VALUES (p_user);
  DELETE FROM email_code_sends WHERE sent_at < now() - interval '1 day';
  RETURN 'send';
END $$;

-- Shared check, not callable by the app. A wrong code uses up one of the 5 tries.
-- On success the code is deleted and the email counts as verified (the person read their inbox).
CREATE OR REPLACE FUNCTION auth_code_check(p_email text, p_purpose text, p_code_hash text, p_challenge_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; good boolean;
BEGIN
  SELECT c.user_id, c.code_hash = p_code_hash INTO uid, good
    FROM email_codes c JOIN users u ON u.id = c.user_id
   WHERE u.email = p_email AND c.purpose = p_purpose AND c.expires_at > now() AND c.attempts < 5
     AND (p_purpose <> 'login' OR c.challenge_hash = p_challenge_hash);
  IF uid IS NULL THEN RETURN NULL; END IF;
  IF NOT good THEN
    UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = uid AND purpose = p_purpose;
    RETURN NULL;
  END IF;
  DELETE FROM email_codes WHERE user_id = uid AND purpose = p_purpose;
  UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = uid;
  RETURN uid;
END $$;
REVOKE EXECUTE ON FUNCTION auth_code_check(text, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION auth_login_code(p_email text, p_challenge_hash text, p_code_hash text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT auth_code_check(p_email, 'login', p_code_hash, p_challenge_hash)
$$;

-- New password after a correct reset code. Every open session of that account is signed out.
CREATE OR REPLACE FUNCTION auth_reset_with_code(p_email text, p_code_hash text, p_new_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  uid := auth_code_check(p_email, 'reset', p_code_hash, NULL);
  IF uid IS NULL THEN RETURN false; END IF;
  UPDATE users SET password_hash = p_new_hash WHERE id = uid;
  UPDATE sessions SET revoked_at = now() WHERE user_id = uid AND revoked_at IS NULL;
  DELETE FROM email_codes WHERE user_id = uid;
  RETURN true;
END $$;

-- Same as auth_signup_open(), plus p_verified. When a code is required the account starts
-- unverified and becomes verified the first time a code from the inbox is entered.
-- An unverified account more than 30 minutes old does not block a new sign-up with that email.
CREATE OR REPLACE FUNCTION auth_signup_v2(p_email text, p_hash text, p_name text, p_role user_role, p_verified boolean)
RETURNS TABLE (user_id uuid, rooms int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; iid uuid; claimed uuid; n int := 0; canonical text;
BEGIN
  DELETE FROM users u WHERE u.email = p_email AND u.email_verified_at IS NULL
     AND u.created_at < now() - interval '30 minutes'
     AND NOT EXISTS (SELECT 1 FROM instructors i WHERE i.profile_id = u.id);

  IF p_role = 'professor' THEN
    SELECT i.id, i.profile_id, i.name INTO iid, claimed, canonical
      FROM instructors i WHERE lower(i.name) = lower(trim(p_name)) LIMIT 1;
    IF iid IS NULL THEN
      RAISE EXCEPTION 'no_instructor' USING ERRCODE = 'P0001';
    END IF;
    IF claimed IS NOT NULL THEN
      RAISE EXCEPTION 'instructor_claimed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO users (email, password_hash, email_verified_at)
       VALUES (p_email, p_hash, CASE WHEN p_verified THEN now() END) RETURNING id INTO uid;
  INSERT INTO profiles (id, display_name, role) VALUES (uid, coalesce(canonical, p_name), p_role);

  IF p_role = 'professor' THEN
    n := link_professor(uid, canonical);
  END IF;
  RETURN QUERY SELECT uid, n;
END $$;

REVOKE EXECUTE ON FUNCTION auth_code_issue(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_login_code(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_reset_with_code(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_signup_v2(text, text, text, user_role, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_code_issue(uuid, text, text, text) TO rooroom_app;
GRANT EXECUTE ON FUNCTION auth_login_code(text, text, text) TO rooroom_app;
GRANT EXECUTE ON FUNCTION auth_reset_with_code(text, text, text) TO rooroom_app;
GRANT EXECUTE ON FUNCTION auth_signup_v2(text, text, text, user_role, boolean) TO rooroom_app;
