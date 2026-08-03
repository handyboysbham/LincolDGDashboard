CREATE TABLE "document_public_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"scope" varchar(50) DEFAULT 'download' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"creation_key_hash" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "document_public_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "document_public_links_tenant_creation_key_unique" UNIQUE("tenant_id","creation_key_hash"),
	CONSTRAINT "document_public_links_scope_check" CHECK ("document_public_links"."scope" in ('download')),
	CONSTRAINT "document_public_links_expiry_check" CHECK ("document_public_links"."expires_at" > "document_public_links"."created_at")
);
--> statement-breakpoint
ALTER TABLE "document_public_links" ADD CONSTRAINT "document_public_links_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_public_links" ADD CONSTRAINT "document_public_links_tenant_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_public_links_tenant_document_idx" ON "document_public_links" USING btree ("tenant_id","document_id","scope");--> statement-breakpoint
CREATE INDEX "document_public_links_expiry_idx" ON "document_public_links" USING btree ("expires_at");
--> statement-breakpoint
CREATE TRIGGER document_public_links_row_update
BEFORE UPDATE ON document_public_links
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
ALTER TABLE document_public_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_public_links FORCE ROW LEVEL SECURITY;
CREATE POLICY document_public_links_tenant_isolation ON document_public_links
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
REVOKE ALL ON document_public_links FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON document_public_links TO ldg_app;
  END IF;
END;
$$;
