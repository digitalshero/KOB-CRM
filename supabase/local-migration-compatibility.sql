-- ============================================================================
-- LOCAL MIGRATION COMPATIBILITY ONLY
-- Purpose: Minimal compatibility layer for Supabase Auth, pg_net, and pg_cron
--          so that existing Supabase migrations compile and execute cleanly
--          in local Docker PostgreSQL without external side effects.
--
-- STRICT RULES:
-- 1. NO external HTTP requests (net.http_post is a silent NO-OP)
-- 2. NO background job executions (cron.schedule only records to table)
-- 3. NO production side effects or credentials needed
-- ============================================================================

-- Create standard Supabase roles required by RLS policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOLOGIN;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO postgres;

-- Ensure required schemas exist
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS cron;

GRANT ALL ON SCHEMA public, extensions, auth, net, cron TO postgres, anon, authenticated, service_role;

-- Enable standard available UUID extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Create supabase_realtime publication (LOCAL MIGRATION COMPATIBILITY ONLY)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- ============================================================================
-- 1. AUTH COMPATIBILITY LAYER (LOCAL MIGRATION COMPATIBILITY ONLY)
-- ============================================================================

-- Minimal auth.users table for foreign keys (profiles, user_roles, kob_leads, etc.)
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  email varchar(255) UNIQUE,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  is_super_admin boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  phone text UNIQUE,
  phone_confirmed_at timestamptz,
  phone_change text,
  phone_change_token varchar(255),
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz,
  email_change_token_current varchar(255),
  email_change_confirm_status smallint,
  banned_until timestamptz,
  reauthentication_token varchar(255),
  reauthentication_sent_at timestamptz,
  is_sso_user boolean DEFAULT false,
  deleted_at timestamptz,
  is_anonymous boolean DEFAULT false
);

-- auth.uid() function stub (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT null::uuid;
$$;

-- auth.jwt() function stub (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT '{}'::jsonb;
$$;

-- auth.role() function stub (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'authenticated'::text;
$$;

-- ============================================================================
-- 2. NET COMPATIBILITY LAYER (LOCAL MIGRATION COMPATIBILITY ONLY)
-- Strict Requirement: ZERO external HTTP requests, emails, or messages.
-- ============================================================================

-- net.http_post() function stub (LOCAL MIGRATION COMPATIBILITY ONLY)
-- Returns dummy request id without performing any network I/O
CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
BEGIN
  -- LOCAL MIGRATION COMPATIBILITY ONLY: NO-OP, ZERO EXTERNAL CALLS
  RETURN 1::bigint;
END;
$$;

-- net.http_get() function stub (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE OR REPLACE FUNCTION net.http_get(
  url text,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
BEGIN
  -- LOCAL MIGRATION COMPATIBILITY ONLY: NO-OP, ZERO EXTERNAL CALLS
  RETURN 1::bigint;
END;
$$;

-- ============================================================================
-- 3. CRON COMPATIBILITY LAYER (LOCAL MIGRATION COMPATIBILITY ONLY)
-- Strict Requirement: ZERO background cron executions.
-- ============================================================================

-- cron.job table stub (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  schedule text NOT NULL,
  command text NOT NULL,
  nodename text DEFAULT 'localhost',
  nodeport integer DEFAULT 5432,
  database text DEFAULT 'kob_local',
  username text DEFAULT 'postgres',
  active boolean DEFAULT true,
  jobname text UNIQUE
);

-- cron.schedule() function stub with jobname (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE OR REPLACE FUNCTION cron.schedule(
  job_name text,
  schedule text,
  command text
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  INSERT INTO cron.job (schedule, command, jobname)
  VALUES (schedule, command, job_name)
  ON CONFLICT (jobname) DO UPDATE
    SET schedule = EXCLUDED.schedule,
        command = EXCLUDED.command
  RETURNING jobid INTO v_jobid;
  RETURN v_jobid;
END;
$$;

-- cron.schedule() function stub without jobname (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE OR REPLACE FUNCTION cron.schedule(
  schedule text,
  command text
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  INSERT INTO cron.job (schedule, command)
  VALUES (schedule, command)
  RETURNING jobid INTO v_jobid;
  RETURN v_jobid;
END;
$$;

-- cron.unschedule() function stub by jobname (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  RETURN true;
END;
$$;

-- cron.unschedule() function stub by jobid (LOCAL MIGRATION COMPATIBILITY ONLY)
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobid = job_id;
  RETURN true;
END;
$$;
