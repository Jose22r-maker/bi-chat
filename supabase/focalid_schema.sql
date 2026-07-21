-- FOCALID Central Identity Service Schema
-- This schema manages the mapping of universal IDs to user emails and credentials.

BEGIN;

-- Enable extension for UUIDs and potentially hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Central Users Table
CREATE TABLE IF NOT EXISTS public.x21_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, -- Stored securely
  focalid TEXT NOT NULL UNIQUE, -- The 8-digit universal ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup via FOCALID
CREATE INDEX IF NOT EXISTS x21_users_focalid_idx ON public.x21_users(focalid);

-- Simple function to generate a pseudo-deterministic 8-digit FOCALID
-- This uses the first 8 characters of a hex hash of the email.
-- NOTE: In production, this needs a collision check mechanism.
CREATE OR REPLACE FUNCTION public.generate_focalid(user_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  hash_val TEXT;
BEGIN
  -- Generate hash from email and take first 8 chars
  hash_val := encode(digest(lower(user_email), 'sha256'), 'hex');
  RETURN upper(substring(hash_val from 1 for 8));
END;
$$;

COMMIT;
