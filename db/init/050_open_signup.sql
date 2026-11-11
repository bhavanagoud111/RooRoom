-- Open sign-up for testing (2026-11-08): students AND professors can create their own accounts,
-- and accounts are usable straight away (no email code). A one-time code by email (MFA) is to be
-- added later; until then anyone with a university address can sign up under any name, so this
-- is for testing, not for a real class.
--
-- A professor must sign up under their name exactly as it appears on the imported class
-- schedule. They are linked to that instructor's course rooms, and an instructor can be claimed
-- only once (the first account wins; the provisioning script is the way to fix a mistake).
CREATE FUNCTION auth_signup_open(p_email text, p_hash text, p_name text, p_role user_role)
RETURNS TABLE (user_id uuid, rooms int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; iid uuid; claimed uuid; n int := 0; canonical text;
BEGIN
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

  INSERT INTO users (email, password_hash, email_verified_at) VALUES (p_email, p_hash, now()) RETURNING id INTO uid;
  INSERT INTO profiles (id, display_name, role) VALUES (uid, coalesce(canonical, p_name), p_role);

  IF p_role = 'professor' THEN
    n := link_professor(uid, canonical);
  END IF;
  RETURN QUERY SELECT uid, n;
END $$;
REVOKE EXECUTE ON FUNCTION auth_signup_open(text, text, text, user_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_signup_open(text, text, text, user_role) TO rooroom_app;
