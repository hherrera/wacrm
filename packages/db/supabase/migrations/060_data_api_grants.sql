-- ============================================================
-- 060 — Explicit table grants for the API roles.
--
-- wacrm relied on Supabase's old default privileges, which granted
-- SELECT/INSERT/UPDATE/DELETE on every new public table to anon,
-- authenticated and service_role. Newer Supabase CLI/projects no
-- longer do that (only REFERENCES/TRIGGER/TRUNCATE), so on a fresh
-- database every PostgREST call from the web and every `withUser()`
-- query from apps/api failed with "permission denied" before RLS
-- was even evaluated.
--
-- RLS is enabled on every public table and remains the access gate;
-- these grants only let the role reach it. `anon` stays without
-- table access on purpose: no wacrm/Conexa flow reads tables
-- unauthenticated. On projects that still have the old defaults
-- this migration is a no-op.
-- ============================================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Tables created by later migrations (run as postgres) get the same.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
