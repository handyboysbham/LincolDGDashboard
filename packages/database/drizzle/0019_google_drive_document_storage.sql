ALTER TABLE public.documents
ADD COLUMN storage_provider varchar(30) NOT NULL DEFAULT 's3';
--> statement-breakpoint
ALTER TABLE public.documents
ADD COLUMN storage_locator text;
--> statement-breakpoint
ALTER TABLE public.documents
ADD COLUMN storage_revision text;
--> statement-breakpoint
UPDATE public.documents
SET storage_locator = object_key
WHERE storage_locator IS NULL;
--> statement-breakpoint
ALTER TABLE public.documents
ALTER COLUMN storage_locator SET NOT NULL;
--> statement-breakpoint
ALTER TABLE public.documents
ADD CONSTRAINT documents_storage_provider_check
CHECK (storage_provider IN ('s3', 'google_drive'));
--> statement-breakpoint
ALTER TABLE public.documents
ADD CONSTRAINT documents_storage_provider_locator_unique
UNIQUE (storage_provider, storage_locator);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_schema_release()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT '1.10.0-rc.3'::text
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_schema_release() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_schema_release() TO ldg_app;
--> statement-breakpoint
DO $$
BEGIN
  IF public.current_schema_release() <> '1.10.0-rc.3' THEN
    RAISE EXCEPTION 'Google Drive document storage release marker failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.documents
    WHERE storage_locator IS NULL
      OR storage_provider NOT IN ('s3', 'google_drive')
  ) THEN
    RAISE EXCEPTION 'Document storage ownership metadata is incomplete';
  END IF;
END;
$$;
