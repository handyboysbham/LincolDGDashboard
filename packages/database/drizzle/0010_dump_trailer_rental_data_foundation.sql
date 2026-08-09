CREATE TABLE "disposal_loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"rental_detail_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"redirected_from_disposal_load_id" uuid,
	"route_stop_id" uuid,
	"planned_facility_location_id" uuid,
	"actual_facility_location_id" uuid,
	"status" varchar(40) DEFAULT 'planned' NOT NULL,
	"debris_classification" varchar(120) NOT NULL,
	"acceptance_result" varchar(30) DEFAULT 'pending' NOT NULL,
	"unloading_result" varchar(30) DEFAULT 'pending' NOT NULL,
	"weight_status" varchar(30) DEFAULT 'required' NOT NULL,
	"source_weight_unit" varchar(20) DEFAULT 'pounds' NOT NULL,
	"gross_weight" numeric(14, 3),
	"tare_weight" numeric(14, 3),
	"net_weight" numeric(14, 3),
	"canonical_net_weight_pounds" numeric(14, 3),
	"weight_exception_reason" text,
	"ticket_status" varchar(30) DEFAULT 'missing' NOT NULL,
	"ticket_document_id" uuid,
	"receipt_status" varchar(30) DEFAULT 'missing' NOT NULL,
	"receipt_document_id" uuid,
	"empty_trailer_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"empty_trailer_document_id" uuid,
	"evidence_waiver_reason" text,
	"evidence_waived_at" timestamp with time zone,
	"evidence_waived_by" uuid,
	"remaining_material_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"disposal_fee_cents" bigint,
	"expense_id" uuid,
	"rejection_reason" text,
	"arrived_at" timestamp with time zone,
	"unloaded_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"reconciled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "disposal_loads_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "disposal_loads_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id"),
	CONSTRAINT "disposal_loads_sequence_unique" UNIQUE("tenant_id","rental_detail_id","sequence"),
	CONSTRAINT "disposal_loads_expense_unique" UNIQUE("tenant_id","expense_id"),
	CONSTRAINT "disposal_loads_sequence_check" CHECK ("disposal_loads"."sequence" > 0),
	CONSTRAINT "disposal_loads_status_check" CHECK ("disposal_loads"."status" in ('planned', 'facility_review', 'ready', 'en_route', 'at_facility', 'acceptance_pending', 'accepted', 'weighed_in', 'unloading', 'partially_unloaded', 'unloaded', 'weighed_out', 'documentation_pending', 'reconciling', 'reconciled', 'rejected', 'redirected', 'cancelled')),
	CONSTRAINT "disposal_loads_acceptance_check" CHECK ("disposal_loads"."acceptance_result" in ('pending', 'accepted', 'rejected')),
	CONSTRAINT "disposal_loads_unloading_check" CHECK ("disposal_loads"."unloading_result" in ('pending', 'partial', 'unloaded', 'not_unloaded')),
	CONSTRAINT "disposal_loads_weight_status_check" CHECK ("disposal_loads"."weight_status" in ('required', 'recorded', 'not_applicable', 'waived') and "disposal_loads"."source_weight_unit" in ('pounds', 'tons')),
	CONSTRAINT "disposal_loads_weight_values_check" CHECK (("disposal_loads"."gross_weight" is null or "disposal_loads"."gross_weight" >= 0) and ("disposal_loads"."tare_weight" is null or "disposal_loads"."tare_weight" >= 0) and ("disposal_loads"."net_weight" is null or "disposal_loads"."net_weight" >= 0) and ("disposal_loads"."canonical_net_weight_pounds" is null or "disposal_loads"."canonical_net_weight_pounds" >= 0)),
	CONSTRAINT "disposal_loads_recorded_weight_check" CHECK ("disposal_loads"."weight_status" <> 'recorded' or ("disposal_loads"."gross_weight" is not null and "disposal_loads"."tare_weight" is not null and "disposal_loads"."net_weight" = "disposal_loads"."gross_weight" - "disposal_loads"."tare_weight" and "disposal_loads"."gross_weight" >= "disposal_loads"."tare_weight" and "disposal_loads"."canonical_net_weight_pounds" is not null)),
	CONSTRAINT "disposal_loads_weight_exception_check" CHECK ("disposal_loads"."weight_status" not in ('not_applicable', 'waived') or "disposal_loads"."weight_exception_reason" is not null),
	CONSTRAINT "disposal_loads_ticket_status_check" CHECK ("disposal_loads"."ticket_status" in ('missing', 'attached', 'waived', 'not_required') and ("disposal_loads"."ticket_status" <> 'attached' or "disposal_loads"."ticket_document_id" is not null)),
	CONSTRAINT "disposal_loads_receipt_status_check" CHECK ("disposal_loads"."receipt_status" in ('missing', 'attached', 'waived', 'not_required') and ("disposal_loads"."receipt_status" <> 'attached' or "disposal_loads"."receipt_document_id" is not null)),
	CONSTRAINT "disposal_loads_evidence_waiver_check" CHECK ("disposal_loads"."ticket_status" <> 'waived' and "disposal_loads"."receipt_status" <> 'waived' or ("disposal_loads"."evidence_waiver_reason" is not null and "disposal_loads"."evidence_waived_at" is not null and "disposal_loads"."evidence_waived_by" is not null)),
	CONSTRAINT "disposal_loads_empty_status_check" CHECK ("disposal_loads"."empty_trailer_status" in ('pending', 'confirmed_empty', 'not_empty') and ("disposal_loads"."empty_trailer_status" <> 'confirmed_empty' or "disposal_loads"."empty_trailer_document_id" is not null)),
	CONSTRAINT "disposal_loads_remaining_status_check" CHECK ("disposal_loads"."remaining_material_status" in ('pending', 'none', 'remaining', 'resolved')),
	CONSTRAINT "disposal_loads_fee_check" CHECK ("disposal_loads"."disposal_fee_cents" is null or "disposal_loads"."disposal_fee_cents" >= 0),
	CONSTRAINT "disposal_loads_rejection_check" CHECK ("disposal_loads"."acceptance_result" <> 'rejected' or "disposal_loads"."rejection_reason" is not null),
	CONSTRAINT "disposal_loads_reconciled_check" CHECK ("disposal_loads"."status" <> 'reconciled' or ("disposal_loads"."actual_facility_location_id" is not null and "disposal_loads"."acceptance_result" = 'accepted' and "disposal_loads"."unloading_result" = 'unloaded' and "disposal_loads"."weight_status" in ('recorded', 'not_applicable', 'waived') and "disposal_loads"."ticket_status" in ('attached', 'waived', 'not_required') and "disposal_loads"."receipt_status" in ('attached', 'waived', 'not_required') and "disposal_loads"."empty_trailer_status" = 'confirmed_empty' and "disposal_loads"."remaining_material_status" in ('none', 'resolved') and ("disposal_loads"."disposal_fee_cents" is null or "disposal_loads"."disposal_fee_cents" = 0 or "disposal_loads"."expense_id" is not null) and "disposal_loads"."reconciled_at" is not null and "disposal_loads"."reconciled_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "dump_trailer_rental_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"accepted_quote_version_id" uuid NOT NULL,
	"status" varchar(40) DEFAULT 'planning' NOT NULL,
	"rate_type" varchar(30) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"accepted_terms_hash" varchar(64) NOT NULL,
	"accepted_terms_snapshot" jsonb NOT NULL,
	"included_days" integer NOT NULL,
	"additional_day_rate_cents" bigint NOT NULL,
	"included_weight_pounds" numeric(14, 3) NOT NULL,
	"overage_rate_cents_per_pound" bigint NOT NULL,
	"deposit_amount_cents" bigint DEFAULT 0 NOT NULL,
	"deposit_classification" varchar(40) DEFAULT 'none' NOT NULL,
	"planned_dropoff_at" timestamp with time zone NOT NULL,
	"planned_pickup_at" timestamp with time zone NOT NULL,
	"trailer_asset_id" uuid,
	"trailer_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"debris_review_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"access_review_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"empty_trailer_status" varchar(30) DEFAULT 'unknown' NOT NULL,
	"final_condition" varchar(40) DEFAULT 'pending_inspection' NOT NULL,
	"invoice_readiness" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"actual_dropoff_at" timestamp with time zone,
	"on_rent_at" timestamp with time zone,
	"customer_custody_ended_at" timestamp with time zone,
	"actual_pickup_at" timestamp with time zone,
	"occupancy_released_at" timestamp with time zone,
	"total_actual_weight_pounds" numeric(14, 3) DEFAULT '0' NOT NULL,
	"overage_weight_pounds" numeric(14, 3) DEFAULT '0' NOT NULL,
	"operationally_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "rental_details_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "rental_details_tenant_job_unique" UNIQUE("tenant_id","job_id"),
	CONSTRAINT "rental_details_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id"),
	CONSTRAINT "rental_details_status_check" CHECK ("dump_trailer_rental_details"."status" in ('planning', 'scheduled_dropoff', 'dropoff_preparing', 'en_route_dropoff', 'at_customer_dropoff', 'delivered', 'on_rent', 'pickup_scheduled', 'pickup_preparing', 'en_route_pickup', 'at_customer_pickup', 'picked_up', 'awaiting_disposal', 'at_facility', 'unloading', 'inspection_required', 'returned', 'operationally_complete', 'on_hold', 'cancelled')),
	CONSTRAINT "rental_details_rate_type_check" CHECK ("dump_trailer_rental_details"."rate_type" in ('daily', 'weekend', 'weekly', 'custom')),
	CONSTRAINT "rental_details_currency_check" CHECK (length("dump_trailer_rental_details"."currency") = 3),
	CONSTRAINT "rental_details_terms_hash_check" CHECK (length("dump_trailer_rental_details"."accepted_terms_hash") = 64),
	CONSTRAINT "rental_details_included_days_check" CHECK ("dump_trailer_rental_details"."included_days" > 0),
	CONSTRAINT "rental_details_additional_rate_check" CHECK ("dump_trailer_rental_details"."additional_day_rate_cents" >= 0),
	CONSTRAINT "rental_details_included_weight_check" CHECK ("dump_trailer_rental_details"."included_weight_pounds" >= 0),
	CONSTRAINT "rental_details_overage_rate_check" CHECK ("dump_trailer_rental_details"."overage_rate_cents_per_pound" >= 0),
	CONSTRAINT "rental_details_deposit_check" CHECK ("dump_trailer_rental_details"."deposit_amount_cents" >= 0),
	CONSTRAINT "rental_details_deposit_classification_check" CHECK ("dump_trailer_rental_details"."deposit_classification" in ('none', 'advance_payment', 'refundable_security')),
	CONSTRAINT "rental_details_planned_range_check" CHECK ("dump_trailer_rental_details"."planned_pickup_at" > "dump_trailer_rental_details"."planned_dropoff_at"),
	CONSTRAINT "rental_details_debris_status_check" CHECK ("dump_trailer_rental_details"."debris_review_status" in ('pending', 'approved', 'hold', 'rejected')),
	CONSTRAINT "rental_details_access_status_check" CHECK ("dump_trailer_rental_details"."access_review_status" in ('pending', 'pass', 'fail')),
	CONSTRAINT "rental_details_empty_status_check" CHECK ("dump_trailer_rental_details"."empty_trailer_status" in ('unknown', 'confirmed_empty', 'not_empty')),
	CONSTRAINT "rental_details_condition_check" CHECK ("dump_trailer_rental_details"."final_condition" in ('pending_inspection', 'acceptable', 'acceptable_after_cleaning', 'maintenance_review', 'damage_review', 'out_of_service', 'undetermined')),
	CONSTRAINT "rental_details_invoice_readiness_check" CHECK ("dump_trailer_rental_details"."invoice_readiness" in ('evaluation_required', 'ready', 'not_ready')),
	CONSTRAINT "rental_details_weight_check" CHECK ("dump_trailer_rental_details"."total_actual_weight_pounds" >= 0 and "dump_trailer_rental_details"."overage_weight_pounds" >= 0),
	CONSTRAINT "rental_details_custody_check" CHECK ("dump_trailer_rental_details"."customer_custody_ended_at" is null or ("dump_trailer_rental_details"."on_rent_at" is not null and "dump_trailer_rental_details"."customer_custody_ended_at" >= "dump_trailer_rental_details"."on_rent_at")),
	CONSTRAINT "rental_details_release_check" CHECK ("dump_trailer_rental_details"."occupancy_released_at" is null or ("dump_trailer_rental_details"."customer_custody_ended_at" is not null and "dump_trailer_rental_details"."occupancy_released_at" >= "dump_trailer_rental_details"."customer_custody_ended_at"))
);
--> statement-breakpoint
CREATE TABLE "rental_debris_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"rental_detail_id" uuid NOT NULL,
	"review_number" integer NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"primary_debris_type" varchar(100) NOT NULL,
	"secondary_debris_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prohibited_materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restricted_materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mixed_debris" boolean DEFAULT false NOT NULL,
	"heavy_material" boolean DEFAULT false NOT NULL,
	"customer_attested" boolean DEFAULT false NOT NULL,
	"customer_attested_at" timestamp with time zone,
	"customer_attestation" text,
	"access_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"legal_towing_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"placement_instructions" text,
	"pickup_access_requirement" text,
	"property_damage_risk" text,
	"outcome_notes" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "rental_debris_reviews_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "rental_debris_reviews_sequence_unique" UNIQUE("tenant_id","rental_detail_id","review_number"),
	CONSTRAINT "rental_debris_reviews_number_check" CHECK ("rental_debris_reviews"."review_number" > 0),
	CONSTRAINT "rental_debris_reviews_status_check" CHECK ("rental_debris_reviews"."status" in ('pending', 'approved', 'hold', 'rejected', 'superseded')),
	CONSTRAINT "rental_debris_reviews_access_check" CHECK ("rental_debris_reviews"."access_status" in ('pending', 'pass', 'fail') and "rental_debris_reviews"."legal_towing_status" in ('pending', 'pass', 'fail')),
	CONSTRAINT "rental_debris_reviews_attestation_check" CHECK (not "rental_debris_reviews"."customer_attested" or ("rental_debris_reviews"."customer_attested_at" is not null and "rental_debris_reviews"."customer_attestation" is not null)),
	CONSTRAINT "rental_debris_reviews_decision_check" CHECK ("rental_debris_reviews"."status" = 'pending' or ("rental_debris_reviews"."reviewed_at" is not null and "rental_debris_reviews"."reviewed_by" is not null and "rental_debris_reviews"."outcome_notes" is not null)),
	CONSTRAINT "rental_debris_reviews_approval_check" CHECK ("rental_debris_reviews"."status" <> 'approved' or ("rental_debris_reviews"."customer_attested" and "rental_debris_reviews"."access_status" = 'pass' and "rental_debris_reviews"."legal_towing_status" = 'pass' and jsonb_array_length("rental_debris_reviews"."prohibited_materials") = 0))
);
--> statement-breakpoint
CREATE TABLE "rental_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"rental_detail_id" uuid NOT NULL,
	"extension_number" integer NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"status" varchar(40) DEFAULT 'requested' NOT NULL,
	"previous_pickup_at" timestamp with time zone NOT NULL,
	"requested_pickup_at" timestamp with time zone NOT NULL,
	"additional_days" integer NOT NULL,
	"rate_cents" bigint NOT NULL,
	"calculated_amount_cents" bigint NOT NULL,
	"conflict_status" varchar(30) DEFAULT 'evaluation_required' NOT NULL,
	"availability_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customer_authorization_status" varchar(30) DEFAULT 'required' NOT NULL,
	"pickup_schedule_block_id" uuid NOT NULL,
	"occupancy_reservation_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "rental_extensions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "rental_extensions_sequence_unique" UNIQUE("tenant_id","rental_detail_id","extension_number"),
	CONSTRAINT "rental_extensions_dedupe_unique" UNIQUE("tenant_id","job_id","dedupe_key"),
	CONSTRAINT "rental_extensions_number_check" CHECK ("rental_extensions"."extension_number" > 0),
	CONSTRAINT "rental_extensions_status_check" CHECK ("rental_extensions"."status" in ('requested', 'availability_review', 'awaiting_customer_authorization', 'awaiting_internal_approval', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "rental_extensions_range_check" CHECK ("rental_extensions"."requested_pickup_at" > "rental_extensions"."previous_pickup_at"),
	CONSTRAINT "rental_extensions_days_check" CHECK ("rental_extensions"."additional_days" > 0),
	CONSTRAINT "rental_extensions_amount_check" CHECK ("rental_extensions"."rate_cents" >= 0 and "rental_extensions"."calculated_amount_cents" = "rental_extensions"."additional_days" * "rental_extensions"."rate_cents"),
	CONSTRAINT "rental_extensions_conflict_check" CHECK ("rental_extensions"."conflict_status" in ('evaluation_required', 'pass', 'fail')),
	CONSTRAINT "rental_extensions_customer_auth_check" CHECK ("rental_extensions"."customer_authorization_status" in ('not_required', 'required', 'pending', 'authorized', 'declined')),
	CONSTRAINT "rental_extensions_decision_check" CHECK ("rental_extensions"."status" not in ('approved', 'rejected') or ("rental_extensions"."decided_at" is not null and "rental_extensions"."decided_by" is not null and "rental_extensions"."decision_reason" is not null)),
	CONSTRAINT "rental_extensions_approval_check" CHECK ("rental_extensions"."status" <> 'approved' or ("rental_extensions"."conflict_status" = 'pass' and "rental_extensions"."customer_authorization_status" in ('authorized', 'not_required') and "rental_extensions"."availability_snapshot" <> '{}'::jsonb))
);
--> statement-breakpoint
CREATE TABLE "rental_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"rental_detail_id" uuid NOT NULL,
	"inspection_number" integer NOT NULL,
	"inspection_type" varchar(30) NOT NULL,
	"trailer_asset_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"condition_result" varchar(40) DEFAULT 'undetermined' NOT NULL,
	"cleaning_result" varchar(30) DEFAULT 'not_required' NOT NULL,
	"damage_result" varchar(30) DEFAULT 'none' NOT NULL,
	"release_decision" varchar(30) DEFAULT 'pending' NOT NULL,
	"safe_to_release" boolean DEFAULT false NOT NULL,
	"evidence_document_id" uuid,
	"evidence_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"inspected_at" timestamp with time zone,
	"inspected_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "rental_inspections_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "rental_inspections_sequence_unique" UNIQUE("tenant_id","rental_detail_id","inspection_number"),
	CONSTRAINT "rental_inspections_number_check" CHECK ("rental_inspections"."inspection_number" > 0),
	CONSTRAINT "rental_inspections_type_check" CHECK ("rental_inspections"."inspection_type" in ('pre_dropoff', 'post_rental', 'cleaning_follow_up', 'damage_follow_up', 'maintenance_follow_up')),
	CONSTRAINT "rental_inspections_status_check" CHECK ("rental_inspections"."status" in ('pending', 'in_progress', 'completed', 'waived')),
	CONSTRAINT "rental_inspections_condition_check" CHECK ("rental_inspections"."condition_result" in ('acceptable', 'acceptable_after_cleaning', 'maintenance_review', 'damage_review', 'out_of_service', 'undetermined')),
	CONSTRAINT "rental_inspections_cleaning_check" CHECK ("rental_inspections"."cleaning_result" in ('not_required', 'normal', 'required', 'completed')),
	CONSTRAINT "rental_inspections_damage_check" CHECK ("rental_inspections"."damage_result" in ('none', 'review_required', 'damage_confirmed', 'resolved')),
	CONSTRAINT "rental_inspections_release_check" CHECK ("rental_inspections"."release_decision" in ('pending', 'release', 'quarantine', 'out_of_service') and ("rental_inspections"."release_decision" <> 'release' or "rental_inspections"."safe_to_release")),
	CONSTRAINT "rental_inspections_completion_check" CHECK ("rental_inspections"."status" not in ('completed', 'waived') or ("rental_inspections"."inspected_at" is not null and "rental_inspections"."inspected_by" is not null and "rental_inspections"."completed_at" is not null and "rental_inspections"."notes" is not null))
);
--> statement-breakpoint
CREATE TABLE "rental_pickup_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"rental_detail_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"schedule_block_id" uuid NOT NULL,
	"route_stop_id" uuid,
	"trailer_asset_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'planned' NOT NULL,
	"access_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"safe_load_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"attempted_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"customer_notified_at" timestamp with time zone,
	"customer_custody_ended_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"outcome_notes" text,
	"attempted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "rental_pickup_attempts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "rental_pickup_attempts_sequence_unique" UNIQUE("tenant_id","rental_detail_id","attempt_number"),
	CONSTRAINT "rental_pickup_attempts_number_check" CHECK ("rental_pickup_attempts"."attempt_number" > 0),
	CONSTRAINT "rental_pickup_attempts_status_check" CHECK ("rental_pickup_attempts"."status" in ('planned', 'en_route', 'arrived', 'retrieved', 'failed', 'cancelled')),
	CONSTRAINT "rental_pickup_attempts_access_check" CHECK ("rental_pickup_attempts"."access_status" in ('pending', 'pass', 'fail') and "rental_pickup_attempts"."safe_load_status" in ('pending', 'pass', 'fail')),
	CONSTRAINT "rental_pickup_attempts_retrieved_check" CHECK ("rental_pickup_attempts"."status" <> 'retrieved' or ("rental_pickup_attempts"."access_status" = 'pass' and "rental_pickup_attempts"."safe_load_status" = 'pass' and "rental_pickup_attempts"."customer_custody_ended_at" is not null and "rental_pickup_attempts"."completed_at" is not null)),
	CONSTRAINT "rental_pickup_attempts_failure_check" CHECK ("rental_pickup_attempts"."status" <> 'failed' or ("rental_pickup_attempts"."failure_reason" is not null and "rental_pickup_attempts"."attempted_at" is not null and "rental_pickup_attempts"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "job_charges" DROP CONSTRAINT "job_charges_source_type_check";--> statement-breakpoint
ALTER TABLE "asset_reservations" ADD CONSTRAINT "asset_reservations_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id");--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id");--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_detail_job_fk" FOREIGN KEY ("tenant_id","rental_detail_id","job_id") REFERENCES "public"."dump_trailer_rental_details"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_redirect_job_fk" FOREIGN KEY ("tenant_id","redirected_from_disposal_load_id","job_id") REFERENCES "public"."disposal_loads"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_stop_job_fk" FOREIGN KEY ("tenant_id","route_stop_id","job_id") REFERENCES "public"."route_stops"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_planned_facility_fk" FOREIGN KEY ("tenant_id","planned_facility_location_id") REFERENCES "public"."supplier_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_actual_facility_fk" FOREIGN KEY ("tenant_id","actual_facility_location_id") REFERENCES "public"."supplier_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_ticket_document_fk" FOREIGN KEY ("tenant_id","ticket_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_receipt_document_fk" FOREIGN KEY ("tenant_id","receipt_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_empty_document_fk" FOREIGN KEY ("tenant_id","empty_trailer_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_evidence_waiver_fk" FOREIGN KEY ("tenant_id","evidence_waived_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_expense_job_fk" FOREIGN KEY ("tenant_id","expense_id","job_id") REFERENCES "public"."expenses"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_loads" ADD CONSTRAINT "disposal_loads_tenant_reconciler_fk" FOREIGN KEY ("tenant_id","reconciled_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dump_trailer_rental_details" ADD CONSTRAINT "dump_trailer_rental_details_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dump_trailer_rental_details" ADD CONSTRAINT "rental_details_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dump_trailer_rental_details" ADD CONSTRAINT "rental_details_tenant_quote_version_fk" FOREIGN KEY ("tenant_id","accepted_quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dump_trailer_rental_details" ADD CONSTRAINT "rental_details_tenant_trailer_fk" FOREIGN KEY ("tenant_id","trailer_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_debris_reviews" ADD CONSTRAINT "rental_debris_reviews_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_debris_reviews" ADD CONSTRAINT "rental_debris_reviews_tenant_detail_job_fk" FOREIGN KEY ("tenant_id","rental_detail_id","job_id") REFERENCES "public"."dump_trailer_rental_details"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_debris_reviews" ADD CONSTRAINT "rental_debris_reviews_tenant_reviewer_fk" FOREIGN KEY ("tenant_id","reviewed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_extensions" ADD CONSTRAINT "rental_extensions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_extensions" ADD CONSTRAINT "rental_extensions_tenant_detail_job_fk" FOREIGN KEY ("tenant_id","rental_detail_id","job_id") REFERENCES "public"."dump_trailer_rental_details"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_extensions" ADD CONSTRAINT "rental_extensions_tenant_pickup_job_fk" FOREIGN KEY ("tenant_id","pickup_schedule_block_id","job_id") REFERENCES "public"."schedule_blocks"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_extensions" ADD CONSTRAINT "rental_extensions_tenant_occupancy_job_fk" FOREIGN KEY ("tenant_id","occupancy_reservation_id","job_id") REFERENCES "public"."asset_reservations"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_extensions" ADD CONSTRAINT "rental_extensions_tenant_requester_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_extensions" ADD CONSTRAINT "rental_extensions_tenant_decider_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_inspections" ADD CONSTRAINT "rental_inspections_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_inspections" ADD CONSTRAINT "rental_inspections_tenant_detail_job_fk" FOREIGN KEY ("tenant_id","rental_detail_id","job_id") REFERENCES "public"."dump_trailer_rental_details"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_inspections" ADD CONSTRAINT "rental_inspections_tenant_trailer_fk" FOREIGN KEY ("tenant_id","trailer_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_inspections" ADD CONSTRAINT "rental_inspections_tenant_evidence_fk" FOREIGN KEY ("tenant_id","evidence_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_inspections" ADD CONSTRAINT "rental_inspections_tenant_inspector_fk" FOREIGN KEY ("tenant_id","inspected_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_pickup_attempts" ADD CONSTRAINT "rental_pickup_attempts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_pickup_attempts" ADD CONSTRAINT "rental_pickup_attempts_tenant_detail_job_fk" FOREIGN KEY ("tenant_id","rental_detail_id","job_id") REFERENCES "public"."dump_trailer_rental_details"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_pickup_attempts" ADD CONSTRAINT "rental_pickup_attempts_tenant_block_job_fk" FOREIGN KEY ("tenant_id","schedule_block_id","job_id") REFERENCES "public"."schedule_blocks"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_pickup_attempts" ADD CONSTRAINT "rental_pickup_attempts_tenant_stop_job_fk" FOREIGN KEY ("tenant_id","route_stop_id","job_id") REFERENCES "public"."route_stops"("tenant_id","id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_pickup_attempts" ADD CONSTRAINT "rental_pickup_attempts_tenant_trailer_fk" FOREIGN KEY ("tenant_id","trailer_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_pickup_attempts" ADD CONSTRAINT "rental_pickup_attempts_tenant_driver_fk" FOREIGN KEY ("tenant_id","attempted_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disposal_loads_tenant_job_status_idx" ON "disposal_loads" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE INDEX "disposal_loads_tenant_facility_status_idx" ON "disposal_loads" USING btree ("tenant_id","actual_facility_location_id","status");--> statement-breakpoint
CREATE INDEX "rental_details_tenant_status_idx" ON "dump_trailer_rental_details" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "rental_details_tenant_readiness_idx" ON "dump_trailer_rental_details" USING btree ("tenant_id","invoice_readiness","status");--> statement-breakpoint
CREATE INDEX "rental_debris_reviews_tenant_job_status_idx" ON "rental_debris_reviews" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE INDEX "rental_extensions_tenant_job_status_idx" ON "rental_extensions" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE INDEX "rental_inspections_tenant_job_status_idx" ON "rental_inspections" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_inspections_one_open_type_idx" ON "rental_inspections" USING btree ("tenant_id","rental_detail_id","inspection_type") WHERE "rental_inspections"."status" in ('pending', 'in_progress');--> statement-breakpoint
CREATE INDEX "rental_pickup_attempts_tenant_job_status_idx" ON "rental_pickup_attempts" USING btree ("tenant_id","job_id","status");--> statement-breakpoint
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_source_type_check" CHECK ("job_charges"."source_type" in ('material_delivery_detail', 'material_load', 'material_load_item', 'material_substitution', 'quantity_variance', 'dump_trailer_rental_detail', 'rental_extension', 'rental_pickup_attempt', 'disposal_load', 'rental_inspection', 'route_stop', 'manual'));
--> statement-breakpoint
CREATE FUNCTION enforce_dump_trailer_rental_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_service_type varchar(40);
  project_quote_version_id uuid;
BEGIN
  SELECT j.service_type, p.accepted_quote_version_id
  INTO target_service_type, project_quote_version_id
  FROM jobs j
  JOIN projects p ON p.tenant_id = j.tenant_id AND p.id = j.project_id
  WHERE j.tenant_id = NEW.tenant_id AND j.id = NEW.job_id;

  IF target_service_type IS DISTINCT FROM 'dump_trailer_rental' THEN
    RAISE EXCEPTION 'Dump Trailer Rental Detail requires a Dump Trailer Rental Job';
  END IF;

  IF project_quote_version_id IS DISTINCT FROM NEW.accepted_quote_version_id THEN
    RAISE EXCEPTION 'Rental accepted terms must reference the Project accepted Quote Version';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dump_trailer_rental_details_job_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, accepted_quote_version_id
ON dump_trailer_rental_details
FOR EACH ROW EXECUTE FUNCTION enforce_dump_trailer_rental_job();
--> statement-breakpoint
CREATE FUNCTION enforce_rental_trailer_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_asset_type varchar(40);
  detail_trailer_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'dump_trailer_rental_details' THEN
    IF NEW.trailer_asset_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT trailer_asset_id INTO detail_trailer_id
    FROM dump_trailer_rental_details
    WHERE tenant_id = NEW.tenant_id AND id = NEW.rental_detail_id AND job_id = NEW.job_id;

    IF detail_trailer_id IS NULL OR detail_trailer_id IS DISTINCT FROM NEW.trailer_asset_id THEN
      RAISE EXCEPTION 'Rental execution trailer must match the Rental Detail trailer';
    END IF;
  END IF;

  SELECT asset_type INTO target_asset_type
  FROM assets
  WHERE tenant_id = NEW.tenant_id AND id = NEW.trailer_asset_id;

  IF target_asset_type IS DISTINCT FROM 'trailer' THEN
    RAISE EXCEPTION 'Dump Trailer Rental requires a trailer Asset';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dump_trailer_rental_details_trailer_guard
BEFORE INSERT OR UPDATE OF tenant_id, trailer_asset_id ON dump_trailer_rental_details
FOR EACH ROW EXECUTE FUNCTION enforce_rental_trailer_asset();
CREATE TRIGGER rental_pickup_attempts_trailer_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, rental_detail_id, trailer_asset_id
ON rental_pickup_attempts
FOR EACH ROW EXECUTE FUNCTION enforce_rental_trailer_asset();
CREATE TRIGGER rental_inspections_trailer_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, rental_detail_id, trailer_asset_id
ON rental_inspections
FOR EACH ROW EXECUTE FUNCTION enforce_rental_trailer_asset();
--> statement-breakpoint
CREATE FUNCTION enforce_rental_extension_resources()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pickup_type varchar(40);
  pickup_status varchar(30);
  target_reservation_type varchar(30);
  reservation_status varchar(30);
  reservation_asset_id uuid;
  detail_trailer_id uuid;
BEGIN
  SELECT block_type, status INTO pickup_type, pickup_status
  FROM schedule_blocks
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.pickup_schedule_block_id
    AND job_id = NEW.job_id;

  SELECT ar.reservation_type, ar.status, ar.asset_id
  INTO target_reservation_type, reservation_status, reservation_asset_id
  FROM asset_reservations ar
  WHERE ar.tenant_id = NEW.tenant_id
    AND ar.id = NEW.occupancy_reservation_id
    AND ar.job_id = NEW.job_id;

  SELECT trailer_asset_id INTO detail_trailer_id
  FROM dump_trailer_rental_details
  WHERE tenant_id = NEW.tenant_id AND id = NEW.rental_detail_id AND job_id = NEW.job_id;

  IF pickup_type IS DISTINCT FROM 'pickup' THEN
    RAISE EXCEPTION 'Rental Extension requires the Job pickup Schedule Block';
  END IF;

  IF target_reservation_type IS DISTINCT FROM 'occupancy'
    OR reservation_asset_id IS DISTINCT FROM detail_trailer_id THEN
    RAISE EXCEPTION 'Rental Extension requires the Rental trailer occupancy reservation';
  END IF;

  IF NEW.status = 'approved'
    AND (pickup_status = 'cancelled' OR reservation_status <> 'active') THEN
    RAISE EXCEPTION 'Rental Extension cannot approve inactive scheduling resources';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rental_extensions_resource_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, rental_detail_id, pickup_schedule_block_id,
  occupancy_reservation_id, status
ON rental_extensions
FOR EACH ROW EXECUTE FUNCTION enforce_rental_extension_resources();
--> statement-breakpoint
CREATE FUNCTION enforce_rental_operational_stop_types()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_stop_type varchar(30);
BEGIN
  IF NEW.route_stop_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT stop_type INTO target_stop_type
  FROM route_stops
  WHERE tenant_id = NEW.tenant_id AND id = NEW.route_stop_id AND job_id = NEW.job_id;

  IF TG_TABLE_NAME = 'rental_pickup_attempts' AND target_stop_type IS DISTINCT FROM 'pickup' THEN
    RAISE EXCEPTION 'Rental Pickup Attempt requires a pickup Route Stop';
  END IF;

  IF TG_TABLE_NAME = 'disposal_loads' AND target_stop_type IS DISTINCT FROM 'disposal' THEN
    RAISE EXCEPTION 'Disposal Load requires a disposal Route Stop';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rental_pickup_attempts_stop_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, route_stop_id ON rental_pickup_attempts
FOR EACH ROW EXECUTE FUNCTION enforce_rental_operational_stop_types();
CREATE TRIGGER disposal_loads_stop_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, route_stop_id ON disposal_loads
FOR EACH ROW EXECUTE FUNCTION enforce_rental_operational_stop_types();
--> statement-breakpoint
CREATE FUNCTION enforce_disposal_expense()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_expense_type varchar(40);
  target_expense_status varchar(30);
  target_expense_amount bigint;
BEGIN
  IF NEW.expense_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT expense_type, status, amount_cents
  INTO target_expense_type, target_expense_status, target_expense_amount
  FROM expenses
  WHERE tenant_id = NEW.tenant_id AND id = NEW.expense_id AND job_id = NEW.job_id;

  IF target_expense_type IS DISTINCT FROM 'disposal' THEN
    RAISE EXCEPTION 'Disposal Load requires a disposal Expense';
  END IF;

  IF NEW.disposal_fee_cents IS DISTINCT FROM target_expense_amount THEN
    RAISE EXCEPTION 'Disposal Load fee must match its Expense amount';
  END IF;

  IF NEW.status = 'reconciled' AND target_expense_status NOT IN ('approved', 'reconciled') THEN
    RAISE EXCEPTION 'Reconciled Disposal Load requires an approved Expense';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER disposal_loads_expense_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, expense_id, disposal_fee_cents, status
ON disposal_loads
FOR EACH ROW EXECUTE FUNCTION enforce_disposal_expense();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expense_reconciliation()
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

  IF NEW.status IN ('approved', 'reconciled')
    AND NEW.expense_type <> 'disposal'
    AND allocated_amount <> NEW.amount_cents THEN
    RAISE EXCEPTION 'approved or reconciled Expenses require exact active Allocations';
  END IF;

  IF NEW.status IN ('approved', 'reconciled')
    AND NEW.expense_type = 'disposal'
    AND allocated_amount <> 0 THEN
    RAISE EXCEPTION 'Disposal Expenses link directly to one Disposal Load';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION enforce_rental_weight_summary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_total numeric(14, 3);
  expected_overage numeric(14, 3);
BEGIN
  SELECT COALESCE(SUM(canonical_net_weight_pounds), 0)
  INTO expected_total
  FROM disposal_loads
  WHERE tenant_id = NEW.tenant_id
    AND rental_detail_id = NEW.id
    AND job_id = NEW.job_id
    AND status = 'reconciled';

  expected_overage := GREATEST(expected_total - NEW.included_weight_pounds, 0);

  IF NEW.total_actual_weight_pounds IS DISTINCT FROM expected_total
    OR NEW.overage_weight_pounds IS DISTINCT FROM expected_overage THEN
    RAISE EXCEPTION 'Rental weight summaries must derive from reconciled Disposal Loads';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dump_trailer_rental_details_weight_guard
BEFORE INSERT OR UPDATE OF tenant_id, job_id, included_weight_pounds,
  total_actual_weight_pounds, overage_weight_pounds
ON dump_trailer_rental_details
FOR EACH ROW EXECUTE FUNCTION enforce_rental_weight_summary();
--> statement-breakpoint
CREATE FUNCTION enforce_rental_operational_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  unresolved_disposal_count integer;
  completed_post_inspection_count integer;
  active_occupancy_count integer;
BEGIN
  IF NEW.status <> 'operationally_complete' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO unresolved_disposal_count
  FROM disposal_loads
  WHERE tenant_id = NEW.tenant_id
    AND rental_detail_id = NEW.id
    AND job_id = NEW.job_id
    AND status NOT IN ('reconciled', 'cancelled');

  SELECT COUNT(*) INTO completed_post_inspection_count
  FROM rental_inspections
  WHERE tenant_id = NEW.tenant_id
    AND rental_detail_id = NEW.id
    AND job_id = NEW.job_id
    AND inspection_type = 'post_rental'
    AND status = 'completed';

  SELECT COUNT(*) INTO active_occupancy_count
  FROM asset_reservations
  WHERE tenant_id = NEW.tenant_id
    AND job_id = NEW.job_id
    AND asset_id = NEW.trailer_asset_id
    AND reservation_type = 'occupancy'
    AND status = 'active';

  IF NEW.customer_custody_ended_at IS NULL
    OR NEW.actual_pickup_at IS NULL
    OR NEW.empty_trailer_status <> 'confirmed_empty'
    OR NEW.final_condition IN ('pending_inspection', 'undetermined')
    OR NEW.occupancy_released_at IS NULL
    OR NEW.operationally_completed_at IS NULL
    OR unresolved_disposal_count > 0
    OR completed_post_inspection_count = 0
    OR active_occupancy_count > 0 THEN
    RAISE EXCEPTION 'Rental cannot complete until retrieval, disposal, empty-trailer evidence, inspection, and occupancy release are complete';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dump_trailer_rental_details_completion_guard
BEFORE INSERT OR UPDATE OF status, customer_custody_ended_at, actual_pickup_at,
  empty_trailer_status, final_condition, occupancy_released_at, operationally_completed_at
ON dump_trailer_rental_details
FOR EACH ROW EXECUTE FUNCTION enforce_rental_operational_completion();
--> statement-breakpoint
CREATE FUNCTION protect_rental_record_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accepted Dump Trailer Rental records cannot be deleted; cancel or supersede them';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dump_trailer_rental_details_no_delete_guard BEFORE DELETE ON dump_trailer_rental_details
FOR EACH ROW EXECUTE FUNCTION protect_rental_record_deletion();
CREATE TRIGGER rental_debris_reviews_no_delete_guard BEFORE DELETE ON rental_debris_reviews
FOR EACH ROW EXECUTE FUNCTION protect_rental_record_deletion();
CREATE TRIGGER rental_extensions_no_delete_guard BEFORE DELETE ON rental_extensions
FOR EACH ROW EXECUTE FUNCTION protect_rental_record_deletion();
CREATE TRIGGER rental_pickup_attempts_no_delete_guard BEFORE DELETE ON rental_pickup_attempts
FOR EACH ROW EXECUTE FUNCTION protect_rental_record_deletion();
CREATE TRIGGER disposal_loads_no_delete_guard BEFORE DELETE ON disposal_loads
FOR EACH ROW EXECUTE FUNCTION protect_rental_record_deletion();
CREATE TRIGGER rental_inspections_no_delete_guard BEFORE DELETE ON rental_inspections
FOR EACH ROW EXECUTE FUNCTION protect_rental_record_deletion();
--> statement-breakpoint
CREATE FUNCTION protect_rental_detail_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'planning'
    AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.job_id IS DISTINCT FROM OLD.job_id
      OR NEW.accepted_quote_version_id IS DISTINCT FROM OLD.accepted_quote_version_id
      OR NEW.rate_type IS DISTINCT FROM OLD.rate_type
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.accepted_terms_hash IS DISTINCT FROM OLD.accepted_terms_hash
      OR NEW.accepted_terms_snapshot IS DISTINCT FROM OLD.accepted_terms_snapshot
      OR NEW.included_days IS DISTINCT FROM OLD.included_days
      OR NEW.additional_day_rate_cents IS DISTINCT FROM OLD.additional_day_rate_cents
      OR NEW.included_weight_pounds IS DISTINCT FROM OLD.included_weight_pounds
      OR NEW.overage_rate_cents_per_pound IS DISTINCT FROM OLD.overage_rate_cents_per_pound
      OR NEW.deposit_amount_cents IS DISTINCT FROM OLD.deposit_amount_cents
      OR NEW.deposit_classification IS DISTINCT FROM OLD.deposit_classification) THEN
    RAISE EXCEPTION 'accepted Rental terms are immutable after planning';
  END IF;

  IF OLD.status IN ('operationally_complete', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'completed or cancelled Rental Details are terminal';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dump_trailer_rental_details_history_guard
BEFORE UPDATE ON dump_trailer_rental_details
FOR EACH ROW EXECUTE FUNCTION protect_rental_detail_history();
--> statement-breakpoint
CREATE FUNCTION protect_rental_outcome_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'rental_debris_reviews' AND OLD.status IN ('approved', 'hold', 'rejected', 'superseded') THEN
    RAISE EXCEPTION 'decided Rental Debris Reviews are immutable';
  ELSIF TG_TABLE_NAME = 'rental_extensions' AND OLD.status IN ('approved', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'decided Rental Extensions are immutable';
  ELSIF TG_TABLE_NAME = 'rental_pickup_attempts' AND OLD.status IN ('retrieved', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'completed Rental Pickup Attempts are immutable';
  ELSIF TG_TABLE_NAME = 'disposal_loads' AND OLD.status IN ('reconciled', 'rejected', 'redirected', 'cancelled') THEN
    RAISE EXCEPTION 'resolved Disposal Loads are immutable';
  ELSIF TG_TABLE_NAME = 'rental_inspections' AND OLD.status IN ('completed', 'waived') THEN
    RAISE EXCEPTION 'completed Rental Inspections are immutable';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rental_debris_reviews_history_guard BEFORE UPDATE ON rental_debris_reviews
FOR EACH ROW EXECUTE FUNCTION protect_rental_outcome_history();
CREATE TRIGGER rental_extensions_history_guard BEFORE UPDATE ON rental_extensions
FOR EACH ROW EXECUTE FUNCTION protect_rental_outcome_history();
CREATE TRIGGER rental_pickup_attempts_history_guard BEFORE UPDATE ON rental_pickup_attempts
FOR EACH ROW EXECUTE FUNCTION protect_rental_outcome_history();
CREATE TRIGGER disposal_loads_history_guard BEFORE UPDATE ON disposal_loads
FOR EACH ROW EXECUTE FUNCTION protect_rental_outcome_history();
CREATE TRIGGER rental_inspections_history_guard BEFORE UPDATE ON rental_inspections
FOR EACH ROW EXECUTE FUNCTION protect_rental_outcome_history();
--> statement-breakpoint
CREATE TRIGGER dump_trailer_rental_details_row_update BEFORE UPDATE ON dump_trailer_rental_details
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER rental_debris_reviews_row_update BEFORE UPDATE ON rental_debris_reviews
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER rental_extensions_row_update BEFORE UPDATE ON rental_extensions
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER rental_pickup_attempts_row_update BEFORE UPDATE ON rental_pickup_attempts
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER disposal_loads_row_update BEFORE UPDATE ON disposal_loads
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
CREATE TRIGGER rental_inspections_row_update BEFORE UPDATE ON rental_inspections
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER dump_trailer_rental_details_closed_job_guard
BEFORE INSERT OR UPDATE OR DELETE ON dump_trailer_rental_details
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER rental_debris_reviews_closed_job_guard
BEFORE INSERT OR UPDATE OR DELETE ON rental_debris_reviews
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER rental_extensions_closed_job_guard
BEFORE INSERT OR UPDATE OR DELETE ON rental_extensions
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER rental_pickup_attempts_closed_job_guard
BEFORE INSERT OR UPDATE OR DELETE ON rental_pickup_attempts
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER disposal_loads_closed_job_guard
BEFORE INSERT OR UPDATE OR DELETE ON disposal_loads
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
CREATE TRIGGER rental_inspections_closed_job_guard
BEFORE INSERT OR UPDATE OR DELETE ON rental_inspections
FOR EACH ROW EXECUTE FUNCTION protect_closed_job_child();
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dump_trailer_rental_details', 'rental_debris_reviews', 'rental_extensions',
    'rental_pickup_attempts', 'disposal_loads', 'rental_inspections'
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
REVOKE ALL ON dump_trailer_rental_details, rental_debris_reviews, rental_extensions,
  rental_pickup_attempts, disposal_loads, rental_inspections FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON dump_trailer_rental_details, rental_debris_reviews,
      rental_extensions, rental_pickup_attempts, disposal_loads, rental_inspections TO ldg_app;
  END IF;
END;
$$;
