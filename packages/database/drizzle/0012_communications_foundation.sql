CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"origin_outbox_event_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"project_id" uuid,
	"notification_type" varchar(80) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"subject" varchar(300),
	"rendered_body" text NOT NULL,
	"provider" varchar(80) NOT NULL,
	"provider_message_id" varchar(240),
	"dedupe_key" varchar(200) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"suppression_reason" varchar(120),
	"last_error_code" varchar(120),
	"first_attempted_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_deliveries_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "notification_deliveries_tenant_dedupe_unique" UNIQUE("tenant_id","dedupe_key"),
	CONSTRAINT "notification_deliveries_channel_check" CHECK ("notification_deliveries"."channel" in ('email', 'sms')),
	CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" in ('pending', 'sending', 'delivered', 'failed', 'suppressed')),
	CONSTRAINT "notification_deliveries_subject_check" CHECK ("notification_deliveries"."channel" <> 'email' or "notification_deliveries"."subject" is not null),
	CONSTRAINT "notification_deliveries_suppression_check" CHECK ("notification_deliveries"."status" <> 'suppressed' or "notification_deliveries"."suppression_reason" is not null),
	CONSTRAINT "notification_deliveries_delivery_check" CHECK ("notification_deliveries"."status" <> 'delivered' or "notification_deliveries"."delivered_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notification_delivery_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider" varchar(80) NOT NULL,
	"provider_idempotency_key" varchar(200) NOT NULL,
	"provider_message_id" varchar(240),
	"status" varchar(30) DEFAULT 'sending' NOT NULL,
	"error_code" varchar(120),
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_attempts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "notification_delivery_attempts_tenant_delivery_number_unique" UNIQUE("tenant_id","notification_delivery_id","attempt_number"),
	CONSTRAINT "notification_delivery_attempts_tenant_provider_key_unique" UNIQUE("tenant_id","provider_idempotency_key"),
	CONSTRAINT "notification_delivery_attempts_number_check" CHECK ("notification_delivery_attempts"."attempt_number" > 0),
	CONSTRAINT "notification_delivery_attempts_status_check" CHECK ("notification_delivery_attempts"."status" in ('sending', 'delivered', 'failed')),
	CONSTRAINT "notification_delivery_attempts_completion_check" CHECK (("notification_delivery_attempts"."status" = 'sending' and "notification_delivery_attempts"."completed_at" is null) or ("notification_delivery_attempts"."status" in ('delivered', 'failed') and "notification_delivery_attempts"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"notification_type" varchar(80) NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_preferences_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "notification_preferences_tenant_contact_type_unique" UNIQUE("tenant_id","contact_id","notification_type"),
	CONSTRAINT "notification_preferences_type_check" CHECK (length("notification_preferences"."notification_type") > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_key" varchar(100) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"subject_template" varchar(300),
	"body_template" text NOT NULL,
	"allowed_variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_templates_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "notification_templates_tenant_key_channel_version_unique" UNIQUE("tenant_id","template_key","channel","version"),
	CONSTRAINT "notification_templates_key_check" CHECK (length("notification_templates"."template_key") > 0),
	CONSTRAINT "notification_templates_version_check" CHECK ("notification_templates"."version" > 0),
	CONSTRAINT "notification_templates_channel_check" CHECK ("notification_templates"."channel" in ('email', 'sms')),
	CONSTRAINT "notification_templates_status_check" CHECK ("notification_templates"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "notification_templates_subject_check" CHECK ("notification_templates"."channel" <> 'email' or "notification_templates"."subject_template" is not null),
	CONSTRAINT "notification_templates_publication_check" CHECK (("notification_templates"."status" = 'draft' and "notification_templates"."published_at" is null and "notification_templates"."retired_at" is null) or ("notification_templates"."status" = 'published' and "notification_templates"."published_at" is not null and "notification_templates"."retired_at" is null) or ("notification_templates"."status" = 'retired' and "notification_templates"."published_at" is not null and "notification_templates"."retired_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_outbox_fk" FOREIGN KEY ("tenant_id","origin_outbox_event_id") REFERENCES "public"."outbox_events"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."notification_templates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_account_contact_fk" FOREIGN KEY ("tenant_id","customer_account_id","contact_id") REFERENCES "public"."account_contacts"("tenant_id","customer_account_id","contact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_tenant_delivery_fk" FOREIGN KEY ("tenant_id","notification_delivery_id") REFERENCES "public"."notification_deliveries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_account_contact_fk" FOREIGN KEY ("tenant_id","customer_account_id","contact_id") REFERENCES "public"."account_contacts"("tenant_id","customer_account_id","contact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_tenant_status_idx" ON "notification_deliveries" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_tenant_customer_idx" ON "notification_deliveries" USING btree ("tenant_id","customer_account_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_tenant_project_idx" ON "notification_deliveries" USING btree ("tenant_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_tenant_delivery_idx" ON "notification_delivery_attempts" USING btree ("tenant_id","notification_delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "notification_preferences_tenant_customer_idx" ON "notification_preferences" USING btree ("tenant_id","customer_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_one_published_idx" ON "notification_templates" USING btree ("tenant_id","template_key","channel") WHERE "notification_templates"."status" = 'published';--> statement-breakpoint
CREATE INDEX "notification_templates_tenant_status_idx" ON "notification_templates" USING btree ("tenant_id","status","template_key");
--> statement-breakpoint
CREATE TRIGGER notification_templates_row_update BEFORE UPDATE ON notification_templates
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER notification_preferences_row_update BEFORE UPDATE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER notification_deliveries_row_update BEFORE UPDATE ON notification_deliveries
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_notification_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Notification history cannot be deleted';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_notification_template_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.subject_template IS DISTINCT FROM OLD.subject_template
    OR NEW.body_template IS DISTINCT FROM OLD.body_template
    OR NEW.allowed_variables IS DISTINCT FROM OLD.allowed_variables
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'Published Notification Templates are immutable';
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Draft Notification Template transition is invalid';
  END IF;
  IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'retired') THEN
    RAISE EXCEPTION 'Published Notification Template transition is invalid';
  END IF;
  IF OLD.status = 'retired' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Retired Notification Templates are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notification_templates_update_guard BEFORE UPDATE ON notification_templates
FOR EACH ROW EXECUTE FUNCTION enforce_notification_template_update();
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
CREATE TRIGGER notification_deliveries_update_guard BEFORE UPDATE ON notification_deliveries
FOR EACH ROW EXECUTE FUNCTION enforce_notification_delivery_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_notification_attempt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'sending' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed Notification Delivery Attempts are immutable';
  END IF;
  IF OLD.status = 'sending' AND NEW.status NOT IN ('sending', 'delivered', 'failed') THEN
    RAISE EXCEPTION 'Notification Delivery Attempt transition is invalid';
  END IF;
  IF NEW.notification_delivery_id IS DISTINCT FROM OLD.notification_delivery_id
    OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key
    OR NEW.attempted_at IS DISTINCT FROM OLD.attempted_at THEN
    RAISE EXCEPTION 'Notification Delivery Attempt identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notification_delivery_attempts_update_guard BEFORE UPDATE ON notification_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION enforce_notification_attempt_update();
--> statement-breakpoint
CREATE TRIGGER notification_templates_no_delete_guard BEFORE DELETE ON notification_templates
FOR EACH ROW EXECUTE FUNCTION protect_notification_deletion();
--> statement-breakpoint
CREATE TRIGGER notification_preferences_no_delete_guard BEFORE DELETE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION protect_notification_deletion();
--> statement-breakpoint
CREATE TRIGGER notification_deliveries_no_delete_guard BEFORE DELETE ON notification_deliveries
FOR EACH ROW EXECUTE FUNCTION protect_notification_deletion();
--> statement-breakpoint
CREATE TRIGGER notification_delivery_attempts_no_delete_guard BEFORE DELETE ON notification_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION protect_notification_deletion();
--> statement-breakpoint
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_templates_tenant_isolation ON notification_templates
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_tenant_isolation ON notification_preferences
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_deliveries_tenant_isolation ON notification_deliveries
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE notification_delivery_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_delivery_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_delivery_attempts_tenant_isolation ON notification_delivery_attempts
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON notification_templates TO ldg_app;
    GRANT SELECT, INSERT, UPDATE ON notification_preferences TO ldg_app;
    GRANT SELECT, INSERT, UPDATE ON notification_deliveries TO ldg_app;
    GRANT SELECT, INSERT, UPDATE ON notification_delivery_attempts TO ldg_app;
  END IF;
END;
$$;
