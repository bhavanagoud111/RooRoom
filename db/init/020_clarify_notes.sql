-- Clarification loop and anonymous notes: extra pieces.

-- The privacy threshold counts distinct students, not questions, so one student asking the same
-- thing three times can never push a cluster over the threshold on their own.
-- The moderator learns only the count, never who the authors are.
CREATE FUNCTION cluster_author_count(p_cluster uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT author_id)::int FROM questions WHERE cluster_id = p_cluster
$$;
REVOKE EXECUTE ON FUNCTION cluster_author_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cluster_author_count(uuid) TO rooroom_moderator;

-- Next daily delivery batch: 08:00 America/Chicago, at least 6 hours from now, so a professor
-- cannot match a note to the student who just left office hours.
CREATE FUNCTION next_note_batch() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN t > now() + interval '6 hours' THEN t ELSE t + interval '1 day' END
    FROM (SELECT ((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day 8 hours')
                  AT TIME ZONE 'America/Chicago') - interval '1 day' AS t0) s,
         LATERAL (SELECT CASE WHEN t0 > now() THEN t0 ELSE t0 + interval '1 day' END AS t) u
$$;
