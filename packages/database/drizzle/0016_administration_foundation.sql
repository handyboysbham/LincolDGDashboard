CREATE TABLE "checklist_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checklist_template_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"label" varchar(240) NOT NULL,
	"instructions" text,
	"response_type" varchar(30) DEFAULT 'confirmation' NOT NULL,
	"requires_evidence" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "checklist_template_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "checklist_template_items_tenant_template_sequence_unique" UNIQUE("tenant_id","checklist_template_id","sequence"),
	CONSTRAINT "checklist_template_items_sequence_check" CHECK ("checklist_template_items"."sequence" > 0),
	CONSTRAINT "checklist_template_items_response_check" CHECK ("checklist_template_items"."response_type" in ('confirmation', 'text', 'number', 'photo'))
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_code" varchar(100) NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"service_type" varchar(40),
	"required" boolean DEFAULT true NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "checklist_templates_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "checklist_templates_tenant_code_version_unique" UNIQUE("tenant_id","template_code","version"),
	CONSTRAINT "checklist_templates_version_check" CHECK ("checklist_templates"."version" > 0),
	CONSTRAINT "checklist_templates_service_check" CHECK ("checklist_templates"."service_type" is null or "checklist_templates"."service_type" in ('material_delivery', 'dump_trailer_rental')),
	CONSTRAINT "checklist_templates_status_check" CHECK ("checklist_templates"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "checklist_templates_publication_check" CHECK (("checklist_templates"."status" = 'draft' and "checklist_templates"."published_at" is null and "checklist_templates"."retired_at" is null) or ("checklist_templates"."status" = 'published' and "checklist_templates"."published_at" is not null and "checklist_templates"."retired_at" is null) or ("checklist_templates"."status" = 'retired' and "checklist_templates"."published_at" is not null and "checklist_templates"."retired_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "company_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"payment_method" varchar(30) NOT NULL,
	"account_reference" varchar(160) NOT NULL,
	"instructions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "company_payment_accounts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "company_payment_accounts_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "company_payment_accounts_method_check" CHECK ("company_payment_accounts"."payment_method" in ('cash', 'zelle', 'venmo', 'cash_app', 'paypal', 'card', 'bank_transfer', 'check')),
	CONSTRAINT "company_payment_accounts_reference_check" CHECK (length(trim("company_payment_accounts"."account_reference")) > 0),
	CONSTRAINT "company_payment_accounts_status_check" CHECK ("company_payment_accounts"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD COLUMN "checklist_template_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "company_payment_account_id" uuid;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_tenant_template_fk" FOREIGN KEY ("tenant_id","checklist_template_id") REFERENCES "public"."checklist_templates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_payment_accounts" ADD CONSTRAINT "company_payment_accounts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_template_items_tenant_template_idx" ON "checklist_template_items" USING btree ("tenant_id","checklist_template_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_templates_one_published_idx" ON "checklist_templates" USING btree ("tenant_id","template_code") WHERE "checklist_templates"."status" = 'published';--> statement-breakpoint
CREATE INDEX "checklist_templates_tenant_status_idx" ON "checklist_templates" USING btree ("tenant_id","status","template_code");--> statement-breakpoint
CREATE UNIQUE INDEX "company_payment_accounts_one_default_method_idx" ON "company_payment_accounts" USING btree ("tenant_id","payment_method") WHERE "company_payment_accounts"."is_default" = true and "company_payment_accounts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "company_payment_accounts_tenant_status_idx" ON "company_payment_accounts" USING btree ("tenant_id","status","payment_method");--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_tenant_template_fk" FOREIGN KEY ("tenant_id","checklist_template_id") REFERENCES "public"."checklist_templates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_company_account_fk" FOREIGN KEY ("tenant_id","company_payment_account_id") REFERENCES "public"."company_payment_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER company_payment_accounts_row_update BEFORE UPDATE ON company_payment_accounts
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER checklist_templates_row_update BEFORE UPDATE ON checklist_templates
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER checklist_template_items_row_update BEFORE UPDATE ON checklist_template_items
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_administration_configuration_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Administration configuration history cannot be deleted';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_checklist_template_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.template_code IS DISTINCT FROM OLD.template_code
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.service_type IS DISTINCT FROM OLD.service_type
    OR NEW.required IS DISTINCT FROM OLD.required
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'Published Checklist Templates are immutable';
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Draft Checklist Template transition is invalid';
  END IF;
  IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'retired') THEN
    RAISE EXCEPTION 'Published Checklist Template transition is invalid';
  END IF;
  IF OLD.status = 'retired' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Retired Checklist Templates are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_templates_update_guard BEFORE UPDATE ON checklist_templates
FOR EACH ROW EXECUTE FUNCTION enforce_checklist_template_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_checklist_template_item_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  template_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO template_status
    FROM checklist_templates
    WHERE tenant_id = OLD.tenant_id
      AND id = OLD.checklist_template_id;
  ELSE
    SELECT status INTO template_status
    FROM checklist_templates
    WHERE tenant_id = NEW.tenant_id
      AND id = NEW.checklist_template_id;
  END IF;

  IF template_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Published Checklist Template Items are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_template_items_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON checklist_template_items
FOR EACH ROW EXECUTE FUNCTION enforce_checklist_template_item_write();
--> statement-breakpoint
CREATE TRIGGER company_payment_accounts_no_delete_guard
BEFORE DELETE ON company_payment_accounts
FOR EACH ROW EXECUTE FUNCTION protect_administration_configuration_deletion();
--> statement-breakpoint
CREATE TRIGGER checklist_templates_no_delete_guard
BEFORE DELETE ON checklist_templates
FOR EACH ROW EXECUTE FUNCTION protect_administration_configuration_deletion();
--> statement-breakpoint
ALTER TABLE company_payment_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_payment_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_payment_accounts_tenant_isolation ON company_payment_accounts
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE checklist_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY checklist_templates_tenant_isolation ON checklist_templates
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE checklist_template_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY checklist_template_items_tenant_isolation ON checklist_template_items
USING (tenant_id = current_tenant_id())
WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  company_payment_accounts,
  checklist_templates,
  checklist_template_items
TO ldg_app;
