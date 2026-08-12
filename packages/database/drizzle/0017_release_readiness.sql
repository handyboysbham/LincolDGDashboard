CREATE OR REPLACE FUNCTION public.current_schema_release()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT '1.10.0-rc.1'::text
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_schema_release() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_schema_release() TO ldg_app;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
DO $$
BEGIN
  ALTER EXTENSION btree_gist SET SCHEMA extensions;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'btree_gist relocation requires the extension owner; continuing without relocation';
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
