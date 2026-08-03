CREATE TABLE "account_contacts" (
	"tenant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" varchar(30) DEFAULT 'primary' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "account_contacts_tenant_id_customer_account_id_contact_id_pk" PRIMARY KEY("tenant_id","customer_account_id","contact_id"),
	CONSTRAINT "account_contacts_role_check" CHECK ("account_contacts"."role" in ('primary', 'billing', 'site', 'other'))
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"email" varchar(320),
	"normalized_email" varchar(320),
	"phone" varchar(40),
	"normalized_phone" varchar(30),
	"preferred_contact_method" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "contacts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "contacts_status_check" CHECK ("contacts"."status" in ('active', 'inactive')),
	CONSTRAINT "contacts_contact_method_check" CHECK ("contacts"."preferred_contact_method" in ('phone', 'email', 'text')),
	CONSTRAINT "contacts_reachable_check" CHECK ("contacts"."normalized_email" is not null or "contacts"."normalized_phone" is not null)
);
--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"customer_type" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"preferred_contact_method" varchar(30),
	"billing_contact_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "customer_accounts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_accounts_type_check" CHECK ("customer_accounts"."customer_type" in ('individual', 'business')),
	CONSTRAINT "customer_accounts_status_check" CHECK ("customer_accounts"."status" in ('active', 'inactive')),
	CONSTRAINT "customer_accounts_contact_method_check" CHECK ("customer_accounts"."preferred_contact_method" is null or "customer_accounts"."preferred_contact_method" in ('phone', 'email', 'text')),
	CONSTRAINT "customer_accounts_normalized_name_check" CHECK (length("customer_accounts"."normalized_name") > 0)
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" varchar(30) DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "lead_notes_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "lead_notes_visibility_check" CHECK ("lead_notes"."visibility" in ('internal', 'customer'))
);
--> statement-breakpoint
CREATE TABLE "lead_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"assigned_user_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "lead_tasks_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "lead_tasks_status_check" CHECK ("lead_tasks"."status" in ('open', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_number" varchar(40) NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"primary_contact_id" uuid NOT NULL,
	"service_location_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"service_type" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'new' NOT NULL,
	"source" varchar(30) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"material_description" varchar(240),
	"estimated_quantity" numeric(12, 3),
	"quantity_unit" varchar(30),
	"rental_start_date" date,
	"rental_end_date" date,
	"debris_type" varchar(160),
	"service_instructions" text,
	"terminal_reason" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "leads_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "leads_tenant_number_unique" UNIQUE("tenant_id","lead_number"),
	CONSTRAINT "leads_service_type_check" CHECK ("leads"."service_type" in ('material_delivery', 'dump_trailer_rental')),
	CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('new', 'contacting', 'qualified', 'estimating', 'quoted', 'accepted', 'lost', 'cancelled', 'duplicate', 'disqualified')),
	CONSTRAINT "leads_source_check" CHECK ("leads"."source" in ('phone', 'website', 'email', 'referral', 'repeat', 'other')),
	CONSTRAINT "leads_service_details_check" CHECK ((
        "leads"."service_type" = 'material_delivery'
        and "leads"."material_description" is not null
        and "leads"."estimated_quantity" is not null
        and "leads"."estimated_quantity" > 0
        and "leads"."quantity_unit" in ('tons', 'cubic_yards', 'loads')
        and "leads"."rental_start_date" is null
        and "leads"."rental_end_date" is null
        and "leads"."debris_type" is null
      ) or (
        "leads"."service_type" = 'dump_trailer_rental'
        and "leads"."material_description" is null
        and "leads"."estimated_quantity" is null
        and "leads"."quantity_unit" is null
        and "leads"."rental_start_date" is not null
        and "leads"."rental_end_date" is not null
        and "leads"."rental_end_date" >= "leads"."rental_start_date"
        and "leads"."debris_type" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "location_contacts" (
	"tenant_id" uuid NOT NULL,
	"service_location_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" varchar(30) DEFAULT 'site' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "location_contacts_tenant_id_service_location_id_contact_id_pk" PRIMARY KEY("tenant_id","service_location_id","contact_id"),
	CONSTRAINT "location_contacts_role_check" CHECK ("location_contacts"."role" in ('site', 'access', 'other'))
);
--> statement-breakpoint
CREATE TABLE "service_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"address_line_1" varchar(200) NOT NULL,
	"address_line_2" varchar(200),
	"city" varchar(120) NOT NULL,
	"region" varchar(80) NOT NULL,
	"postal_code" varchar(20) NOT NULL,
	"normalized_address" varchar(600) NOT NULL,
	"access_notes" text,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "service_locations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_locations_tenant_customer_id_unique" UNIQUE("tenant_id","customer_account_id","id"),
	CONSTRAINT "service_locations_status_check" CHECK ("service_locations"."status" in ('active', 'inactive')),
	CONSTRAINT "service_locations_address_check" CHECK (length("service_locations"."normalized_address") > 0)
);
--> statement-breakpoint
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."customer_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_tenant_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_tenant_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_tenant_assignee_fk" FOREIGN KEY ("tenant_id","assigned_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."customer_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_customer_contact_fk" FOREIGN KEY ("tenant_id","customer_account_id","primary_contact_id") REFERENCES "public"."account_contacts"("tenant_id","customer_account_id","contact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_customer_location_fk" FOREIGN KEY ("tenant_id","customer_account_id","service_location_id") REFERENCES "public"."service_locations"("tenant_id","customer_account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_contacts" ADD CONSTRAINT "location_contacts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_contacts" ADD CONSTRAINT "location_contacts_tenant_location_fk" FOREIGN KEY ("tenant_id","service_location_id") REFERENCES "public"."service_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_contacts" ADD CONSTRAINT "location_contacts_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."customer_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_contacts_tenant_contact_idx" ON "account_contacts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_contacts_one_primary_idx" ON "account_contacts" USING btree ("tenant_id","customer_account_id") WHERE "account_contacts"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "contacts_tenant_email_idx" ON "contacts" USING btree ("tenant_id","normalized_email");--> statement-breakpoint
CREATE INDEX "contacts_tenant_phone_idx" ON "contacts" USING btree ("tenant_id","normalized_phone");--> statement-breakpoint
CREATE INDEX "customer_accounts_tenant_name_idx" ON "customer_accounts" USING btree ("tenant_id","normalized_name");--> statement-breakpoint
CREATE INDEX "customer_accounts_tenant_status_idx" ON "customer_accounts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "lead_notes_tenant_lead_created_idx" ON "lead_notes" USING btree ("tenant_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_tasks_tenant_lead_status_idx" ON "lead_tasks" USING btree ("tenant_id","lead_id","status");--> statement-breakpoint
CREATE INDEX "lead_tasks_tenant_assignee_due_idx" ON "lead_tasks" USING btree ("tenant_id","assigned_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "leads_tenant_status_created_idx" ON "leads" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "leads_tenant_customer_idx" ON "leads" USING btree ("tenant_id","customer_account_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_tenant_owner_status_idx" ON "leads" USING btree ("tenant_id","owner_user_id","status");--> statement-breakpoint
CREATE INDEX "location_contacts_tenant_contact_idx" ON "location_contacts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "service_locations_tenant_customer_idx" ON "service_locations" USING btree ("tenant_id","customer_account_id","status");--> statement-breakpoint
CREATE INDEX "service_locations_tenant_address_idx" ON "service_locations" USING btree ("tenant_id","normalized_address");
--> statement-breakpoint
CREATE TRIGGER customer_accounts_row_update
BEFORE UPDATE ON customer_accounts
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER contacts_row_update
BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER service_locations_row_update
BEFORE UPDATE ON service_locations
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER leads_row_update
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER lead_notes_row_update
BEFORE UPDATE ON lead_notes
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER lead_tasks_row_update
BEFORE UPDATE ON lead_tasks
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_accounts_tenant_isolation ON customer_accounts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY contacts_tenant_isolation ON contacts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE account_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY account_contacts_tenant_isolation ON account_contacts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE service_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY service_locations_tenant_isolation ON service_locations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE location_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY location_contacts_tenant_isolation ON location_contacts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
CREATE POLICY leads_tenant_isolation ON leads
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_notes_tenant_isolation ON lead_notes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE lead_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_tasks_tenant_isolation ON lead_tasks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
REVOKE ALL ON customer_accounts, contacts, account_contacts, service_locations, location_contacts,
  leads, lead_notes, lead_tasks FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON customer_accounts, contacts, account_contacts,
      service_locations, location_contacts, leads, lead_notes, lead_tasks TO ldg_app;
  END IF;
END;
$$;
