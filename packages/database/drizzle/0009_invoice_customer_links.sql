CREATE TABLE "invoice_public_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_version_id" uuid NOT NULL,
	"invoice_delivery_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"creation_key_hash" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_public_links_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_public_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invoice_public_links_tenant_creation_key_unique" UNIQUE("tenant_id","creation_key_hash"),
	CONSTRAINT "invoice_public_links_expiry_check" CHECK ("invoice_public_links"."expires_at" > "invoice_public_links"."created_at"),
	CONSTRAINT "invoice_public_links_view_count_check" CHECK ("invoice_public_links"."view_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "invoice_public_links" ADD CONSTRAINT "invoice_public_links_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_public_links" ADD CONSTRAINT "invoice_public_links_tenant_version_invoice_fk" FOREIGN KEY ("tenant_id","invoice_version_id","invoice_id") REFERENCES "public"."invoice_versions"("tenant_id","id","invoice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_public_links" ADD CONSTRAINT "invoice_public_links_tenant_delivery_fk" FOREIGN KEY ("tenant_id","invoice_delivery_id") REFERENCES "public"."invoice_deliveries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_public_links_tenant_invoice_idx" ON "invoice_public_links" USING btree ("tenant_id","invoice_id","expires_at");
--> statement-breakpoint
CREATE TRIGGER invoice_public_links_no_delete_guard BEFORE DELETE ON invoice_public_links
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER invoice_public_links_row_update BEFORE UPDATE ON invoice_public_links
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
ALTER TABLE invoice_public_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_public_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoice_public_links_tenant_isolation ON invoice_public_links
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON invoice_public_links TO ldg_app;
  END IF;
END;
$$;
