CREATE EXTENSION IF NOT EXISTS "btree_gist";
--> statement-breakpoint
CREATE TABLE "asset_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"schedule_block_id" uuid,
	"asset_id" uuid NOT NULL,
	"role" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'assigned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "asset_assignments_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "asset_assignments_tenant_job_block_asset_role_unique" UNIQUE("tenant_id","job_id","schedule_block_id","asset_id","role"),
	CONSTRAINT "asset_assignments_role_check" CHECK ("asset_assignments"."role" in ('truck', 'trailer', 'equipment')),
	CONSTRAINT "asset_assignments_status_check" CHECK ("asset_assignments"."status" in ('assigned', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "asset_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"schedule_block_id" uuid,
	"reservation_type" varchar(30) DEFAULT 'schedule' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "asset_reservations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "asset_reservations_type_check" CHECK ("asset_reservations"."reservation_type" in ('schedule', 'occupancy')),
	CONSTRAINT "asset_reservations_status_check" CHECK ("asset_reservations"."status" in ('active', 'released', 'cancelled')),
	CONSTRAINT "asset_reservations_range_check" CHECK ("asset_reservations"."ends_at" > "asset_reservations"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_number" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"asset_type" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'available' NOT NULL,
	"capacity_weight" numeric(14, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "assets_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "assets_tenant_number_unique" UNIQUE("tenant_id","asset_number"),
	CONSTRAINT "assets_type_check" CHECK ("assets"."asset_type" in ('truck', 'trailer', 'equipment')),
	CONSTRAINT "assets_status_check" CHECK ("assets"."status" in ('available', 'in_use', 'out_of_service', 'retired')),
	CONSTRAINT "assets_capacity_check" CHECK ("assets"."capacity_weight" is null or "assets"."capacity_weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "checklist_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"schedule_block_id" uuid,
	"template_code" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "checklist_instances_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "checklist_instances_tenant_job_template_unique" UNIQUE("tenant_id","job_id","template_code"),
	CONSTRAINT "checklist_instances_status_check" CHECK ("checklist_instances"."status" in ('open', 'in_progress', 'completed', 'waived'))
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checklist_instance_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"label" varchar(240) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"response" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "checklist_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "checklist_items_tenant_instance_sequence_unique" UNIQUE("tenant_id","checklist_instance_id","sequence"),
	CONSTRAINT "checklist_items_sequence_check" CHECK ("checklist_items"."sequence" > 0),
	CONSTRAINT "checklist_items_status_check" CHECK ("checklist_items"."status" in ('pending', 'completed', 'failed', 'not_applicable'))
);
--> statement-breakpoint
CREATE TABLE "contract_public_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"creation_key_hash" varchar(64) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_public_links_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "contract_public_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "contract_public_links_tenant_creation_key_unique" UNIQUE("tenant_id","creation_key_hash"),
	CONSTRAINT "contract_public_links_expiry_check" CHECK ("contract_public_links"."expires_at" > "contract_public_links"."created_at"),
	CONSTRAINT "contract_public_links_view_count_check" CHECK ("contract_public_links"."view_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contract_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"signer_role" varchar(30) NOT NULL,
	"signer_user_id" uuid,
	"signer_contact_id" uuid,
	"typed_name" varchar(200) NOT NULL,
	"consent_text" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_signatures_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "contract_signatures_tenant_contract_role_unique" UNIQUE("tenant_id","contract_id","signer_role"),
	CONSTRAINT "contract_signatures_role_check" CHECK ("contract_signatures"."signer_role" in ('business', 'customer')),
	CONSTRAINT "contract_signatures_subject_check" CHECK (("contract_signatures"."signer_role" = 'business' and "contract_signatures"."signer_user_id" is not null and "contract_signatures"."signer_contact_id" is null) or ("contract_signatures"."signer_role" = 'customer' and "contract_signatures"."signer_contact_id" is not null and "contract_signatures"."signer_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_number" varchar(40) NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"status" varchar(40) DEFAULT 'draft' NOT NULL,
	"content_snapshot" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "contracts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "contracts_tenant_project_unique" UNIQUE("tenant_id","project_id"),
	CONSTRAINT "contracts_tenant_number_unique" UNIQUE("tenant_id","contract_number"),
	CONSTRAINT "contracts_version_check" CHECK ("contracts"."version_number" > 0),
	CONSTRAINT "contracts_status_check" CHECK ("contracts"."status" in ('draft', 'business_signed', 'sent', 'viewed', 'executed', 'voided'))
);
--> statement-breakpoint
CREATE TABLE "job_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"schedule_block_id" uuid,
	"user_id" uuid NOT NULL,
	"role" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'assigned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "job_assignments_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "job_assignments_tenant_job_block_user_role_unique" UNIQUE("tenant_id","job_id","schedule_block_id","user_id","role"),
	CONSTRAINT "job_assignments_role_check" CHECK ("job_assignments"."role" in ('driver', 'dispatcher', 'crew')),
	CONSTRAINT "job_assignments_status_check" CHECK ("job_assignments"."status" in ('assigned', 'declined', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_events_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"job_number" varchar(40) NOT NULL,
	"service_type" varchar(40) NOT NULL,
	"status" varchar(40) DEFAULT 'new' NOT NULL,
	"readiness" varchar(40) DEFAULT 'evaluation_required' NOT NULL,
	"scheduled_start_at" timestamp with time zone,
	"scheduled_end_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"operationally_completed_at" timestamp with time zone,
	"financially_completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "jobs_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "jobs_tenant_number_unique" UNIQUE("tenant_id","job_number"),
	CONSTRAINT "jobs_service_check" CHECK ("jobs"."service_type" in ('material_delivery', 'dump_trailer_rental')),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('new', 'planning', 'needs_scheduling', 'scheduled', 'dispatch_ready', 'active', 'operationally_complete', 'awaiting_final_invoice', 'invoiced', 'financially_complete', 'closed', 'on_hold', 'cancelled')),
	CONSTRAINT "jobs_readiness_check" CHECK ("jobs"."readiness" in ('ready', 'ready_with_warnings', 'not_ready', 'evaluation_required')),
	CONSTRAINT "jobs_schedule_range_check" CHECK ("jobs"."scheduled_start_at" is null or "jobs"."scheduled_end_at" is null or "jobs"."scheduled_end_at" > "jobs"."scheduled_start_at")
);
--> statement-breakpoint
CREATE TABLE "operational_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"job_id" uuid,
	"reason" text NOT NULL,
	"previous_status" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"placed_by" uuid NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "operational_holds_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "operational_holds_owner_check" CHECK (("operational_holds"."project_id" is not null and "operational_holds"."job_id" is null) or ("operational_holds"."project_id" is null and "operational_holds"."job_id" is not null)),
	CONSTRAINT "operational_holds_status_check" CHECK ("operational_holds"."status" in ('active', 'released'))
);
--> statement-breakpoint
CREATE TABLE "readiness_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"job_id" uuid,
	"readiness_type" varchar(30) NOT NULL,
	"result" varchar(40) NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evaluated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "readiness_evaluations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "readiness_evaluations_owner_check" CHECK (("readiness_evaluations"."project_id" is not null and "readiness_evaluations"."job_id" is null) or ("readiness_evaluations"."project_id" is null and "readiness_evaluations"."job_id" is not null)),
	CONSTRAINT "readiness_evaluations_type_check" CHECK ("readiness_evaluations"."readiness_type" in ('planning', 'schedule', 'dispatch', 'completion', 'invoice', 'closure')),
	CONSTRAINT "readiness_evaluations_result_check" CHECK ("readiness_evaluations"."result" in ('ready', 'ready_with_warnings', 'not_ready', 'evaluation_required'))
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"schedule_block_id" uuid,
	"sequence" integer NOT NULL,
	"stop_type" varchar(30) NOT NULL,
	"label" varchar(200) NOT NULL,
	"location_snapshot" jsonb NOT NULL,
	"instructions" text,
	"status" varchar(30) DEFAULT 'planned' NOT NULL,
	"arrived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "route_stops_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "route_stops_tenant_job_sequence_unique" UNIQUE("tenant_id","job_id","sequence"),
	CONSTRAINT "route_stops_sequence_check" CHECK ("route_stops"."sequence" > 0),
	CONSTRAINT "route_stops_type_check" CHECK ("route_stops"."stop_type" in ('supplier', 'customer', 'dropoff', 'pickup', 'disposal', 'inspection', 'other')),
	CONSTRAINT "route_stops_status_check" CHECK ("route_stops"."status" in ('planned', 'arrived', 'completed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"block_type" varchar(40) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" varchar(30) DEFAULT 'tentative' NOT NULL,
	"notes" text,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "schedule_blocks_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "schedule_blocks_type_check" CHECK ("schedule_blocks"."block_type" in ('service', 'dropoff', 'pickup', 'disposal', 'inspection', 'other')),
	CONSTRAINT "schedule_blocks_status_check" CHECK ("schedule_blocks"."status" in ('tentative', 'confirmed', 'completed', 'cancelled')),
	CONSTRAINT "schedule_blocks_range_check" CHECK ("schedule_blocks"."ends_at" > "schedule_blocks"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_status_check";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'pending_contract';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "primary_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "accepted_quote_content_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "accepted_value_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "required_deposit_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "contract_requirement" varchar(30) DEFAULT 'required' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "contract_status" varchar(30) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deposit_requirement" varchar(30) DEFAULT 'required' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deposit_status" varchar(30) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deposit_evidence_reference" varchar(240);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "operationally_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "financially_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
UPDATE projects AS project
SET primary_contact_id = quote.primary_contact_id,
    accepted_quote_content_hash = version.content_hash,
    accepted_value_cents = version.total_cents,
    required_deposit_cents = version.required_deposit_cents,
    deposit_requirement = CASE WHEN version.required_deposit_cents > 0 THEN 'required' ELSE 'waived' END,
    deposit_status = CASE WHEN version.required_deposit_cents > 0 THEN 'pending' ELSE 'waived' END,
    status = CASE WHEN project.status = 'pending_setup' THEN 'pending_contract' ELSE project.status END
FROM quote_versions AS version
JOIN quotes AS quote
  ON quote.tenant_id = version.tenant_id
 AND quote.id = version.quote_id
WHERE project.tenant_id = version.tenant_id
  AND project.accepted_quote_version_id = version.id;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "primary_contact_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "accepted_quote_content_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_tenant_block_fk" FOREIGN KEY ("tenant_id","schedule_block_id") REFERENCES "public"."schedule_blocks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_tenant_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reservations" ADD CONSTRAINT "asset_reservations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reservations" ADD CONSTRAINT "asset_reservations_tenant_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reservations" ADD CONSTRAINT "asset_reservations_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reservations" ADD CONSTRAINT "asset_reservations_tenant_block_fk" FOREIGN KEY ("tenant_id","schedule_block_id") REFERENCES "public"."schedule_blocks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_tenant_block_fk" FOREIGN KEY ("tenant_id","schedule_block_id") REFERENCES "public"."schedule_blocks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_tenant_instance_fk" FOREIGN KEY ("tenant_id","checklist_instance_id") REFERENCES "public"."checklist_instances"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_tenant_completed_by_fk" FOREIGN KEY ("tenant_id","completed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_public_links" ADD CONSTRAINT "contract_public_links_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_public_links" ADD CONSTRAINT "contract_public_links_tenant_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_tenant_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_tenant_user_fk" FOREIGN KEY ("tenant_id","signer_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_tenant_contact_fk" FOREIGN KEY ("tenant_id","signer_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_tenant_block_fk" FOREIGN KEY ("tenant_id","schedule_block_id") REFERENCES "public"."schedule_blocks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_tenant_actor_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_holds" ADD CONSTRAINT "operational_holds_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_holds" ADD CONSTRAINT "operational_holds_tenant_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_holds" ADD CONSTRAINT "operational_holds_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_holds" ADD CONSTRAINT "operational_holds_tenant_placed_by_fk" FOREIGN KEY ("tenant_id","placed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_holds" ADD CONSTRAINT "operational_holds_tenant_released_by_fk" FOREIGN KEY ("tenant_id","released_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_evaluations" ADD CONSTRAINT "readiness_evaluations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_evaluations" ADD CONSTRAINT "readiness_evaluations_tenant_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_evaluations" ADD CONSTRAINT "readiness_evaluations_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_evaluations" ADD CONSTRAINT "readiness_evaluations_tenant_evaluator_fk" FOREIGN KEY ("tenant_id","evaluated_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_block_fk" FOREIGN KEY ("tenant_id","schedule_block_id") REFERENCES "public"."schedule_blocks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_assignments_tenant_asset_status_idx" ON "asset_assignments" USING btree ("tenant_id","asset_id","status");--> statement-breakpoint
CREATE INDEX "asset_reservations_tenant_asset_window_idx" ON "asset_reservations" USING btree ("tenant_id","asset_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "assets_tenant_type_status_idx" ON "assets" USING btree ("tenant_id","asset_type","status");--> statement-breakpoint
CREATE INDEX "checklist_instances_tenant_job_status_idx" ON "checklist_instances" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE INDEX "checklist_items_tenant_instance_status_idx" ON "checklist_items" USING btree ("tenant_id","checklist_instance_id","status");--> statement-breakpoint
CREATE INDEX "contract_public_links_tenant_contract_idx" ON "contract_public_links" USING btree ("tenant_id","contract_id","expires_at");--> statement-breakpoint
CREATE INDEX "contract_signatures_tenant_signed_idx" ON "contract_signatures" USING btree ("tenant_id","signed_at");--> statement-breakpoint
CREATE INDEX "contracts_tenant_status_idx" ON "contracts" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "job_assignments_tenant_user_status_idx" ON "job_assignments" USING btree ("tenant_id","user_id","status");--> statement-breakpoint
CREATE INDEX "job_events_tenant_job_occurred_idx" ON "job_events" USING btree ("tenant_id","job_id","occurred_at");--> statement-breakpoint
CREATE INDEX "jobs_tenant_project_status_idx" ON "jobs" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
CREATE INDEX "jobs_tenant_schedule_queue_idx" ON "jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "operational_holds_tenant_project_status_idx" ON "operational_holds" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
CREATE INDEX "operational_holds_tenant_job_status_idx" ON "operational_holds" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE INDEX "readiness_evaluations_tenant_project_idx" ON "readiness_evaluations" USING btree ("tenant_id","project_id","readiness_type","evaluated_at");--> statement-breakpoint
CREATE INDEX "readiness_evaluations_tenant_job_idx" ON "readiness_evaluations" USING btree ("tenant_id","job_id","readiness_type","evaluated_at");--> statement-breakpoint
CREATE INDEX "route_stops_tenant_job_status_idx" ON "route_stops" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE INDEX "schedule_blocks_tenant_window_idx" ON "schedule_blocks" USING btree ("tenant_id","starts_at","ends_at","status");--> statement-breakpoint
CREATE INDEX "schedule_blocks_tenant_job_idx" ON "schedule_blocks" USING btree ("tenant_id","job_id","starts_at");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_contact_fk" FOREIGN KEY ("tenant_id","primary_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_contract_requirement_check" CHECK ("projects"."contract_requirement" in ('required', 'waived'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_contract_status_check" CHECK ("projects"."contract_status" in ('pending', 'generated', 'business_signed', 'sent', 'viewed', 'executed', 'waived', 'voided'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deposit_requirement_check" CHECK ("projects"."deposit_requirement" in ('required', 'waived'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deposit_status_check" CHECK ("projects"."deposit_status" in ('pending', 'satisfied', 'waived'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_value_check" CHECK ("projects"."accepted_value_cents" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deposit_check" CHECK ("projects"."required_deposit_cents" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('pending_setup', 'pending_contract', 'pending_deposit', 'ready_for_planning', 'planning', 'active', 'operationally_complete', 'financially_complete', 'completed', 'closed', 'on_hold'));
--> statement-breakpoint
ALTER TABLE asset_reservations
ADD CONSTRAINT asset_reservations_no_active_overlap
EXCLUDE USING gist (
  tenant_id WITH =,
  asset_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
)
WHERE (status = 'active');
--> statement-breakpoint
CREATE UNIQUE INDEX operational_holds_one_active_project_idx
ON operational_holds (tenant_id, project_id)
WHERE status = 'active' AND project_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX operational_holds_one_active_job_idx
ON operational_holds (tenant_id, job_id)
WHERE status = 'active' AND job_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO jobs (
  id, tenant_id, project_id, job_number, service_type, status, readiness, created_at, created_by,
  updated_at, updated_by
)
SELECT
  gen_random_uuid(),
  project.tenant_id,
  project.id,
  CASE WHEN project.service_type = 'material_delivery' THEN 'MAT' ELSE 'DTR' END
    || '-' || to_char(project.created_at, 'YYYY')
    || '-M' || upper(substring(replace(project.id::text, '-', '') from 1 for 8)),
  project.service_type,
  'new',
  'evaluation_required',
  project.created_at,
  project.created_by,
  now(),
  project.updated_by
FROM projects AS project
WHERE NOT EXISTS (
  SELECT 1 FROM jobs AS existing
  WHERE existing.tenant_id = project.tenant_id
    AND existing.project_id = project.id
);--> statement-breakpoint
INSERT INTO job_events (tenant_id, job_id, event_type, summary, metadata, occurred_at, actor_user_id)
SELECT tenant_id, id, 'job.created_from_existing_project', 'Initial Job created during Sprint 1.5 migration',
  jsonb_build_object('projectId', project_id), created_at, created_by
FROM jobs
WHERE job_number LIKE '%-M%';
--> statement-breakpoint
CREATE FUNCTION protect_contract_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('business_signed', 'sent', 'viewed', 'executed', 'voided')
    AND (NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.contract_number IS DISTINCT FROM OLD.contract_number
      OR NEW.version_number IS DISTINCT FROM OLD.version_number
      OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
      OR NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
    RAISE EXCEPTION 'issued or terminal Contract content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contracts_content_guard
BEFORE UPDATE ON contracts
FOR EACH ROW EXECUTE FUNCTION protect_contract_content();
--> statement-breakpoint
CREATE FUNCTION protect_contract_signature()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Contract Signatures are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contract_signatures_immutable_guard
BEFORE UPDATE OR DELETE ON contract_signatures
FOR EACH ROW EXECUTE FUNCTION protect_contract_signature();
--> statement-breakpoint
CREATE FUNCTION protect_job_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Job Events are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER job_events_immutable_guard
BEFORE UPDATE OR DELETE ON job_events
FOR EACH ROW EXECUTE FUNCTION protect_job_event();
--> statement-breakpoint
CREATE FUNCTION protect_closed_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'closed' AND NOT (
    NEW.status = 'planning'
    AND NEW.reopened_at IS NOT NULL
    AND NEW.reopened_at IS DISTINCT FROM OLD.reopened_at
    AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
    AND NEW.job_number IS NOT DISTINCT FROM OLD.job_number
    AND NEW.service_type IS NOT DISTINCT FROM OLD.service_type
  ) THEN
    RAISE EXCEPTION 'closed Jobs reject ordinary edits';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER a_jobs_closed_guard
BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION protect_closed_job();
--> statement-breakpoint
CREATE FUNCTION protect_closed_job_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id uuid;
  target_tenant_id uuid;
  target_status varchar(40);
BEGIN
  target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
  target_tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  IF target_job_id IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT status INTO target_status FROM jobs
  WHERE tenant_id = target_tenant_id AND id = target_job_id;
  IF target_status = 'closed' THEN
    RAISE EXCEPTION 'closed Job child records reject ordinary edits';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER schedule_blocks_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON schedule_blocks
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER asset_reservations_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON asset_reservations
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER job_assignments_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON job_assignments
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER asset_assignments_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON asset_assignments
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER route_stops_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON route_stops
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER checklist_instances_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON checklist_instances
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER operational_holds_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON operational_holds
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
--> statement-breakpoint
CREATE FUNCTION protect_closed_job_checklist_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_instance_id uuid;
  target_tenant_id uuid;
  target_status varchar(40);
BEGIN
  target_instance_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.checklist_instance_id ELSE NEW.checklist_instance_id END;
  target_tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  SELECT job.status INTO target_status
  FROM checklist_instances AS instance
  JOIN jobs AS job ON job.tenant_id = instance.tenant_id AND job.id = instance.job_id
  WHERE instance.tenant_id = target_tenant_id AND instance.id = target_instance_id;
  IF target_status = 'closed' THEN
    RAISE EXCEPTION 'closed Job Checklist Items reject ordinary edits';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_items_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON checklist_items
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_checklist_item();
--> statement-breakpoint
CREATE TRIGGER asset_assignments_row_update BEFORE UPDATE ON asset_assignments FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER asset_reservations_row_update BEFORE UPDATE ON asset_reservations FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER assets_row_update BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER checklist_instances_row_update BEFORE UPDATE ON checklist_instances FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER checklist_items_row_update BEFORE UPDATE ON checklist_items FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER contract_public_links_row_update BEFORE UPDATE ON contract_public_links FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER contracts_row_update BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER job_assignments_row_update BEFORE UPDATE ON job_assignments FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER jobs_row_update BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER operational_holds_row_update BEFORE UPDATE ON operational_holds FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER readiness_evaluations_row_update BEFORE UPDATE ON readiness_evaluations FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER route_stops_row_update BEFORE UPDATE ON route_stops FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER schedule_blocks_row_update BEFORE UPDATE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'asset_assignments', 'asset_reservations', 'assets', 'checklist_instances', 'checklist_items',
    'contract_public_links', 'contract_signatures', 'contracts', 'job_assignments', 'job_events',
    'jobs', 'operational_holds', 'readiness_evaluations', 'route_stops', 'schedule_blocks'
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
REVOKE ALL ON asset_assignments, asset_reservations, assets, checklist_instances, checklist_items,
  contract_public_links, contract_signatures, contracts, job_assignments, job_events, jobs,
  operational_holds, readiness_evaluations, route_stops, schedule_blocks FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON asset_assignments, asset_reservations, assets,
      checklist_instances, checklist_items, contract_public_links, contract_signatures, contracts,
      job_assignments, job_events, jobs, operational_holds, readiness_evaluations, route_stops,
      schedule_blocks TO ldg_app;
  END IF;
END;
$$;
