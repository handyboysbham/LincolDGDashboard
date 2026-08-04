CREATE TABLE "expense_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"material_load_item_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "expense_allocations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_allocations_amount_check" CHECK ("expense_allocations"."amount_cents" > 0),
	CONSTRAINT "expense_allocations_status_check" CHECK ("expense_allocations"."status" in ('active', 'reversed')),
	CONSTRAINT "expense_allocations_reversal_check" CHECK ("expense_allocations"."status" = 'active' or ("expense_allocations"."reversed_at" is not null and "expense_allocations"."reversed_by" is not null and "expense_allocations"."reversal_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"expense_number" varchar(40) NOT NULL,
	"expense_kind" varchar(30) DEFAULT 'expense' NOT NULL,
	"expense_type" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid,
	"supplier_location_id" uuid,
	"receipt_document_id" uuid,
	"receipt_status" varchar(30) DEFAULT 'missing' NOT NULL,
	"receipt_waiver_reason" text,
	"receipt_waived_at" timestamp with time zone,
	"receipt_waived_by" uuid,
	"amount_cents" bigint NOT NULL,
	"description" varchar(300) NOT NULL,
	"external_reference" varchar(160),
	"incurred_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"reverses_expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "expenses_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "expenses_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id"),
	CONSTRAINT "expenses_tenant_number_unique" UNIQUE("tenant_id","expense_number"),
	CONSTRAINT "expenses_tenant_reversal_unique" UNIQUE("tenant_id","reverses_expense_id"),
	CONSTRAINT "expenses_kind_check" CHECK ("expenses"."expense_kind" in ('expense', 'reversal')),
	CONSTRAINT "expenses_type_check" CHECK ("expenses"."expense_type" in ('material_purchase', 'supplier_fee', 'delivery', 'disposal', 'other')),
	CONSTRAINT "expenses_status_check" CHECK ("expenses"."status" in ('draft', 'evidence_required', 'pending_review', 'approved', 'reconciled', 'reversed', 'cancelled')),
	CONSTRAINT "expenses_supplier_location_check" CHECK ("expenses"."supplier_location_id" is null or "expenses"."supplier_id" is not null),
	CONSTRAINT "expenses_receipt_status_check" CHECK ("expenses"."receipt_status" in ('missing', 'attached', 'waived', 'not_required')),
	CONSTRAINT "expenses_receipt_evidence_check" CHECK (("expenses"."receipt_status" <> 'attached' or "expenses"."receipt_document_id" is not null) and ("expenses"."receipt_status" <> 'waived' or ("expenses"."receipt_waiver_reason" is not null and "expenses"."receipt_waived_at" is not null and "expenses"."receipt_waived_by" is not null))),
	CONSTRAINT "expenses_amount_check" CHECK ("expenses"."amount_cents" > 0),
	CONSTRAINT "expenses_approval_check" CHECK ("expenses"."status" not in ('approved', 'reconciled') or ("expenses"."approved_at" is not null and "expenses"."approved_by" is not null and "expenses"."receipt_status" in ('attached', 'waived', 'not_required'))),
	CONSTRAINT "expenses_reversal_check" CHECK (("expenses"."expense_kind" = 'expense' and "expenses"."reverses_expense_id" is null) or ("expenses"."expense_kind" = 'reversal' and "expenses"."reverses_expense_id" is not null and "expenses"."receipt_status" = 'not_required'))
);
--> statement-breakpoint
CREATE TABLE "job_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"charge_number" varchar(40) NOT NULL,
	"charge_kind" varchar(30) DEFAULT 'charge' NOT NULL,
	"charge_type" varchar(60) NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_id" uuid,
	"dedupe_key" varchar(200) NOT NULL,
	"status" varchar(40) DEFAULT 'draft' NOT NULL,
	"responsibility" varchar(40) DEFAULT 'unknown' NOT NULL,
	"evidence_status" varchar(30) DEFAULT 'required' NOT NULL,
	"customer_authorization_status" varchar(30) DEFAULT 'not_required' NOT NULL,
	"internal_approval_status" varchar(30) DEFAULT 'required' NOT NULL,
	"quantity" numeric(12, 3),
	"unit" varchar(40),
	"rate_cents" bigint,
	"calculated_amount_cents" bigint,
	"proposed_amount_cents" bigint,
	"approved_amount_cents" bigint,
	"invoiced_amount_cents" bigint DEFAULT 0 NOT NULL,
	"credited_amount_cents" bigint DEFAULT 0 NOT NULL,
	"calculation_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customer_description" varchar(300) NOT NULL,
	"tax_behavior" varchar(30) DEFAULT 'undetermined' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"reverses_job_charge_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "job_charges_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "job_charges_tenant_number_unique" UNIQUE("tenant_id","charge_number"),
	CONSTRAINT "job_charges_tenant_reversal_unique" UNIQUE("tenant_id","reverses_job_charge_id"),
	CONSTRAINT "job_charges_kind_check" CHECK ("job_charges"."charge_kind" in ('charge', 'credit', 'no_charge', 'informational', 'reversal')),
	CONSTRAINT "job_charges_source_type_check" CHECK ("job_charges"."source_type" in ('material_delivery_detail', 'material_load', 'material_load_item', 'material_substitution', 'quantity_variance', 'route_stop', 'manual')),
	CONSTRAINT "job_charges_source_check" CHECK ("job_charges"."source_type" = 'manual' or "job_charges"."source_id" is not null),
	CONSTRAINT "job_charges_status_check" CHECK ("job_charges"."status" in ('draft', 'calculating', 'evidence_required', 'responsibility_review', 'awaiting_customer_authorization', 'awaiting_internal_approval', 'approved', 'partially_approved', 'rejected', 'waived', 'disputed', 'ready_to_invoice', 'invoiced', 'partially_invoiced', 'credited', 'reversed', 'resolved', 'cancelled')),
	CONSTRAINT "job_charges_responsibility_check" CHECK ("job_charges"."responsibility" in ('customer', 'business', 'shared', 'supplier', 'vendor', 'insurance', 'unknown', 'disputed', 'not_applicable')),
	CONSTRAINT "job_charges_evidence_check" CHECK ("job_charges"."evidence_status" in ('required', 'complete', 'waived', 'not_required')),
	CONSTRAINT "job_charges_customer_authorization_check" CHECK ("job_charges"."customer_authorization_status" in ('not_required', 'required', 'pending', 'authorized', 'declined', 'waived')),
	CONSTRAINT "job_charges_internal_approval_check" CHECK ("job_charges"."internal_approval_status" in ('not_required', 'required', 'pending', 'approved', 'rejected', 'waived')),
	CONSTRAINT "job_charges_quantity_check" CHECK ("job_charges"."quantity" is null or "job_charges"."quantity" >= 0),
	CONSTRAINT "job_charges_rate_check" CHECK ("job_charges"."rate_cents" is null or "job_charges"."rate_cents" >= 0),
	CONSTRAINT "job_charges_amounts_check" CHECK (("job_charges"."calculated_amount_cents" is null or "job_charges"."calculated_amount_cents" >= 0) and ("job_charges"."proposed_amount_cents" is null or "job_charges"."proposed_amount_cents" >= 0) and ("job_charges"."approved_amount_cents" is null or "job_charges"."approved_amount_cents" >= 0) and "job_charges"."invoiced_amount_cents" >= 0 and "job_charges"."credited_amount_cents" >= 0),
	CONSTRAINT "job_charges_tax_behavior_check" CHECK ("job_charges"."tax_behavior" in ('taxable', 'non_taxable', 'tax_included', 'undetermined')),
	CONSTRAINT "job_charges_approval_check" CHECK ("job_charges"."status" not in ('approved', 'partially_approved', 'ready_to_invoice', 'invoiced', 'partially_invoiced', 'credited', 'resolved') or ("job_charges"."approved_amount_cents" is not null and "job_charges"."approved_at" is not null and "job_charges"."approved_by" is not null)),
	CONSTRAINT "job_charges_reversal_check" CHECK (("job_charges"."charge_kind" <> 'reversal' and "job_charges"."reverses_job_charge_id" is null) or ("job_charges"."charge_kind" = 'reversal' and "job_charges"."reverses_job_charge_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "material_delivery_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" varchar(40) DEFAULT 'planning' NOT NULL,
	"delivery_type" varchar(30) DEFAULT 'bulk' NOT NULL,
	"planned_load_count" integer DEFAULT 1 NOT NULL,
	"planned_volume_cubic_yards" numeric(14, 3),
	"planned_weight_pounds" numeric(14, 3),
	"actual_delivered_volume_cubic_yards" numeric(14, 3),
	"actual_delivered_weight_pounds" numeric(14, 3),
	"capacity_status" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"compatibility_status" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"receipt_status" varchar(30) DEFAULT 'missing' NOT NULL,
	"placement_evidence_required" boolean DEFAULT true NOT NULL,
	"placement_evidence_status" varchar(30) DEFAULT 'missing' NOT NULL,
	"invoice_readiness" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"partial_delivery" boolean DEFAULT false NOT NULL,
	"completion_summary" text,
	"operationally_completed_at" timestamp with time zone,
	"invoice_ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "material_delivery_details_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_delivery_details_tenant_job_unique" UNIQUE("tenant_id","job_id"),
	CONSTRAINT "material_delivery_details_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id"),
	CONSTRAINT "material_delivery_details_status_check" CHECK ("material_delivery_details"."status" in ('planning', 'ready', 'active', 'partially_delivered', 'delivered', 'reconciling', 'operationally_complete', 'cancelled')),
	CONSTRAINT "material_delivery_details_type_check" CHECK ("material_delivery_details"."delivery_type" in ('bulk', 'placed', 'spread')),
	CONSTRAINT "material_delivery_details_load_count_check" CHECK ("material_delivery_details"."planned_load_count" > 0),
	CONSTRAINT "material_delivery_details_planned_volume_check" CHECK ("material_delivery_details"."planned_volume_cubic_yards" is null or "material_delivery_details"."planned_volume_cubic_yards" > 0),
	CONSTRAINT "material_delivery_details_planned_weight_check" CHECK ("material_delivery_details"."planned_weight_pounds" is null or "material_delivery_details"."planned_weight_pounds" > 0),
	CONSTRAINT "material_delivery_details_actual_volume_check" CHECK ("material_delivery_details"."actual_delivered_volume_cubic_yards" is null or "material_delivery_details"."actual_delivered_volume_cubic_yards" >= 0),
	CONSTRAINT "material_delivery_details_actual_weight_check" CHECK ("material_delivery_details"."actual_delivered_weight_pounds" is null or "material_delivery_details"."actual_delivered_weight_pounds" >= 0),
	CONSTRAINT "material_delivery_details_capacity_check" CHECK ("material_delivery_details"."capacity_status" in ('evaluation_required', 'pass', 'fail')),
	CONSTRAINT "material_delivery_details_compatibility_check" CHECK ("material_delivery_details"."compatibility_status" in ('evaluation_required', 'pass', 'fail', 'not_required')),
	CONSTRAINT "material_delivery_details_receipt_check" CHECK ("material_delivery_details"."receipt_status" in ('missing', 'partial', 'complete', 'waived')),
	CONSTRAINT "material_delivery_details_evidence_check" CHECK ("material_delivery_details"."placement_evidence_status" in ('not_required', 'missing', 'partial', 'complete', 'waived')),
	CONSTRAINT "material_delivery_details_invoice_readiness_check" CHECK ("material_delivery_details"."invoice_readiness" in ('evaluation_required', 'ready', 'not_ready'))
);
--> statement-breakpoint
CREATE TABLE "material_load_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"material_load_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'planned' NOT NULL,
	"capacity_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "material_load_assets_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_load_assets_tenant_load_asset_unique" UNIQUE("tenant_id","material_load_id","asset_id"),
	CONSTRAINT "material_load_assets_role_check" CHECK ("material_load_assets"."role" in ('truck', 'trailer', 'equipment')),
	CONSTRAINT "material_load_assets_status_check" CHECK ("material_load_assets"."status" in ('planned', 'active', 'used', 'released', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "material_load_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"material_load_id" uuid NOT NULL,
	"accepted_quote_line_item_id" uuid,
	"material_id" uuid NOT NULL,
	"actual_material_id" uuid,
	"planned_supplier_material_id" uuid,
	"actual_supplier_material_id" uuid,
	"supplier_route_stop_id" uuid,
	"placement_route_stop_id" uuid,
	"sequence" integer NOT NULL,
	"loading_sequence" integer NOT NULL,
	"unloading_sequence" integer NOT NULL,
	"quantity_unit" varchar(30) NOT NULL,
	"planned_quantity" numeric(12, 3) NOT NULL,
	"purchased_quantity" numeric(12, 3),
	"loaded_quantity" numeric(12, 3),
	"delivered_quantity" numeric(12, 3),
	"remaining_quantity" numeric(12, 3),
	"unit_weight_pounds" numeric(14, 3),
	"unit_volume_cubic_yards" numeric(14, 3),
	"planned_unit_cost_cents" bigint,
	"actual_unit_cost_cents" bigint,
	"compartment" varchar(100),
	"separation_instructions" text,
	"delivery_result" varchar(30) DEFAULT 'pending' NOT NULL,
	"remaining_disposition" varchar(40),
	"substitution_status" varchar(30) DEFAULT 'not_required' NOT NULL,
	"variance_status" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "material_load_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_load_items_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id"),
	CONSTRAINT "material_load_items_tenant_load_sequence_unique" UNIQUE("tenant_id","material_load_id","sequence"),
	CONSTRAINT "material_load_items_sequence_check" CHECK ("material_load_items"."sequence" > 0),
	CONSTRAINT "material_load_items_loading_sequence_check" CHECK ("material_load_items"."loading_sequence" > 0),
	CONSTRAINT "material_load_items_unloading_sequence_check" CHECK ("material_load_items"."unloading_sequence" > 0),
	CONSTRAINT "material_load_items_unit_check" CHECK ("material_load_items"."quantity_unit" in ('tons', 'cubic_yards', 'loads')),
	CONSTRAINT "material_load_items_planned_quantity_check" CHECK ("material_load_items"."planned_quantity" > 0),
	CONSTRAINT "material_load_items_purchased_quantity_check" CHECK ("material_load_items"."purchased_quantity" is null or "material_load_items"."purchased_quantity" >= 0),
	CONSTRAINT "material_load_items_loaded_quantity_check" CHECK ("material_load_items"."loaded_quantity" is null or "material_load_items"."loaded_quantity" >= 0),
	CONSTRAINT "material_load_items_delivered_quantity_check" CHECK ("material_load_items"."delivered_quantity" is null or "material_load_items"."delivered_quantity" >= 0),
	CONSTRAINT "material_load_items_remaining_quantity_check" CHECK ("material_load_items"."remaining_quantity" is null or "material_load_items"."remaining_quantity" >= 0),
	CONSTRAINT "material_load_items_weight_conversion_check" CHECK ("material_load_items"."unit_weight_pounds" is null or "material_load_items"."unit_weight_pounds" > 0),
	CONSTRAINT "material_load_items_volume_conversion_check" CHECK ("material_load_items"."unit_volume_cubic_yards" is null or "material_load_items"."unit_volume_cubic_yards" > 0),
	CONSTRAINT "material_load_items_planned_cost_check" CHECK ("material_load_items"."planned_unit_cost_cents" is null or "material_load_items"."planned_unit_cost_cents" >= 0),
	CONSTRAINT "material_load_items_actual_cost_check" CHECK ("material_load_items"."actual_unit_cost_cents" is null or "material_load_items"."actual_unit_cost_cents" >= 0),
	CONSTRAINT "material_load_items_delivery_result_check" CHECK ("material_load_items"."delivery_result" in ('pending', 'delivered', 'partially_delivered', 'not_delivered', 'returned', 'cancelled')),
	CONSTRAINT "material_load_items_remaining_disposition_check" CHECK ("material_load_items"."remaining_disposition" is null or "material_load_items"."remaining_disposition" in ('none', 'returned_to_supplier', 'retained_by_business', 'left_with_customer', 'disposed', 'follow_up_job', 'other')),
	CONSTRAINT "material_load_items_substitution_check" CHECK ("material_load_items"."substitution_status" in ('not_required', 'pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "material_load_items_variance_check" CHECK ("material_load_items"."variance_status" in ('evaluation_required', 'none', 'open', 'resolved', 'waived'))
);
--> statement-breakpoint
CREATE TABLE "material_load_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"material_load_id" uuid NOT NULL,
	"validation_type" varchar(30) NOT NULL,
	"result" varchar(30) NOT NULL,
	"capacity_result" varchar(30) NOT NULL,
	"compatibility_result" varchar(30) NOT NULL,
	"separation_result" varchar(30) NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"supersedes_validation_id" uuid,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evaluated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_load_validations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_load_validations_tenant_load_type_hash_unique" UNIQUE("tenant_id","material_load_id","validation_type","input_hash"),
	CONSTRAINT "material_load_validations_type_check" CHECK ("material_load_validations"."validation_type" in ('planning', 'dispatch', 'actual')),
	CONSTRAINT "material_load_validations_result_check" CHECK ("material_load_validations"."result" in ('ready', 'ready_with_warnings', 'not_ready')),
	CONSTRAINT "material_load_validations_capacity_check" CHECK ("material_load_validations"."capacity_result" in ('pass', 'fail')),
	CONSTRAINT "material_load_validations_compatibility_check" CHECK ("material_load_validations"."compatibility_result" in ('pass', 'fail', 'not_required')),
	CONSTRAINT "material_load_validations_separation_check" CHECK ("material_load_validations"."separation_result" in ('pass', 'fail', 'not_required')),
	CONSTRAINT "material_load_validations_failed_safety_check" CHECK (("material_load_validations"."capacity_result" <> 'fail' and "material_load_validations"."compatibility_result" <> 'fail' and "material_load_validations"."separation_result" <> 'fail') or "material_load_validations"."result" = 'not_ready'),
	CONSTRAINT "material_load_validations_ready_safety_check" CHECK ("material_load_validations"."result" = 'not_ready' or ("material_load_validations"."capacity_result" = 'pass' and "material_load_validations"."compatibility_result" in ('pass', 'not_required') and "material_load_validations"."separation_result" in ('pass', 'not_required')))
);
--> statement-breakpoint
CREATE TABLE "material_loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"material_delivery_detail_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" varchar(40) DEFAULT 'planned' NOT NULL,
	"planned_volume_cubic_yards" numeric(14, 3),
	"planned_weight_pounds" numeric(14, 3),
	"actual_volume_cubic_yards" numeric(14, 3),
	"actual_weight_pounds" numeric(14, 3),
	"capacity_result" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"compatibility_result" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"separation_result" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"loading_started_at" timestamp with time zone,
	"loaded_at" timestamp with time zone,
	"transit_started_at" timestamp with time zone,
	"unloading_started_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "material_loads_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_loads_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id"),
	CONSTRAINT "material_loads_tenant_detail_sequence_unique" UNIQUE("tenant_id","material_delivery_detail_id","sequence"),
	CONSTRAINT "material_loads_sequence_check" CHECK ("material_loads"."sequence" > 0),
	CONSTRAINT "material_loads_status_check" CHECK ("material_loads"."status" in ('planned', 'ready_for_loading', 'at_supplier', 'loading', 'loaded', 'en_route', 'at_customer', 'unloading', 'partially_delivered', 'delivered', 'reconciling', 'reconciled', 'rejected', 'cancelled')),
	CONSTRAINT "material_loads_planned_volume_check" CHECK ("material_loads"."planned_volume_cubic_yards" is null or "material_loads"."planned_volume_cubic_yards" >= 0),
	CONSTRAINT "material_loads_planned_weight_check" CHECK ("material_loads"."planned_weight_pounds" is null or "material_loads"."planned_weight_pounds" >= 0),
	CONSTRAINT "material_loads_actual_volume_check" CHECK ("material_loads"."actual_volume_cubic_yards" is null or "material_loads"."actual_volume_cubic_yards" >= 0),
	CONSTRAINT "material_loads_actual_weight_check" CHECK ("material_loads"."actual_weight_pounds" is null or "material_loads"."actual_weight_pounds" >= 0),
	CONSTRAINT "material_loads_capacity_check" CHECK ("material_loads"."capacity_result" in ('evaluation_required', 'pass', 'fail')),
	CONSTRAINT "material_loads_compatibility_check" CHECK ("material_loads"."compatibility_result" in ('evaluation_required', 'pass', 'fail', 'not_required')),
	CONSTRAINT "material_loads_separation_check" CHECK ("material_loads"."separation_result" in ('evaluation_required', 'pass', 'fail', 'not_required')),
	CONSTRAINT "material_loads_loading_time_check" CHECK ("material_loads"."loaded_at" is null or "material_loads"."loading_started_at" is null or "material_loads"."loaded_at" >= "material_loads"."loading_started_at"),
	CONSTRAINT "material_loads_transit_time_check" CHECK ("material_loads"."transit_started_at" is null or "material_loads"."loaded_at" is null or "material_loads"."transit_started_at" >= "material_loads"."loaded_at"),
	CONSTRAINT "material_loads_unloading_time_check" CHECK ("material_loads"."unloading_started_at" is null or "material_loads"."transit_started_at" is null or "material_loads"."unloading_started_at" >= "material_loads"."transit_started_at"),
	CONSTRAINT "material_loads_delivery_time_check" CHECK ("material_loads"."delivered_at" is null or "material_loads"."unloading_started_at" is null or "material_loads"."delivered_at" >= "material_loads"."unloading_started_at"),
	CONSTRAINT "material_loads_reconcile_time_check" CHECK ("material_loads"."reconciled_at" is null or "material_loads"."delivered_at" is null or "material_loads"."reconciled_at" >= "material_loads"."delivered_at")
);
--> statement-breakpoint
CREATE TABLE "material_quantity_variances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"material_load_item_id" uuid NOT NULL,
	"variance_type" varchar(30) NOT NULL,
	"quantity_unit" varchar(30) NOT NULL,
	"expected_quantity" numeric(12, 3) NOT NULL,
	"actual_quantity" numeric(12, 3) NOT NULL,
	"variance_quantity" numeric(12, 3) NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"responsibility" varchar(40) DEFAULT 'unknown' NOT NULL,
	"resolution_type" varchar(40),
	"resolution_reason" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "material_quantity_variances_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_quantity_variances_type_check" CHECK ("material_quantity_variances"."variance_type" in ('purchase', 'loading', 'delivery', 'remaining')),
	CONSTRAINT "material_quantity_variances_unit_check" CHECK ("material_quantity_variances"."quantity_unit" in ('tons', 'cubic_yards', 'loads')),
	CONSTRAINT "material_quantity_variances_quantity_check" CHECK ("material_quantity_variances"."expected_quantity" >= 0 and "material_quantity_variances"."actual_quantity" >= 0 and "material_quantity_variances"."variance_quantity" = "material_quantity_variances"."actual_quantity" - "material_quantity_variances"."expected_quantity"),
	CONSTRAINT "material_quantity_variances_status_check" CHECK ("material_quantity_variances"."status" in ('open', 'resolved', 'waived')),
	CONSTRAINT "material_quantity_variances_responsibility_check" CHECK ("material_quantity_variances"."responsibility" in ('customer', 'business', 'shared', 'supplier', 'vendor', 'insurance', 'unknown', 'disputed', 'not_applicable')),
	CONSTRAINT "material_quantity_variances_resolution_type_check" CHECK ("material_quantity_variances"."resolution_type" is null or "material_quantity_variances"."resolution_type" in ('charge', 'credit', 'no_charge', 'follow_up_job', 'supplier_adjustment', 'customer_acceptance', 'other')),
	CONSTRAINT "material_quantity_variances_resolution_check" CHECK ("material_quantity_variances"."status" = 'open' or ("material_quantity_variances"."resolution_type" is not null and "material_quantity_variances"."resolution_reason" is not null and "material_quantity_variances"."resolved_at" is not null and "material_quantity_variances"."resolved_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "material_substitutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"material_load_item_id" uuid NOT NULL,
	"original_material_id" uuid NOT NULL,
	"replacement_material_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"internal_approval_required" boolean DEFAULT true NOT NULL,
	"customer_approval_required" boolean DEFAULT false NOT NULL,
	"quote_revision_required" boolean DEFAULT false NOT NULL,
	"capacity_revalidation_required" boolean DEFAULT true NOT NULL,
	"compatibility_revalidation_required" boolean DEFAULT true NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" uuid NOT NULL,
	"customer_authorized_at" timestamp with time zone,
	"customer_authorization_reference" varchar(240),
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "material_substitutions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_substitutions_material_check" CHECK ("material_substitutions"."original_material_id" <> "material_substitutions"."replacement_material_id"),
	CONSTRAINT "material_substitutions_status_check" CHECK ("material_substitutions"."status" in ('requested', 'pending_internal', 'pending_customer', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "material_substitutions_decision_check" CHECK ("material_substitutions"."status" not in ('approved', 'rejected') or ("material_substitutions"."decided_at" is not null and "material_substitutions"."decided_by" is not null)),
	CONSTRAINT "material_substitutions_customer_approval_check" CHECK ("material_substitutions"."status" <> 'approved' or not "material_substitutions"."customer_approval_required" or ("material_substitutions"."customer_authorized_at" is not null and "material_substitutions"."customer_authorization_reference" is not null))
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "capacity_volume_cubic_yards" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_job_id_unique" UNIQUE("tenant_id","job_id","id");--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD CONSTRAINT "supplier_locations_tenant_supplier_id_unique" UNIQUE("tenant_id","supplier_id","id");--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_tenant_expense_job_fk" FOREIGN KEY ("tenant_id","expense_id","job_id") REFERENCES "public"."expenses"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_tenant_item_job_fk" FOREIGN KEY ("tenant_id","material_load_item_id","job_id") REFERENCES "public"."material_load_items"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_tenant_reverser_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_supplier_location_fk" FOREIGN KEY ("tenant_id","supplier_id","supplier_location_id") REFERENCES "public"."supplier_locations"("tenant_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_receipt_document_fk" FOREIGN KEY ("tenant_id","receipt_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_receipt_waiver_fk" FOREIGN KEY ("tenant_id","receipt_waived_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_approver_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_reversal_fk" FOREIGN KEY ("tenant_id","reverses_expense_id") REFERENCES "public"."expenses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_tenant_approver_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_tenant_reversal_fk" FOREIGN KEY ("tenant_id","reverses_job_charge_id") REFERENCES "public"."job_charges"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_delivery_details" ADD CONSTRAINT "material_delivery_details_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_delivery_details" ADD CONSTRAINT "material_delivery_details_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_assets" ADD CONSTRAINT "material_load_assets_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_assets" ADD CONSTRAINT "material_load_assets_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_assets" ADD CONSTRAINT "material_load_assets_tenant_load_job_fk" FOREIGN KEY ("tenant_id","material_load_id","job_id") REFERENCES "public"."material_loads"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_assets" ADD CONSTRAINT "material_load_assets_tenant_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_load_job_fk" FOREIGN KEY ("tenant_id","material_load_id","job_id") REFERENCES "public"."material_loads"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_quote_line_fk" FOREIGN KEY ("tenant_id","accepted_quote_line_item_id") REFERENCES "public"."quote_line_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_material_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_actual_material_fk" FOREIGN KEY ("tenant_id","actual_material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_planned_supplier_material_fk" FOREIGN KEY ("tenant_id","planned_supplier_material_id") REFERENCES "public"."supplier_materials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_actual_supplier_material_fk" FOREIGN KEY ("tenant_id","actual_supplier_material_id") REFERENCES "public"."supplier_materials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_supplier_stop_fk" FOREIGN KEY ("tenant_id","job_id","supplier_route_stop_id") REFERENCES "public"."route_stops"("tenant_id","job_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_items" ADD CONSTRAINT "material_load_items_tenant_placement_stop_fk" FOREIGN KEY ("tenant_id","job_id","placement_route_stop_id") REFERENCES "public"."route_stops"("tenant_id","job_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_validations" ADD CONSTRAINT "material_load_validations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_validations" ADD CONSTRAINT "material_load_validations_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_validations" ADD CONSTRAINT "material_load_validations_tenant_load_job_fk" FOREIGN KEY ("tenant_id","material_load_id","job_id") REFERENCES "public"."material_loads"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_validations" ADD CONSTRAINT "material_load_validations_tenant_previous_fk" FOREIGN KEY ("tenant_id","supersedes_validation_id") REFERENCES "public"."material_load_validations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_load_validations" ADD CONSTRAINT "material_load_validations_tenant_evaluator_fk" FOREIGN KEY ("tenant_id","evaluated_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_loads" ADD CONSTRAINT "material_loads_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_loads" ADD CONSTRAINT "material_loads_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_loads" ADD CONSTRAINT "material_loads_tenant_detail_job_fk" FOREIGN KEY ("tenant_id","material_delivery_detail_id","job_id") REFERENCES "public"."material_delivery_details"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_quantity_variances" ADD CONSTRAINT "material_quantity_variances_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_quantity_variances" ADD CONSTRAINT "material_quantity_variances_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_quantity_variances" ADD CONSTRAINT "material_quantity_variances_tenant_item_job_fk" FOREIGN KEY ("tenant_id","material_load_item_id","job_id") REFERENCES "public"."material_load_items"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_quantity_variances" ADD CONSTRAINT "material_quantity_variances_tenant_resolver_fk" FOREIGN KEY ("tenant_id","resolved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_tenant_item_job_fk" FOREIGN KEY ("tenant_id","material_load_item_id","job_id") REFERENCES "public"."material_load_items"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_tenant_original_material_fk" FOREIGN KEY ("tenant_id","original_material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_tenant_replacement_material_fk" FOREIGN KEY ("tenant_id","replacement_material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_tenant_requester_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_tenant_decider_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_allocations_one_active_item_idx" ON "expense_allocations" USING btree ("tenant_id","expense_id","material_load_item_id") WHERE "expense_allocations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "expense_allocations_tenant_expense_status_idx" ON "expense_allocations" USING btree ("tenant_id","expense_id","status");--> statement-breakpoint
CREATE INDEX "expenses_tenant_job_status_idx" ON "expenses" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE INDEX "expenses_tenant_supplier_incurred_idx" ON "expenses" USING btree ("tenant_id","supplier_id","incurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_charges_one_active_dedupe_idx" ON "job_charges" USING btree ("tenant_id","job_id","dedupe_key") WHERE "job_charges"."status" not in ('reversed', 'cancelled');--> statement-breakpoint
CREATE INDEX "job_charges_tenant_job_status_idx" ON "job_charges" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE INDEX "material_delivery_details_tenant_readiness_idx" ON "material_delivery_details" USING btree ("tenant_id","invoice_readiness","status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_load_assets_one_current_role_idx" ON "material_load_assets" USING btree ("tenant_id","material_load_id","role") WHERE "material_load_assets"."role" in ('truck', 'trailer') and "material_load_assets"."status" in ('planned', 'active', 'used');--> statement-breakpoint
CREATE INDEX "material_load_assets_tenant_asset_status_idx" ON "material_load_assets" USING btree ("tenant_id","asset_id","status");--> statement-breakpoint
CREATE INDEX "material_load_items_tenant_job_result_idx" ON "material_load_items" USING btree ("tenant_id","job_id","delivery_result");--> statement-breakpoint
CREATE INDEX "material_load_items_tenant_supplier_idx" ON "material_load_items" USING btree ("tenant_id","actual_supplier_material_id");--> statement-breakpoint
CREATE INDEX "material_load_validations_tenant_load_latest_idx" ON "material_load_validations" USING btree ("tenant_id","material_load_id","validation_type","evaluated_at");--> statement-breakpoint
CREATE INDEX "material_loads_tenant_job_status_idx" ON "material_loads" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_quantity_variances_one_open_idx" ON "material_quantity_variances" USING btree ("tenant_id","material_load_item_id","variance_type") WHERE "material_quantity_variances"."status" = 'open';--> statement-breakpoint
CREATE INDEX "material_quantity_variances_tenant_job_status_idx" ON "material_quantity_variances" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_substitutions_one_pending_idx" ON "material_substitutions" USING btree ("tenant_id","material_load_item_id") WHERE "material_substitutions"."status" in ('requested', 'pending_internal', 'pending_customer');--> statement-breakpoint
CREATE INDEX "material_substitutions_tenant_job_status_idx" ON "material_substitutions" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_volume_capacity_check" CHECK ("assets"."capacity_volume_cubic_yards" is null or "assets"."capacity_volume_cubic_yards" > 0);
--> statement-breakpoint
CREATE FUNCTION enforce_material_delivery_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_service_type varchar(40);
BEGIN
  SELECT service_type INTO target_service_type
  FROM jobs
  WHERE tenant_id = NEW.tenant_id AND id = NEW.job_id;

  IF target_service_type IS DISTINCT FROM 'material_delivery' THEN
    RAISE EXCEPTION 'Material Delivery Detail requires a Material Delivery Job';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER material_delivery_details_job_type_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id ON material_delivery_details
FOR EACH ROW EXECUTE FUNCTION enforce_material_delivery_job();
--> statement-breakpoint
CREATE FUNCTION enforce_material_load_item_stop_types()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  supplier_stop_type varchar(30);
  placement_stop_type varchar(30);
BEGIN
  IF NEW.supplier_route_stop_id IS NOT NULL THEN
    SELECT stop_type INTO supplier_stop_type
    FROM route_stops
    WHERE tenant_id = NEW.tenant_id
      AND job_id = NEW.job_id
      AND id = NEW.supplier_route_stop_id;
    IF supplier_stop_type IS DISTINCT FROM 'supplier' THEN
      RAISE EXCEPTION 'Material Load Item supplier stop must be a supplier Route Stop';
    END IF;
  END IF;

  IF NEW.placement_route_stop_id IS NOT NULL THEN
    SELECT stop_type INTO placement_stop_type
    FROM route_stops
    WHERE tenant_id = NEW.tenant_id
      AND job_id = NEW.job_id
      AND id = NEW.placement_route_stop_id;
    IF placement_stop_type IS DISTINCT FROM 'customer' THEN
      RAISE EXCEPTION 'Material Load Item placement stop must be a customer Route Stop';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER material_load_items_stop_type_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, supplier_route_stop_id, placement_route_stop_id
ON material_load_items
FOR EACH ROW EXECUTE FUNCTION enforce_material_load_item_stop_types();
--> statement-breakpoint
CREATE FUNCTION protect_material_delivery_record_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accepted Material Delivery records cannot be deleted; cancel or reverse them';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER material_delivery_details_no_delete_guard BEFORE DELETE ON material_delivery_details
FOR EACH ROW EXECUTE FUNCTION protect_material_delivery_record_deletion();
CREATE TRIGGER material_loads_no_delete_guard BEFORE DELETE ON material_loads
FOR EACH ROW EXECUTE FUNCTION protect_material_delivery_record_deletion();
CREATE TRIGGER material_load_assets_no_delete_guard BEFORE DELETE ON material_load_assets
FOR EACH ROW EXECUTE FUNCTION protect_material_delivery_record_deletion();
CREATE TRIGGER material_load_items_no_delete_guard BEFORE DELETE ON material_load_items
FOR EACH ROW EXECUTE FUNCTION protect_material_delivery_record_deletion();
CREATE TRIGGER material_substitutions_no_delete_guard BEFORE DELETE ON material_substitutions
FOR EACH ROW EXECUTE FUNCTION protect_material_delivery_record_deletion();
CREATE TRIGGER material_quantity_variances_no_delete_guard BEFORE DELETE ON material_quantity_variances
FOR EACH ROW EXECUTE FUNCTION protect_material_delivery_record_deletion();
--> statement-breakpoint
CREATE FUNCTION protect_material_load_validation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Material Load Validations are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER material_load_validations_immutable_guard
BEFORE UPDATE OR DELETE ON material_load_validations
FOR EACH ROW EXECUTE FUNCTION protect_material_load_validation();
--> statement-breakpoint
CREATE FUNCTION enforce_expense_allocation_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_amount bigint;
  target_status varchar(30);
  allocated_amount bigint;
BEGIN
  SELECT amount_cents, status INTO target_amount, target_status
  FROM expenses
  WHERE tenant_id = NEW.tenant_id AND id = NEW.expense_id AND job_id = NEW.job_id
  FOR UPDATE;

  IF target_amount IS NULL THEN
    RAISE EXCEPTION 'Expense Allocation requires an Expense in the same Job';
  END IF;

  IF target_status IN ('reversed', 'cancelled') THEN
    RAISE EXCEPTION 'reversed or cancelled Expenses reject active Allocations';
  END IF;

  IF target_status IN ('approved', 'reconciled') AND NEW.status = 'reversed' THEN
    RAISE EXCEPTION 'approved Expense Allocations require an Expense reversal';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO allocated_amount
  FROM expense_allocations
  WHERE tenant_id = NEW.tenant_id
    AND expense_id = NEW.expense_id
    AND status = 'active'
    AND id <> NEW.id;

  IF NEW.status = 'active' THEN
    allocated_amount := allocated_amount + NEW.amount_cents;
  END IF;

  IF allocated_amount > target_amount THEN
    RAISE EXCEPTION 'active Expense Allocations cannot exceed the Expense amount';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER expense_allocations_balance_guard
BEFORE INSERT OR UPDATE ON expense_allocations
FOR EACH ROW EXECUTE FUNCTION enforce_expense_allocation_balance();
--> statement-breakpoint
CREATE FUNCTION enforce_expense_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocated_amount bigint;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0) INTO allocated_amount
  FROM expense_allocations
  WHERE tenant_id = NEW.tenant_id
    AND expense_id = NEW.id
    AND status = 'active';

  IF allocated_amount > NEW.amount_cents THEN
    RAISE EXCEPTION 'active Expense Allocations cannot exceed the Expense amount';
  END IF;

  IF NEW.status IN ('approved', 'reconciled') AND allocated_amount <> NEW.amount_cents THEN
    RAISE EXCEPTION 'approved or reconciled Expenses require exact active Allocations';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER expenses_reconciliation_guard
BEFORE INSERT OR UPDATE OF amount_cents, status ON expenses
FOR EACH ROW EXECUTE FUNCTION enforce_expense_reconciliation();
--> statement-breakpoint
CREATE FUNCTION protect_expense_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Expenses cannot be deleted; create a reversal';
  END IF;

  IF OLD.status IN ('approved', 'reconciled', 'reversed')
    AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.job_id IS DISTINCT FROM OLD.job_id
      OR NEW.expense_number IS DISTINCT FROM OLD.expense_number
      OR NEW.expense_kind IS DISTINCT FROM OLD.expense_kind
      OR NEW.expense_type IS DISTINCT FROM OLD.expense_type
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
      OR NEW.supplier_location_id IS DISTINCT FROM OLD.supplier_location_id
      OR NEW.receipt_document_id IS DISTINCT FROM OLD.receipt_document_id
      OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
      OR NEW.incurred_at IS DISTINCT FROM OLD.incurred_at
      OR NEW.reverses_expense_id IS DISTINCT FROM OLD.reverses_expense_id) THEN
    RAISE EXCEPTION 'approved Expense facts are immutable; create a reversal';
  END IF;

  IF OLD.status = 'reversed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'reversed Expenses are terminal';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER expenses_history_guard
BEFORE UPDATE OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION protect_expense_history();
--> statement-breakpoint
CREATE FUNCTION protect_expense_allocation_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Expense Allocations cannot be deleted; reverse them';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.expense_id IS DISTINCT FROM OLD.expense_id
    OR NEW.material_load_item_id IS DISTINCT FROM OLD.material_load_item_id
    OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents THEN
    RAISE EXCEPTION 'Expense Allocation facts are immutable; reverse the Allocation';
  END IF;

  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'reversed Expense Allocations are terminal';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER expense_allocations_history_guard
BEFORE UPDATE OR DELETE ON expense_allocations
FOR EACH ROW EXECUTE FUNCTION protect_expense_allocation_history();
--> statement-breakpoint
CREATE FUNCTION protect_job_charge_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Job Charges cannot be deleted; cancel or reverse them';
  END IF;

  IF OLD.status IN ('approved', 'partially_approved', 'ready_to_invoice', 'invoiced',
      'partially_invoiced', 'credited', 'reversed', 'resolved')
    AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.job_id IS DISTINCT FROM OLD.job_id
      OR NEW.charge_number IS DISTINCT FROM OLD.charge_number
      OR NEW.charge_kind IS DISTINCT FROM OLD.charge_kind
      OR NEW.charge_type IS DISTINCT FROM OLD.charge_type
      OR NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.source_id IS DISTINCT FROM OLD.source_id
      OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
      OR NEW.responsibility IS DISTINCT FROM OLD.responsibility
      OR NEW.quantity IS DISTINCT FROM OLD.quantity
      OR NEW.unit IS DISTINCT FROM OLD.unit
      OR NEW.rate_cents IS DISTINCT FROM OLD.rate_cents
      OR NEW.calculated_amount_cents IS DISTINCT FROM OLD.calculated_amount_cents
      OR NEW.proposed_amount_cents IS DISTINCT FROM OLD.proposed_amount_cents
      OR NEW.approved_amount_cents IS DISTINCT FROM OLD.approved_amount_cents
      OR NEW.calculation_snapshot IS DISTINCT FROM OLD.calculation_snapshot
      OR NEW.customer_description IS DISTINCT FROM OLD.customer_description
      OR NEW.tax_behavior IS DISTINCT FROM OLD.tax_behavior
      OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
      OR NEW.reverses_job_charge_id IS DISTINCT FROM OLD.reverses_job_charge_id) THEN
    RAISE EXCEPTION 'approved Job Charge facts are immutable; create a reversal';
  END IF;

  IF OLD.status = 'reversed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'reversed Job Charges are terminal';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER job_charges_history_guard
BEFORE UPDATE OR DELETE ON job_charges
FOR EACH ROW EXECUTE FUNCTION protect_job_charge_history();
--> statement-breakpoint
CREATE TRIGGER expense_allocations_row_update BEFORE UPDATE ON expense_allocations
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER expenses_row_update BEFORE UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER job_charges_row_update BEFORE UPDATE ON job_charges
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER material_delivery_details_row_update BEFORE UPDATE ON material_delivery_details
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER material_load_assets_row_update BEFORE UPDATE ON material_load_assets
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER material_load_items_row_update BEFORE UPDATE ON material_load_items
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER material_loads_row_update BEFORE UPDATE ON material_loads
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER material_quantity_variances_row_update BEFORE UPDATE ON material_quantity_variances
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER material_substitutions_row_update BEFORE UPDATE ON material_substitutions
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER expense_allocations_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON expense_allocations
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER expenses_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER job_charges_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON job_charges
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER material_delivery_details_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON material_delivery_details
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER material_load_assets_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON material_load_assets
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER material_load_items_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON material_load_items
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER material_load_validations_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON material_load_validations
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER material_loads_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON material_loads
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER material_quantity_variances_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON material_quantity_variances
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER material_substitutions_closed_job_guard BEFORE INSERT OR UPDATE OR DELETE ON material_substitutions
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'expense_allocations', 'expenses', 'job_charges', 'material_delivery_details',
    'material_load_assets', 'material_load_items', 'material_load_validations', 'material_loads',
    'material_quantity_variances', 'material_substitutions'
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
REVOKE ALL ON expense_allocations, expenses, job_charges, material_delivery_details,
  material_load_assets, material_load_items, material_load_validations, material_loads,
  material_quantity_variances, material_substitutions FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON expense_allocations, expenses, job_charges,
      material_delivery_details, material_load_assets, material_load_items, material_loads,
      material_quantity_variances, material_substitutions TO ldg_app;
    GRANT SELECT, INSERT ON material_load_validations TO ldg_app;
  END IF;
END;
$$;
