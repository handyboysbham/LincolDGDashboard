-- Reconcile the one reviewed 0017 artifact variance without rewriting migration history.
DO $$
DECLARE
  release_readiness_hash text;
BEGIN
  SELECT hash
  INTO release_readiness_hash
  FROM public.__drizzle_migrations
  WHERE created_at = 1786500000000
  ORDER BY id DESC
  LIMIT 1;

  IF release_readiness_hash IS NULL THEN
    RAISE EXCEPTION 'Migration 0017 release readiness history is missing';
  END IF;

  IF release_readiness_hash NOT IN (
    '2bd2c2029f9264b864bbda855b99f9113b84cbda9da1042ce639f70ed11229fe',
    'f75be16d780ae2d3002f3d195a4bb08cb873bf62dcf2ba049e935f02eddd38f7'
  ) THEN
    RAISE EXCEPTION 'Migration 0017 release readiness history has an unreviewed hash';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
DO $$
DECLARE
  extension_schema text;
BEGIN
  SELECT namespace.nspname
  INTO extension_schema
  FROM pg_extension AS extension
  INNER JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'btree_gist';

  IF extension_schema IS NULL THEN
    RAISE EXCEPTION 'Required btree_gist extension is missing';
  END IF;

  IF extension_schema <> 'extensions' THEN
    BEGIN
      ALTER EXTENSION btree_gist SET SCHEMA extensions;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'btree_gist relocation requires the extension owner; validating non-owner posture';
    END;
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE public.__drizzle_migrations DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.worker_heartbeats DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.__drizzle_migrations FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.worker_heartbeats FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.__drizzle_migrations FROM anon;
    REVOKE ALL ON public.worker_heartbeats FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.__drizzle_migrations FROM authenticated;
    REVOKE ALL ON public.worker_heartbeats FROM authenticated;
  END IF;
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_schema_release()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT '1.10.0-rc.2'::text
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_schema_release() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_schema_release() TO ldg_app;
--> statement-breakpoint
DO $$
DECLARE
  function_identity text;
BEGIN
  FOR function_identity IN
    SELECT format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)
    )
    FROM pg_proc AS procedure
    INNER JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = procedure.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', function_identity);
  END LOOP;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF public.current_schema_release() <> '1.10.0-rc.2' THEN
    RAISE EXCEPTION 'Release marker reconciliation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('__drizzle_migrations', 'worker_heartbeats')
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Global operational tables must not use tenant RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, '{}'::aclitem[])) AS access_grant
    LEFT JOIN pg_roles AS grantee ON grantee.oid = access_grant.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('__drizzle_migrations', 'worker_heartbeats')
      AND (access_grant.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
  ) THEN
    RAISE EXCEPTION 'Global operational tables have an exposed privilege';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    INNER JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = procedure.oid
          AND dependency.deptype = 'e'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(procedure.proconfig, '{}'::text[])) AS setting
        WHERE setting LIKE 'search_path=%'
      )
  ) THEN
    RAISE EXCEPTION 'A public application function has a mutable search path';
  END IF;

  IF NOT has_function_privilege('ldg_app', 'public.current_schema_release()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Restricted runtime cannot read the schema release marker';
  END IF;
END;
$$;
