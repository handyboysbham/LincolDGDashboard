CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"base_fee_cents" bigint NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "delivery_zones_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "delivery_zones_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "delivery_zones_fee_check" CHECK ("delivery_zones"."base_fee_cents" >= 0),
	CONSTRAINT "delivery_zones_status_check" CHECK ("delivery_zones"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "estimate_cost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_version_id" uuid NOT NULL,
	"supplier_cost_version_id" uuid,
	"category" varchar(40) NOT NULL,
	"description" varchar(240) NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" varchar(30) NOT NULL,
	"unit_cost_cents" bigint NOT NULL,
	"total_cost_cents" bigint NOT NULL,
	"sequence" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "estimate_cost_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "estimate_cost_items_category_check" CHECK ("estimate_cost_items"."category" in ('material', 'delivery', 'disposal', 'operational', 'other')),
	CONSTRAINT "estimate_cost_items_quantity_check" CHECK ("estimate_cost_items"."quantity" > 0),
	CONSTRAINT "estimate_cost_items_unit_cost_check" CHECK ("estimate_cost_items"."unit_cost_cents" >= 0),
	CONSTRAINT "estimate_cost_items_total_cost_check" CHECK ("estimate_cost_items"."total_cost_cents" >= 0),
	CONSTRAINT "estimate_cost_items_sequence_check" CHECK ("estimate_cost_items"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "estimate_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"pricing_version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"service_type" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"operational_assessment" text,
	"risk_assessment" text,
	"readiness" varchar(40) DEFAULT 'ready' NOT NULL,
	"purchase_cost_cents" bigint NOT NULL,
	"recommended_price_cents" bigint NOT NULL,
	"approved_quote_price_cents" bigint,
	"deposit_cents" bigint NOT NULL,
	"margin_cents" bigint NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "estimate_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "estimate_versions_tenant_estimate_version_unique" UNIQUE("tenant_id","estimate_id","version_number"),
	CONSTRAINT "estimate_versions_version_check" CHECK ("estimate_versions"."version_number" > 0),
	CONSTRAINT "estimate_versions_service_check" CHECK ("estimate_versions"."service_type" in ('material_delivery', 'dump_trailer_rental')),
	CONSTRAINT "estimate_versions_status_check" CHECK ("estimate_versions"."status" in ('draft', 'pending_approval', 'approved', 'quote_generated', 'superseded')),
	CONSTRAINT "estimate_versions_readiness_check" CHECK ("estimate_versions"."readiness" in ('ready', 'ready_with_warnings', 'not_ready', 'evaluation_required')),
	CONSTRAINT "estimate_versions_purchase_cost_check" CHECK ("estimate_versions"."purchase_cost_cents" >= 0),
	CONSTRAINT "estimate_versions_recommended_price_check" CHECK ("estimate_versions"."recommended_price_cents" >= 0),
	CONSTRAINT "estimate_versions_approved_price_check" CHECK ("estimate_versions"."approved_quote_price_cents" is null or "estimate_versions"."approved_quote_price_cents" >= 0),
	CONSTRAINT "estimate_versions_deposit_check" CHECK ("estimate_versions"."deposit_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_number" varchar(40) NOT NULL,
	"lead_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "estimates_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "estimates_tenant_number_unique" UNIQUE("tenant_id","estimate_number"),
	CONSTRAINT "estimates_tenant_lead_unique" UNIQUE("tenant_id","lead_id"),
	CONSTRAINT "estimates_status_check" CHECK ("estimates"."status" in ('draft', 'in_analysis', 'pending_approval', 'approved', 'quote_generated'))
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"default_unit" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "materials_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "materials_tenant_name_unique" UNIQUE("tenant_id","normalized_name"),
	CONSTRAINT "materials_unit_check" CHECK ("materials"."default_unit" in ('tons', 'cubic_yards', 'loads')),
	CONSTRAINT "materials_status_check" CHECK ("materials"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "pricing_calculation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_version_id" uuid NOT NULL,
	"pricing_rule_id" uuid,
	"code" varchar(100) NOT NULL,
	"label" varchar(200) NOT NULL,
	"calculation_type" varchar(50) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"sequence" integer NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "pricing_calculation_results_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "pricing_calculation_results_tenant_version_code_unique" UNIQUE("tenant_id","estimate_version_id","code"),
	CONSTRAINT "pricing_calculation_results_amount_check" CHECK ("pricing_calculation_results"."amount_cents" >= 0),
	CONSTRAINT "pricing_calculation_results_sequence_check" CHECK ("pricing_calculation_results"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"service_type" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "pricing_policies_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "pricing_policies_tenant_name_service_unique" UNIQUE("tenant_id","name","service_type"),
	CONSTRAINT "pricing_policies_service_check" CHECK ("pricing_policies"."service_type" in ('material_delivery', 'dump_trailer_rental')),
	CONSTRAINT "pricing_policies_status_check" CHECK ("pricing_policies"."status" in ('draft', 'active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "pricing_rule_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pricing_rule_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"lower_bound" numeric(12, 3) NOT NULL,
	"upper_bound" numeric(12, 3),
	"fixed_amount_cents" bigint,
	"rate_cents_per_unit" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "pricing_rule_tiers_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "pricing_rule_tiers_tenant_rule_sequence_unique" UNIQUE("tenant_id","pricing_rule_id","sequence"),
	CONSTRAINT "pricing_rule_tiers_bounds_check" CHECK ("pricing_rule_tiers"."lower_bound" >= 0 and ("pricing_rule_tiers"."upper_bound" is null or "pricing_rule_tiers"."upper_bound" > "pricing_rule_tiers"."lower_bound")),
	CONSTRAINT "pricing_rule_tiers_amount_check" CHECK (("pricing_rule_tiers"."fixed_amount_cents" is not null and "pricing_rule_tiers"."fixed_amount_cents" >= 0) or ("pricing_rule_tiers"."rate_cents_per_unit" is not null and "pricing_rule_tiers"."rate_cents_per_unit" >= 0))
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pricing_version_id" uuid NOT NULL,
	"code" varchar(100) NOT NULL,
	"label" varchar(200) NOT NULL,
	"calculation_type" varchar(50) NOT NULL,
	"sequence" integer NOT NULL,
	"parameters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "pricing_rules_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "pricing_rules_tenant_version_code_unique" UNIQUE("tenant_id","pricing_version_id","code"),
	CONSTRAINT "pricing_rules_calculation_type_check" CHECK ("pricing_rules"."calculation_type" in ('fixed_amount', 'quantity_rate', 'percentage_markup', 'tiered_distance_rate', 'greater_of', 'minimum_charge', 'cost_plus_markup', 'additional_day', 'allowance_overage', 'controlled_rounding')),
	CONSTRAINT "pricing_rules_sequence_check" CHECK ("pricing_rules"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pricing_policy_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"effective_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "pricing_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "pricing_versions_tenant_policy_version_unique" UNIQUE("tenant_id","pricing_policy_id","version_number"),
	CONSTRAINT "pricing_versions_version_check" CHECK ("pricing_versions"."version_number" > 0),
	CONSTRAINT "pricing_versions_status_check" CHECK ("pricing_versions"."status" in ('draft', 'active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_number" varchar(40) NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"service_location_id" uuid NOT NULL,
	"accepted_quote_version_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"service_type" varchar(40) NOT NULL,
	"outcome_statement" text NOT NULL,
	"status" varchar(40) DEFAULT 'pending_setup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "projects_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "projects_tenant_number_unique" UNIQUE("tenant_id","project_number"),
	CONSTRAINT "projects_tenant_accepted_quote_unique" UNIQUE("tenant_id","accepted_quote_version_id"),
	CONSTRAINT "projects_service_check" CHECK ("projects"."service_type" in ('material_delivery', 'dump_trailer_rental')),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('pending_setup'))
);
--> statement-breakpoint
CREATE TABLE "quote_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"accepting_contact_id" uuid NOT NULL,
	"accepted_name" varchar(200) NOT NULL,
	"acceptance_method" varchar(40) NOT NULL,
	"consent_text" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "quote_acceptances_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "quote_acceptances_tenant_version_unique" UNIQUE("tenant_id","quote_version_id"),
	CONSTRAINT "quote_acceptances_method_check" CHECK ("quote_acceptances"."acceptance_method" in ('typed_name', 'staff_recorded'))
);
--> statement-breakpoint
CREATE TABLE "quote_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"channel" varchar(30) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"status" varchar(30) DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_reference" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "quote_deliveries_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "quote_deliveries_channel_check" CHECK ("quote_deliveries"."channel" in ('email', 'text', 'link')),
	CONSTRAINT "quote_deliveries_status_check" CHECK ("quote_deliveries"."status" in ('sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"description" varchar(300) NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" varchar(40) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "quote_line_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "quote_line_items_quantity_check" CHECK ("quote_line_items"."quantity" > 0),
	CONSTRAINT "quote_line_items_unit_price_check" CHECK ("quote_line_items"."unit_price_cents" >= 0),
	CONSTRAINT "quote_line_items_total_check" CHECK ("quote_line_items"."total_cents" >= 0),
	CONSTRAINT "quote_line_items_sequence_check" CHECK ("quote_line_items"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_public_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"creation_key_hash" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "quote_public_links_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "quote_public_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "quote_public_links_tenant_creation_key_unique" UNIQUE("tenant_id","creation_key_hash"),
	CONSTRAINT "quote_public_links_expiry_check" CHECK ("quote_public_links"."expires_at" > "quote_public_links"."created_at"),
	CONSTRAINT "quote_public_links_view_count_check" CHECK ("quote_public_links"."view_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "quote_terms_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "quote_terms_sequence_check" CHECK ("quote_terms"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"estimate_version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"customer_snapshot" jsonb NOT NULL,
	"location_snapshot" jsonb NOT NULL,
	"scope" text NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"adjustment_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"required_deposit_cents" bigint NOT NULL,
	"issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"content_hash" varchar(64) NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "quote_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "quote_versions_tenant_quote_version_unique" UNIQUE("tenant_id","quote_id","version_number"),
	CONSTRAINT "quote_versions_version_check" CHECK ("quote_versions"."version_number" > 0),
	CONSTRAINT "quote_versions_status_check" CHECK ("quote_versions"."status" in ('draft', 'ready_to_send', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'superseded')),
	CONSTRAINT "quote_versions_subtotal_check" CHECK ("quote_versions"."subtotal_cents" >= 0),
	CONSTRAINT "quote_versions_tax_check" CHECK ("quote_versions"."tax_cents" >= 0),
	CONSTRAINT "quote_versions_total_check" CHECK ("quote_versions"."total_cents" >= 0),
	CONSTRAINT "quote_versions_deposit_check" CHECK ("quote_versions"."required_deposit_cents" >= 0 and "quote_versions"."required_deposit_cents" <= "quote_versions"."total_cents")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_number" varchar(40) NOT NULL,
	"estimate_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"primary_contact_id" uuid NOT NULL,
	"service_location_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "quotes_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "quotes_tenant_number_unique" UNIQUE("tenant_id","quote_number"),
	CONSTRAINT "quotes_tenant_estimate_unique" UNIQUE("tenant_id","estimate_id"),
	CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" in ('draft', 'ready_to_send', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "supplier_cost_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_material_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"unit_cost_cents" bigint NOT NULL,
	"unit" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_cost_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_cost_versions_tenant_material_version_unique" UNIQUE("tenant_id","supplier_material_id","version_number"),
	CONSTRAINT "supplier_cost_versions_cost_check" CHECK ("supplier_cost_versions"."unit_cost_cents" >= 0),
	CONSTRAINT "supplier_cost_versions_unit_check" CHECK ("supplier_cost_versions"."unit" in ('tons', 'cubic_yards', 'loads')),
	CONSTRAINT "supplier_cost_versions_status_check" CHECK ("supplier_cost_versions"."status" in ('active', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "supplier_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"label" varchar(160) NOT NULL,
	"address_summary" varchar(400),
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_locations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_locations_tenant_supplier_label_unique" UNIQUE("tenant_id","supplier_id","label"),
	CONSTRAINT "supplier_locations_status_check" CHECK ("supplier_locations"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "supplier_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_location_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_materials_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_materials_tenant_location_material_unique" UNIQUE("tenant_id","supplier_location_id","material_id"),
	CONSTRAINT "supplier_materials_status_check" CHECK ("supplier_materials"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "suppliers_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_tenant_name_unique" UNIQUE("tenant_id","normalized_name"),
	CONSTRAINT "suppliers_status_check" CHECK ("suppliers"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_cost_items" ADD CONSTRAINT "estimate_cost_items_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_cost_items" ADD CONSTRAINT "estimate_cost_items_tenant_version_fk" FOREIGN KEY ("tenant_id","estimate_version_id") REFERENCES "public"."estimate_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_cost_items" ADD CONSTRAINT "estimate_cost_items_tenant_supplier_cost_fk" FOREIGN KEY ("tenant_id","supplier_cost_version_id") REFERENCES "public"."supplier_cost_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_tenant_estimate_fk" FOREIGN KEY ("tenant_id","estimate_id") REFERENCES "public"."estimates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_tenant_pricing_fk" FOREIGN KEY ("tenant_id","pricing_version_id") REFERENCES "public"."pricing_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_tenant_approver_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_tenant_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_calculation_results" ADD CONSTRAINT "pricing_calculation_results_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_calculation_results" ADD CONSTRAINT "pricing_calculation_results_tenant_version_fk" FOREIGN KEY ("tenant_id","estimate_version_id") REFERENCES "public"."estimate_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_calculation_results" ADD CONSTRAINT "pricing_calculation_results_tenant_rule_fk" FOREIGN KEY ("tenant_id","pricing_rule_id") REFERENCES "public"."pricing_rules"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_policies" ADD CONSTRAINT "pricing_policies_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rule_tiers" ADD CONSTRAINT "pricing_rule_tiers_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rule_tiers" ADD CONSTRAINT "pricing_rule_tiers_tenant_rule_fk" FOREIGN KEY ("tenant_id","pricing_rule_id") REFERENCES "public"."pricing_rules"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenant_version_fk" FOREIGN KEY ("tenant_id","pricing_version_id") REFERENCES "public"."pricing_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_tenant_policy_fk" FOREIGN KEY ("tenant_id","pricing_policy_id") REFERENCES "public"."pricing_policies"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."customer_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_customer_location_fk" FOREIGN KEY ("tenant_id","customer_account_id","service_location_id") REFERENCES "public"."service_locations"("tenant_id","customer_account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_quote_version_fk" FOREIGN KEY ("tenant_id","accepted_quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_tenant_version_fk" FOREIGN KEY ("tenant_id","quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_tenant_contact_fk" FOREIGN KEY ("tenant_id","accepting_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_deliveries" ADD CONSTRAINT "quote_deliveries_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_deliveries" ADD CONSTRAINT "quote_deliveries_tenant_version_fk" FOREIGN KEY ("tenant_id","quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_tenant_version_fk" FOREIGN KEY ("tenant_id","quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_public_links" ADD CONSTRAINT "quote_public_links_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_public_links" ADD CONSTRAINT "quote_public_links_tenant_version_fk" FOREIGN KEY ("tenant_id","quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_terms" ADD CONSTRAINT "quote_terms_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_terms" ADD CONSTRAINT "quote_terms_tenant_version_fk" FOREIGN KEY ("tenant_id","quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tenant_estimate_version_fk" FOREIGN KEY ("tenant_id","estimate_version_id") REFERENCES "public"."estimate_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tenant_approver_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_estimate_fk" FOREIGN KEY ("tenant_id","estimate_id") REFERENCES "public"."estimates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."customer_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_customer_contact_fk" FOREIGN KEY ("tenant_id","customer_account_id","primary_contact_id") REFERENCES "public"."account_contacts"("tenant_id","customer_account_id","contact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_customer_location_fk" FOREIGN KEY ("tenant_id","customer_account_id","service_location_id") REFERENCES "public"."service_locations"("tenant_id","customer_account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_cost_versions" ADD CONSTRAINT "supplier_cost_versions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_cost_versions" ADD CONSTRAINT "supplier_cost_versions_tenant_material_fk" FOREIGN KEY ("tenant_id","supplier_material_id") REFERENCES "public"."supplier_materials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD CONSTRAINT "supplier_locations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD CONSTRAINT "supplier_locations_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_tenant_location_fk" FOREIGN KEY ("tenant_id","supplier_location_id") REFERENCES "public"."supplier_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_tenant_material_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_zones_tenant_status_idx" ON "delivery_zones" USING btree ("tenant_id","status","name");--> statement-breakpoint
CREATE INDEX "estimate_cost_items_tenant_version_sequence_idx" ON "estimate_cost_items" USING btree ("tenant_id","estimate_version_id","sequence");--> statement-breakpoint
CREATE INDEX "estimate_versions_tenant_estimate_status_idx" ON "estimate_versions" USING btree ("tenant_id","estimate_id","status","version_number");--> statement-breakpoint
CREATE INDEX "estimates_tenant_status_created_idx" ON "estimates" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "materials_tenant_status_idx" ON "materials" USING btree ("tenant_id","status","name");--> statement-breakpoint
CREATE INDEX "pricing_calculation_results_tenant_version_sequence_idx" ON "pricing_calculation_results" USING btree ("tenant_id","estimate_version_id","sequence");--> statement-breakpoint
CREATE INDEX "pricing_policies_tenant_service_status_idx" ON "pricing_policies" USING btree ("tenant_id","service_type","status");--> statement-breakpoint
CREATE INDEX "pricing_rule_tiers_tenant_rule_idx" ON "pricing_rule_tiers" USING btree ("tenant_id","pricing_rule_id","sequence");--> statement-breakpoint
CREATE INDEX "pricing_rules_tenant_version_sequence_idx" ON "pricing_rules" USING btree ("tenant_id","pricing_version_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_versions_one_active_idx" ON "pricing_versions" USING btree ("tenant_id","pricing_policy_id") WHERE "pricing_versions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "pricing_versions_tenant_status_idx" ON "pricing_versions" USING btree ("tenant_id","status","effective_at");--> statement-breakpoint
CREATE INDEX "projects_tenant_customer_status_idx" ON "projects" USING btree ("tenant_id","customer_account_id","status");--> statement-breakpoint
CREATE INDEX "quote_acceptances_tenant_accepted_idx" ON "quote_acceptances" USING btree ("tenant_id","accepted_at");--> statement-breakpoint
CREATE INDEX "quote_deliveries_tenant_version_idx" ON "quote_deliveries" USING btree ("tenant_id","quote_version_id","sent_at");--> statement-breakpoint
CREATE INDEX "quote_line_items_tenant_version_sequence_idx" ON "quote_line_items" USING btree ("tenant_id","quote_version_id","sequence");--> statement-breakpoint
CREATE INDEX "quote_public_links_tenant_version_idx" ON "quote_public_links" USING btree ("tenant_id","quote_version_id","expires_at");--> statement-breakpoint
CREATE INDEX "quote_terms_tenant_version_sequence_idx" ON "quote_terms" USING btree ("tenant_id","quote_version_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_versions_one_accepted_idx" ON "quote_versions" USING btree ("tenant_id","quote_id") WHERE "quote_versions"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "quote_versions_tenant_quote_status_idx" ON "quote_versions" USING btree ("tenant_id","quote_id","status","version_number");--> statement-breakpoint
CREATE INDEX "quote_versions_tenant_expiry_idx" ON "quote_versions" USING btree ("tenant_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "quotes_tenant_status_created_idx" ON "quotes" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "quotes_tenant_customer_idx" ON "quotes" USING btree ("tenant_id","customer_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_cost_versions_one_active_idx" ON "supplier_cost_versions" USING btree ("tenant_id","supplier_material_id") WHERE "supplier_cost_versions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "supplier_cost_versions_tenant_effective_idx" ON "supplier_cost_versions" USING btree ("tenant_id","supplier_material_id","effective_at");--> statement-breakpoint
CREATE INDEX "supplier_locations_tenant_supplier_idx" ON "supplier_locations" USING btree ("tenant_id","supplier_id","status");--> statement-breakpoint
CREATE INDEX "supplier_materials_tenant_material_idx" ON "supplier_materials" USING btree ("tenant_id","material_id","status");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_status_idx" ON "suppliers" USING btree ("tenant_id","status","name");
--> statement-breakpoint
CREATE FUNCTION protect_supplier_cost_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'superseded Supplier Cost Versions are immutable';
  END IF;
  IF NEW.supplier_material_id IS DISTINCT FROM OLD.supplier_material_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.unit_cost_cents IS DISTINCT FROM OLD.unit_cost_cents
    OR NEW.unit IS DISTINCT FROM OLD.unit
    OR NEW.effective_at IS DISTINCT FROM OLD.effective_at THEN
    RAISE EXCEPTION 'Supplier Cost Version content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_cost_versions_content_guard
BEFORE UPDATE ON supplier_cost_versions
FOR EACH ROW EXECUTE FUNCTION protect_supplier_cost_content();
--> statement-breakpoint
CREATE FUNCTION protect_pricing_version_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('active', 'retired')
    AND (NEW.pricing_policy_id IS DISTINCT FROM OLD.pricing_policy_id
      OR NEW.version_number IS DISTINCT FROM OLD.version_number) THEN
    RAISE EXCEPTION 'active or retired Pricing Version content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pricing_versions_content_guard
BEFORE UPDATE ON pricing_versions
FOR EACH ROW EXECUTE FUNCTION protect_pricing_version_content();
--> statement-breakpoint
CREATE FUNCTION protect_pricing_rule_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status varchar(30);
  version_id uuid;
BEGIN
  version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.pricing_version_id ELSE NEW.pricing_version_id END;
  SELECT status INTO version_status
  FROM pricing_versions
  WHERE tenant_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
    AND id = version_id;
  IF version_status IN ('active', 'retired') THEN
    RAISE EXCEPTION 'rules belonging to an active or retired Pricing Version are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pricing_rules_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON pricing_rules
FOR EACH ROW EXECUTE FUNCTION protect_pricing_rule_content();
--> statement-breakpoint
CREATE FUNCTION protect_pricing_tier_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status varchar(30);
  rule_id uuid;
BEGIN
  rule_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.pricing_rule_id ELSE NEW.pricing_rule_id END;
  SELECT pv.status INTO version_status
  FROM pricing_rules pr
  JOIN pricing_versions pv ON pv.tenant_id = pr.tenant_id AND pv.id = pr.pricing_version_id
  WHERE pr.tenant_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
    AND pr.id = rule_id;
  IF version_status IN ('active', 'retired') THEN
    RAISE EXCEPTION 'tiers belonging to an active or retired Pricing Version are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pricing_rule_tiers_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON pricing_rule_tiers
FOR EACH ROW EXECUTE FUNCTION protect_pricing_tier_content();
--> statement-breakpoint
CREATE FUNCTION protect_estimate_version_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('approved', 'quote_generated', 'superseded')
    AND (NEW.estimate_id IS DISTINCT FROM OLD.estimate_id
      OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
      OR NEW.version_number IS DISTINCT FROM OLD.version_number
      OR NEW.service_type IS DISTINCT FROM OLD.service_type
      OR NEW.input_snapshot IS DISTINCT FROM OLD.input_snapshot
      OR NEW.operational_assessment IS DISTINCT FROM OLD.operational_assessment
      OR NEW.risk_assessment IS DISTINCT FROM OLD.risk_assessment
      OR NEW.readiness IS DISTINCT FROM OLD.readiness
      OR NEW.purchase_cost_cents IS DISTINCT FROM OLD.purchase_cost_cents
      OR NEW.recommended_price_cents IS DISTINCT FROM OLD.recommended_price_cents
      OR NEW.approved_quote_price_cents IS DISTINCT FROM OLD.approved_quote_price_cents
      OR NEW.deposit_cents IS DISTINCT FROM OLD.deposit_cents
      OR NEW.margin_cents IS DISTINCT FROM OLD.margin_cents
      OR NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
    RAISE EXCEPTION 'approved Estimate Version content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER estimate_versions_content_guard
BEFORE UPDATE ON estimate_versions
FOR EACH ROW EXECUTE FUNCTION protect_estimate_version_content();
--> statement-breakpoint
CREATE FUNCTION protect_estimate_child_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status varchar(30);
  version_id uuid;
BEGIN
  version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.estimate_version_id ELSE NEW.estimate_version_id END;
  SELECT status INTO version_status
  FROM estimate_versions
  WHERE tenant_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
    AND id = version_id;
  IF version_status IN ('approved', 'quote_generated', 'superseded') THEN
    RAISE EXCEPTION 'approved Estimate Version child content is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER estimate_cost_items_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON estimate_cost_items
FOR EACH ROW EXECUTE FUNCTION protect_estimate_child_content();
--> statement-breakpoint
CREATE TRIGGER pricing_calculation_results_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON pricing_calculation_results
FOR EACH ROW EXECUTE FUNCTION protect_estimate_child_content();
--> statement-breakpoint
CREATE FUNCTION protect_quote_version_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'superseded')
    AND (NEW.quote_id IS DISTINCT FROM OLD.quote_id
      OR NEW.estimate_version_id IS DISTINCT FROM OLD.estimate_version_id
      OR NEW.version_number IS DISTINCT FROM OLD.version_number
      OR NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot
      OR NEW.location_snapshot IS DISTINCT FROM OLD.location_snapshot
      OR NEW.scope IS DISTINCT FROM OLD.scope
      OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
      OR NEW.adjustment_cents IS DISTINCT FROM OLD.adjustment_cents
      OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
      OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
      OR NEW.required_deposit_cents IS DISTINCT FROM OLD.required_deposit_cents
      OR NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
    RAISE EXCEPTION 'sent or terminal Quote Version content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quote_versions_content_guard
BEFORE UPDATE ON quote_versions
FOR EACH ROW EXECUTE FUNCTION protect_quote_version_content();
--> statement-breakpoint
CREATE FUNCTION protect_quote_child_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status varchar(30);
  version_id uuid;
BEGIN
  version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.quote_version_id ELSE NEW.quote_version_id END;
  SELECT status INTO version_status
  FROM quote_versions
  WHERE tenant_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
    AND id = version_id;
  IF version_status IN ('sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'superseded') THEN
    RAISE EXCEPTION 'sent or terminal Quote Version commercial content is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quote_line_items_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON quote_line_items
FOR EACH ROW EXECUTE FUNCTION protect_quote_child_content();
--> statement-breakpoint
CREATE TRIGGER quote_terms_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON quote_terms
FOR EACH ROW EXECUTE FUNCTION protect_quote_child_content();
--> statement-breakpoint
CREATE FUNCTION protect_quote_acceptance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Quote Acceptances are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quote_acceptances_immutable_guard
BEFORE UPDATE OR DELETE ON quote_acceptances
FOR EACH ROW EXECUTE FUNCTION protect_quote_acceptance();
--> statement-breakpoint
CREATE TRIGGER delivery_zones_row_update BEFORE UPDATE ON delivery_zones FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER estimate_cost_items_row_update BEFORE UPDATE ON estimate_cost_items FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER estimate_versions_row_update BEFORE UPDATE ON estimate_versions FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER estimates_row_update BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER materials_row_update BEFORE UPDATE ON materials FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER pricing_calculation_results_row_update BEFORE UPDATE ON pricing_calculation_results FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER pricing_policies_row_update BEFORE UPDATE ON pricing_policies FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER pricing_rule_tiers_row_update BEFORE UPDATE ON pricing_rule_tiers FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER pricing_rules_row_update BEFORE UPDATE ON pricing_rules FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER pricing_versions_row_update BEFORE UPDATE ON pricing_versions FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER projects_row_update BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER quote_deliveries_row_update BEFORE UPDATE ON quote_deliveries FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER quote_line_items_row_update BEFORE UPDATE ON quote_line_items FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER quote_public_links_row_update BEFORE UPDATE ON quote_public_links FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER quote_terms_row_update BEFORE UPDATE ON quote_terms FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER quote_versions_row_update BEFORE UPDATE ON quote_versions FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER quotes_row_update BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER supplier_cost_versions_row_update BEFORE UPDATE ON supplier_cost_versions FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER supplier_locations_row_update BEFORE UPDATE ON supplier_locations FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER supplier_materials_row_update BEFORE UPDATE ON supplier_materials FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER suppliers_row_update BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'delivery_zones', 'estimate_cost_items', 'estimate_versions', 'estimates', 'materials',
    'pricing_calculation_results', 'pricing_policies', 'pricing_rule_tiers', 'pricing_rules',
    'pricing_versions', 'projects', 'quote_acceptances', 'quote_deliveries', 'quote_line_items',
    'quote_public_links', 'quote_terms', 'quote_versions', 'quotes', 'supplier_cost_versions',
    'supplier_locations', 'supplier_materials', 'suppliers'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON delivery_zones, estimate_cost_items, estimate_versions, estimates, materials,
  pricing_calculation_results, pricing_policies, pricing_rule_tiers, pricing_rules, pricing_versions,
  projects, quote_acceptances, quote_deliveries, quote_line_items, quote_public_links, quote_terms,
  quote_versions, quotes, supplier_cost_versions, supplier_locations, supplier_materials, suppliers
  FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_zones, estimate_cost_items, estimate_versions,
      estimates, materials, pricing_calculation_results, pricing_policies, pricing_rule_tiers,
      pricing_rules, pricing_versions, projects, quote_acceptances, quote_deliveries,
      quote_line_items, quote_public_links, quote_terms, quote_versions, quotes,
      supplier_cost_versions, supplier_locations, supplier_materials, suppliers TO ldg_app;
  END IF;
END;
$$;
