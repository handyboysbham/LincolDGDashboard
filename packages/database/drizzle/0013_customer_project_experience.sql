CREATE TABLE "project_public_link_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_public_link_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_public_link_views_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "project_public_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"scope" varchar(40) DEFAULT 'summary' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "project_public_links_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "project_public_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "project_public_links_scope_check" CHECK ("project_public_links"."scope" in ('summary')),
	CONSTRAINT "project_public_links_expiry_check" CHECK ("project_public_links"."expires_at" > "project_public_links"."created_at"),
	CONSTRAINT "project_public_links_view_count_check" CHECK ("project_public_links"."view_count" >= 0),
	CONSTRAINT "project_public_links_view_history_check" CHECK (("project_public_links"."view_count" = 0 and "project_public_links"."first_viewed_at" is null and "project_public_links"."last_viewed_at" is null) or ("project_public_links"."view_count" > 0 and "project_public_links"."first_viewed_at" is not null and "project_public_links"."last_viewed_at" is not null and "project_public_links"."last_viewed_at" >= "project_public_links"."first_viewed_at"))
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "project_public_link_id" uuid;--> statement-breakpoint
ALTER TABLE "project_public_link_views" ADD CONSTRAINT "project_public_link_views_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_public_link_views" ADD CONSTRAINT "project_public_link_views_tenant_link_fk" FOREIGN KEY ("tenant_id","project_public_link_id") REFERENCES "public"."project_public_links"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_public_links" ADD CONSTRAINT "project_public_links_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_public_links" ADD CONSTRAINT "project_public_links_tenant_project_customer_fk" FOREIGN KEY ("tenant_id","project_id","customer_account_id") REFERENCES "public"."projects"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_public_link_views_tenant_link_viewed_idx" ON "project_public_link_views" USING btree ("tenant_id","project_public_link_id","viewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_public_links_one_active_scope_idx" ON "project_public_links" USING btree ("tenant_id","project_id","scope") WHERE "project_public_links"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "project_public_links_tenant_project_idx" ON "project_public_links" USING btree ("tenant_id","project_id","expires_at");--> statement-breakpoint
CREATE INDEX "project_public_links_expiry_idx" ON "project_public_links" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_project_link_fk" FOREIGN KEY ("tenant_id","project_public_link_id") REFERENCES "public"."project_public_links"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_project_link_check" CHECK ("notification_deliveries"."project_public_link_id" is null or "notification_deliveries"."project_id" is not null);
--> statement-breakpoint
CREATE TRIGGER project_public_links_row_update BEFORE UPDATE ON project_public_links
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_project_customer_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Customer Project capability history cannot be deleted';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_project_public_link_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.customer_account_id IS DISTINCT FROM OLD.customer_account_id
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Customer Project capability identity is immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Revoked Customer Project capabilities are immutable';
  END IF;
  IF NEW.view_count < OLD.view_count
    OR (OLD.first_viewed_at IS NOT NULL AND NEW.first_viewed_at IS DISTINCT FROM OLD.first_viewed_at)
    OR (OLD.last_viewed_at IS NOT NULL AND NEW.last_viewed_at < OLD.last_viewed_at) THEN
    RAISE EXCEPTION 'Customer Project capability view history is append-only';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_public_links_update_guard BEFORE UPDATE ON project_public_links
FOR EACH ROW EXECUTE FUNCTION enforce_project_public_link_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_project_public_link_view_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Customer Project capability views are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_public_links_no_delete_guard BEFORE DELETE ON project_public_links
FOR EACH ROW EXECUTE FUNCTION protect_project_customer_history();
--> statement-breakpoint
CREATE TRIGGER project_public_link_views_no_update_guard BEFORE UPDATE ON project_public_link_views
FOR EACH ROW EXECUTE FUNCTION prevent_project_public_link_view_mutation();
--> statement-breakpoint
CREATE TRIGGER project_public_link_views_no_delete_guard BEFORE DELETE ON project_public_link_views
FOR EACH ROW EXECUTE FUNCTION protect_project_customer_history();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_notification_delivery_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origin_outbox_event_id IS DISTINCT FROM OLD.origin_outbox_event_id
    OR NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.customer_account_id IS DISTINCT FROM OLD.customer_account_id
    OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.project_public_link_id IS DISTINCT FROM OLD.project_public_link_id
    OR NEW.notification_type IS DISTINCT FROM OLD.notification_type
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.recipient IS DISTINCT FROM OLD.recipient
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.rendered_body IS DISTINCT FROM OLD.rendered_body
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key THEN
    RAISE EXCEPTION 'Notification Delivery content and ownership are immutable';
  END IF;

  IF OLD.status IN ('delivered', 'suppressed') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed Notification Deliveries are immutable';
  END IF;
  IF OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'sending', 'suppressed') THEN
    RAISE EXCEPTION 'Pending Notification Delivery transition is invalid';
  END IF;
  IF OLD.status = 'sending' AND NEW.status NOT IN ('sending', 'delivered', 'failed') THEN
    RAISE EXCEPTION 'Sending Notification Delivery transition is invalid';
  END IF;
  IF OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'sending') THEN
    RAISE EXCEPTION 'Failed Notification Delivery transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER TABLE project_public_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_public_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_public_links_tenant_isolation ON project_public_links
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE project_public_link_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_public_link_views FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_public_link_views_tenant_isolation ON project_public_link_views
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON project_public_links TO ldg_app;
    GRANT SELECT, INSERT ON project_public_link_views TO ldg_app;
  END IF;
END;
$$;
