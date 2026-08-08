CREATE TABLE "customer_credit_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"customer_credit_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"entry_kind" varchar(20) DEFAULT 'application' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"application_key" varchar(200) NOT NULL,
	"reverses_customer_credit_application_id" uuid,
	"reason" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "customer_credit_applications_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_credit_applications_tenant_key_unique" UNIQUE("tenant_id","application_key"),
	CONSTRAINT "customer_credit_applications_tenant_reversal_unique" UNIQUE("tenant_id","reverses_customer_credit_application_id"),
	CONSTRAINT "customer_credit_applications_kind_check" CHECK ("customer_credit_applications"."entry_kind" in ('application', 'reversal')),
	CONSTRAINT "customer_credit_applications_amount_check" CHECK ("customer_credit_applications"."amount_cents" > 0),
	CONSTRAINT "customer_credit_applications_reversal_check" CHECK (("customer_credit_applications"."entry_kind" = 'application' and "customer_credit_applications"."reverses_customer_credit_application_id" is null) or ("customer_credit_applications"."entry_kind" = 'reversal' and "customer_credit_applications"."reverses_customer_credit_application_id" is not null and "customer_credit_applications"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "customer_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"project_id" uuid,
	"credit_number" varchar(40) NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" uuid NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"original_amount_cents" bigint NOT NULL,
	"status" varchar(30) DEFAULT 'available' NOT NULL,
	"description" varchar(300) NOT NULL,
	"expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "customer_credits_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_credits_tenant_id_customer_unique" UNIQUE("tenant_id","id","customer_account_id"),
	CONSTRAINT "customer_credits_tenant_number_unique" UNIQUE("tenant_id","credit_number"),
	CONSTRAINT "customer_credits_tenant_source_unique" UNIQUE("tenant_id","source_type","source_id"),
	CONSTRAINT "customer_credits_source_check" CHECK ("customer_credits"."source_type" in ('unapplied_payment', 'overpayment', 'credit_memo', 'released_deposit', 'allocation_reversal', 'adjustment', 'manual')),
	CONSTRAINT "customer_credits_currency_check" CHECK ("customer_credits"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "customer_credits_amount_check" CHECK ("customer_credits"."original_amount_cents" > 0),
	CONSTRAINT "customer_credits_status_check" CHECK ("customer_credits"."status" in ('available', 'partially_applied', 'fully_applied', 'on_hold', 'partially_refunded', 'refunded', 'reversed', 'disputed', 'resolved')),
	CONSTRAINT "customer_credits_resolution_check" CHECK ("customer_credits"."status" not in ('refunded', 'reversed', 'resolved') or ("customer_credits"."resolved_at" is not null and "customer_credits"."resolution_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "deposit_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"deposit_balance_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"entry_kind" varchar(20) DEFAULT 'application' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"application_key" varchar(200) NOT NULL,
	"reverses_deposit_application_id" uuid,
	"reason" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "deposit_applications_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "deposit_applications_tenant_key_unique" UNIQUE("tenant_id","application_key"),
	CONSTRAINT "deposit_applications_tenant_reversal_unique" UNIQUE("tenant_id","reverses_deposit_application_id"),
	CONSTRAINT "deposit_applications_kind_check" CHECK ("deposit_applications"."entry_kind" in ('application', 'reversal')),
	CONSTRAINT "deposit_applications_amount_check" CHECK ("deposit_applications"."amount_cents" > 0),
	CONSTRAINT "deposit_applications_reversal_check" CHECK (("deposit_applications"."entry_kind" = 'application' and "deposit_applications"."reverses_deposit_application_id" is null) or ("deposit_applications"."entry_kind" = 'reversal' and "deposit_applications"."reverses_deposit_application_id" is not null and "deposit_applications"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "deposit_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"source_payment_allocation_id" uuid NOT NULL,
	"deposit_type" varchar(40) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"original_amount_cents" bigint NOT NULL,
	"status" varchar(30) DEFAULT 'available' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "deposit_balances_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "deposit_balances_tenant_id_project_customer_unique" UNIQUE("tenant_id","id","project_id","customer_account_id"),
	CONSTRAINT "deposit_balances_tenant_source_unique" UNIQUE("tenant_id","source_payment_allocation_id"),
	CONSTRAINT "deposit_balances_type_check" CHECK ("deposit_balances"."deposit_type" in ('advance_payment', 'refundable_security', 'split_advance', 'split_security')),
	CONSTRAINT "deposit_balances_currency_check" CHECK ("deposit_balances"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "deposit_balances_amount_check" CHECK ("deposit_balances"."original_amount_cents" > 0),
	CONSTRAINT "deposit_balances_status_check" CHECK ("deposit_balances"."status" in ('available', 'partially_applied', 'fully_applied', 'partially_refunded', 'refunded', 'retained', 'converted_to_credit', 'on_hold', 'disputed', 'resolved')),
	CONSTRAINT "deposit_balances_resolution_check" CHECK ("deposit_balances"."status" not in ('refunded', 'retained', 'converted_to_credit', 'resolved') or ("deposit_balances"."resolved_at" is not null and "deposit_balances"."resolution_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "invoice_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"adjustment_number" varchar(40) NOT NULL,
	"adjustment_type" varchar(40) NOT NULL,
	"direction" varchar(20) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"source_type" varchar(50),
	"source_id" uuid,
	"effective_at" timestamp with time zone NOT NULL,
	"new_due_date" date,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"reverses_invoice_adjustment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_adjustments_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_adjustments_tenant_number_unique" UNIQUE("tenant_id","adjustment_number"),
	CONSTRAINT "invoice_adjustments_tenant_reversal_unique" UNIQUE("tenant_id","reverses_invoice_adjustment_id"),
	CONSTRAINT "invoice_adjustments_type_check" CHECK ("invoice_adjustments"."adjustment_type" in ('additional_charge', 'credit', 'tax_adjustment', 'deposit_application_reversal', 'write_off', 'charge_reversal', 'due_date_extension', 'void', 'replacement')),
	CONSTRAINT "invoice_adjustments_direction_check" CHECK ("invoice_adjustments"."direction" in ('debit', 'credit')),
	CONSTRAINT "invoice_adjustments_amount_check" CHECK ("invoice_adjustments"."amount_cents" >= 0),
	CONSTRAINT "invoice_adjustments_due_date_check" CHECK ("invoice_adjustments"."adjustment_type" <> 'due_date_extension' or ("invoice_adjustments"."new_due_date" is not null and "invoice_adjustments"."amount_cents" = 0)),
	CONSTRAINT "invoice_adjustments_status_check" CHECK ("invoice_adjustments"."status" in ('draft', 'pending_approval', 'approved', 'posted', 'reversed', 'cancelled')),
	CONSTRAINT "invoice_adjustments_approval_check" CHECK ("invoice_adjustments"."status" not in ('approved', 'posted', 'reversed') or ("invoice_adjustments"."approved_at" is not null and "invoice_adjustments"."approved_by" is not null)),
	CONSTRAINT "invoice_adjustments_posted_check" CHECK ("invoice_adjustments"."status" <> 'posted' or ("invoice_adjustments"."posted_at" is not null and "invoice_adjustments"."posted_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "invoice_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_version_id" uuid NOT NULL,
	"channel" varchar(20) NOT NULL,
	"destination_snapshot" jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"provider_reference" varchar(200),
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_deliveries_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_deliveries_channel_check" CHECK ("invoice_deliveries"."channel" in ('email', 'text', 'link', 'manual')),
	CONSTRAINT "invoice_deliveries_status_check" CHECK ("invoice_deliveries"."status" in ('pending', 'sent', 'delivered', 'failed', 'viewed')),
	CONSTRAINT "invoice_deliveries_failure_check" CHECK ("invoice_deliveries"."status" <> 'failed' or "invoice_deliveries"."failure_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_version_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"line_type" varchar(40) NOT NULL,
	"direction" varchar(20) DEFAULT 'debit' NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_id" uuid,
	"accepted_quote_line_item_id" uuid,
	"job_charge_id" uuid,
	"deposit_application_id" uuid,
	"customer_credit_application_id" uuid,
	"invoice_adjustment_id" uuid,
	"description" varchar(300) NOT NULL,
	"quantity" numeric(12, 3),
	"unit" varchar(40),
	"unit_price_cents" bigint,
	"subtotal_cents" bigint NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"tax_behavior" varchar(30) DEFAULT 'non_taxable' NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_line_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_line_items_tenant_version_sequence_unique" UNIQUE("tenant_id","invoice_version_id","sequence"),
	CONSTRAINT "invoice_line_items_sequence_check" CHECK ("invoice_line_items"."sequence" > 0),
	CONSTRAINT "invoice_line_items_type_check" CHECK ("invoice_line_items"."line_type" in ('accepted_quote', 'job_charge', 'deposit_application', 'customer_credit', 'adjustment', 'tax', 'rounding')),
	CONSTRAINT "invoice_line_items_direction_check" CHECK ("invoice_line_items"."direction" in ('debit', 'credit')),
	CONSTRAINT "invoice_line_items_source_type_check" CHECK ("invoice_line_items"."source_type" in ('accepted_quote_line', 'job_charge', 'deposit_application', 'customer_credit_application', 'invoice_adjustment', 'tax_rule', 'rounding_rule')),
	CONSTRAINT "invoice_line_items_source_check" CHECK (("invoice_line_items"."line_type" = 'accepted_quote' and "invoice_line_items"."accepted_quote_line_item_id" is not null and "invoice_line_items"."job_charge_id" is null and "invoice_line_items"."deposit_application_id" is null and "invoice_line_items"."customer_credit_application_id" is null and "invoice_line_items"."invoice_adjustment_id" is null) or ("invoice_line_items"."line_type" = 'job_charge' and "invoice_line_items"."accepted_quote_line_item_id" is null and "invoice_line_items"."job_charge_id" is not null and "invoice_line_items"."deposit_application_id" is null and "invoice_line_items"."customer_credit_application_id" is null and "invoice_line_items"."invoice_adjustment_id" is null) or ("invoice_line_items"."line_type" = 'deposit_application' and "invoice_line_items"."accepted_quote_line_item_id" is null and "invoice_line_items"."job_charge_id" is null and "invoice_line_items"."deposit_application_id" is not null and "invoice_line_items"."customer_credit_application_id" is null and "invoice_line_items"."invoice_adjustment_id" is null) or ("invoice_line_items"."line_type" = 'customer_credit' and "invoice_line_items"."accepted_quote_line_item_id" is null and "invoice_line_items"."job_charge_id" is null and "invoice_line_items"."deposit_application_id" is null and "invoice_line_items"."customer_credit_application_id" is not null and "invoice_line_items"."invoice_adjustment_id" is null) or ("invoice_line_items"."line_type" = 'adjustment' and "invoice_line_items"."accepted_quote_line_item_id" is null and "invoice_line_items"."job_charge_id" is null and "invoice_line_items"."deposit_application_id" is null and "invoice_line_items"."customer_credit_application_id" is null and "invoice_line_items"."invoice_adjustment_id" is not null) or ("invoice_line_items"."line_type" in ('tax', 'rounding') and "invoice_line_items"."accepted_quote_line_item_id" is null and "invoice_line_items"."job_charge_id" is null and "invoice_line_items"."deposit_application_id" is null and "invoice_line_items"."customer_credit_application_id" is null and "invoice_line_items"."invoice_adjustment_id" is null)),
	CONSTRAINT "invoice_line_items_quantity_check" CHECK ("invoice_line_items"."quantity" is null or "invoice_line_items"."quantity" > 0),
	CONSTRAINT "invoice_line_items_unit_check" CHECK (("invoice_line_items"."quantity" is null and "invoice_line_items"."unit" is null and "invoice_line_items"."unit_price_cents" is null) or ("invoice_line_items"."quantity" is not null and "invoice_line_items"."unit" is not null and "invoice_line_items"."unit_price_cents" is not null and "invoice_line_items"."unit_price_cents" >= 0)),
	CONSTRAINT "invoice_line_items_amounts_check" CHECK ("invoice_line_items"."subtotal_cents" >= 0 and "invoice_line_items"."tax_cents" >= 0 and "invoice_line_items"."total_cents" = "invoice_line_items"."subtotal_cents" + "invoice_line_items"."tax_cents"),
	CONSTRAINT "invoice_line_items_tax_check" CHECK ("invoice_line_items"."tax_behavior" in ('taxable', 'non_taxable', 'tax_included'))
);
--> statement-breakpoint
CREATE TABLE "invoice_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"billing_identity_snapshot" jsonb NOT NULL,
	"terms_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calculation_snapshot" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"deposit_application_cents" bigint DEFAULT 0 NOT NULL,
	"customer_credit_application_cents" bigint DEFAULT 0 NOT NULL,
	"amount_due_cents" bigint NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prepared_by" uuid NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"supersedes_invoice_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_versions_tenant_id_invoice_unique" UNIQUE("tenant_id","id","invoice_id"),
	CONSTRAINT "invoice_versions_tenant_invoice_version_unique" UNIQUE("tenant_id","invoice_id","version_number"),
	CONSTRAINT "invoice_versions_number_check" CHECK ("invoice_versions"."version_number" > 0),
	CONSTRAINT "invoice_versions_status_check" CHECK ("invoice_versions"."status" in ('draft', 'review_required', 'ready_to_post', 'posted', 'superseded', 'voided')),
	CONSTRAINT "invoice_versions_hash_check" CHECK (length("invoice_versions"."content_hash") = 64),
	CONSTRAINT "invoice_versions_amounts_check" CHECK ("invoice_versions"."subtotal_cents" >= 0 and "invoice_versions"."discount_cents" >= 0 and "invoice_versions"."tax_cents" >= 0 and "invoice_versions"."total_cents" >= 0 and "invoice_versions"."deposit_application_cents" >= 0 and "invoice_versions"."customer_credit_application_cents" >= 0 and "invoice_versions"."amount_due_cents" >= 0),
	CONSTRAINT "invoice_versions_total_check" CHECK ("invoice_versions"."total_cents" = "invoice_versions"."subtotal_cents" - "invoice_versions"."discount_cents" + "invoice_versions"."tax_cents"),
	CONSTRAINT "invoice_versions_amount_due_check" CHECK ("invoice_versions"."amount_due_cents" = "invoice_versions"."total_cents" - "invoice_versions"."deposit_application_cents" - "invoice_versions"."customer_credit_application_cents"),
	CONSTRAINT "invoice_versions_posted_check" CHECK ("invoice_versions"."status" <> 'posted' or ("invoice_versions"."posted_at" is not null and "invoice_versions"."posted_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid,
	"customer_account_id" uuid NOT NULL,
	"invoice_number" varchar(40) NOT NULL,
	"invoice_type" varchar(40) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" varchar(40) DEFAULT 'draft' NOT NULL,
	"issue_date" date,
	"due_date" date,
	"posted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"replaces_invoice_id" uuid,
	"replaced_by_invoice_id" uuid,
	"dispute_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoices_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_tenant_id_customer_unique" UNIQUE("tenant_id","id","customer_account_id"),
	CONSTRAINT "invoices_tenant_id_project_customer_unique" UNIQUE("tenant_id","id","project_id","customer_account_id"),
	CONSTRAINT "invoices_tenant_number_unique" UNIQUE("tenant_id","invoice_number"),
	CONSTRAINT "invoices_type_check" CHECK ("invoices"."invoice_type" in ('deposit', 'final', 'additional_charge', 'credit_memo')),
	CONSTRAINT "invoices_currency_check" CHECK ("invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('draft', 'review_required', 'ready_to_post', 'posted', 'sent', 'viewed', 'partially_paid', 'paid', 'past_due', 'disputed', 'collection_hold', 'adjusted', 'credited', 'written_off', 'voided', 'replaced', 'resolved', 'archived')),
	CONSTRAINT "invoices_dates_check" CHECK ("invoices"."issue_date" is null or "invoices"."due_date" is null or "invoices"."due_date" >= "invoices"."issue_date"),
	CONSTRAINT "invoices_posted_check" CHECK ("invoices"."status" not in ('posted', 'sent', 'viewed', 'partially_paid', 'paid', 'past_due', 'disputed', 'collection_hold', 'adjusted', 'credited', 'written_off', 'voided', 'replaced', 'resolved', 'archived') or ("invoices"."issue_date" is not null and "invoices"."due_date" is not null and "invoices"."posted_at" is not null)),
	CONSTRAINT "invoices_void_check" CHECK ("invoices"."status" <> 'voided' or ("invoices"."voided_at" is not null and "invoices"."void_reason" is not null)),
	CONSTRAINT "invoices_replacement_self_check" CHECK ("invoices"."replaces_invoice_id" is null or "invoices"."replaces_invoice_id" <> "invoices"."id")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"entry_kind" varchar(20) DEFAULT 'application' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"allocation_key" varchar(200) NOT NULL,
	"reverses_payment_allocation_id" uuid,
	"reason" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_allocations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_allocations_tenant_key_unique" UNIQUE("tenant_id","allocation_key"),
	CONSTRAINT "payment_allocations_tenant_reversal_unique" UNIQUE("tenant_id","reverses_payment_allocation_id"),
	CONSTRAINT "payment_allocations_kind_check" CHECK ("payment_allocations"."entry_kind" in ('application', 'reversal')),
	CONSTRAINT "payment_allocations_amount_check" CHECK ("payment_allocations"."amount_cents" > 0),
	CONSTRAINT "payment_allocations_reversal_check" CHECK (("payment_allocations"."entry_kind" = 'application' and "payment_allocations"."reverses_payment_allocation_id" is null) or ("payment_allocations"."entry_kind" = 'reversal' and "payment_allocations"."reverses_payment_allocation_id" is not null and "payment_allocations"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"project_id" uuid,
	"payment_number" varchar(40) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_method" varchar(30) NOT NULL,
	"receiving_account_reference" varchar(160) NOT NULL,
	"provider_name" varchar(80),
	"provider_transaction_id" varchar(200),
	"status" varchar(40) DEFAULT 'draft' NOT NULL,
	"payer_snapshot" jsonb NOT NULL,
	"evidence_document_id" uuid,
	"receipt_status" varchar(30) DEFAULT 'missing' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"settled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "payments_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_tenant_id_customer_unique" UNIQUE("tenant_id","id","customer_account_id"),
	CONSTRAINT "payments_tenant_number_unique" UNIQUE("tenant_id","payment_number"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_method_check" CHECK ("payments"."payment_method" in ('cash', 'zelle', 'venmo', 'cash_app', 'paypal', 'card', 'bank_transfer', 'check')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('draft', 'pending', 'verification_required', 'verified', 'processing', 'settled', 'partially_allocated', 'fully_allocated', 'partially_refunded', 'refunded', 'failed', 'reversed', 'disputed', 'on_hold', 'resolved', 'cancelled')),
	CONSTRAINT "payments_receipt_check" CHECK ("payments"."receipt_status" in ('missing', 'attached', 'issued', 'waived', 'not_required')),
	CONSTRAINT "payments_verification_check" CHECK ("payments"."status" not in ('verified', 'processing', 'settled', 'partially_allocated', 'fully_allocated', 'partially_refunded', 'refunded', 'reversed', 'resolved') or ("payments"."verified_at" is not null and "payments"."verified_by" is not null)),
	CONSTRAINT "payments_settlement_check" CHECK ("payments"."status" not in ('settled', 'partially_allocated', 'fully_allocated', 'partially_refunded', 'refunded', 'reversed', 'resolved') or "payments"."settled_at" is not null),
	CONSTRAINT "payments_reversal_check" CHECK ("payments"."status" <> 'reversed' or ("payments"."reversed_at" is not null and "payments"."reversed_by" is not null and "payments"."reversal_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"project_id" uuid,
	"refund_number" varchar(40) NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"payment_id" uuid,
	"deposit_balance_id" uuid,
	"customer_credit_id" uuid,
	"amount_cents" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"refund_method" varchar(30) NOT NULL,
	"original_method" varchar(30),
	"payee_snapshot" jsonb NOT NULL,
	"status" varchar(40) DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"alternate_method_reason" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"processed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"provider_name" varchar(80),
	"provider_refund_id" varchar(200),
	"reverses_refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "refunds_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "refunds_tenant_number_unique" UNIQUE("tenant_id","refund_number"),
	CONSTRAINT "refunds_tenant_reversal_unique" UNIQUE("tenant_id","reverses_refund_id"),
	CONSTRAINT "refunds_source_check" CHECK (("refunds"."source_type" = 'payment' and "refunds"."payment_id" is not null and "refunds"."deposit_balance_id" is null and "refunds"."customer_credit_id" is null) or ("refunds"."source_type" = 'deposit' and "refunds"."payment_id" is null and "refunds"."deposit_balance_id" is not null and "refunds"."customer_credit_id" is null) or ("refunds"."source_type" = 'customer_credit' and "refunds"."payment_id" is null and "refunds"."deposit_balance_id" is null and "refunds"."customer_credit_id" is not null)),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount_cents" > 0),
	CONSTRAINT "refunds_currency_check" CHECK ("refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "refunds_method_check" CHECK ("refunds"."refund_method" in ('cash', 'zelle', 'venmo', 'cash_app', 'paypal', 'card', 'bank_transfer', 'check')),
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" in ('draft', 'review_required', 'pending_approval', 'approved', 'processing', 'partially_processed', 'processed', 'settled', 'failed', 'cancelled', 'reversed', 'disputed', 'resolved')),
	CONSTRAINT "refunds_approval_check" CHECK ("refunds"."status" not in ('approved', 'processing', 'partially_processed', 'processed', 'settled', 'reversed', 'resolved') or ("refunds"."approved_at" is not null and "refunds"."approved_by" is not null)),
	CONSTRAINT "refunds_alternate_method_check" CHECK ("refunds"."original_method" is null or "refunds"."refund_method" = "refunds"."original_method" or ("refunds"."alternate_method_reason" is not null and "refunds"."approved_by" is not null)),
	CONSTRAINT "refunds_settlement_check" CHECK ("refunds"."status" <> 'settled' or ("refunds"."processed_at" is not null and "refunds"."settled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_tenant_id_job_unique" UNIQUE("tenant_id","id","job_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_project_unique" UNIQUE("tenant_id","id","project_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_customer_unique" UNIQUE("tenant_id","id","customer_account_id");--> statement-breakpoint
ALTER TABLE "customer_credit_applications" ADD CONSTRAINT "customer_credit_applications_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_applications" ADD CONSTRAINT "customer_credit_applications_tenant_credit_customer_fk" FOREIGN KEY ("tenant_id","customer_credit_id","customer_account_id") REFERENCES "public"."customer_credits"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_applications" ADD CONSTRAINT "customer_credit_applications_tenant_invoice_customer_fk" FOREIGN KEY ("tenant_id","invoice_id","customer_account_id") REFERENCES "public"."invoices"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_applications" ADD CONSTRAINT "customer_credit_applications_tenant_reversal_fk" FOREIGN KEY ("tenant_id","reverses_customer_credit_application_id") REFERENCES "public"."customer_credit_applications"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_applications" ADD CONSTRAINT "customer_credit_applications_tenant_actor_fk" FOREIGN KEY ("tenant_id","applied_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."customer_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_tenant_project_customer_fk" FOREIGN KEY ("tenant_id","project_id","customer_account_id") REFERENCES "public"."projects"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_tenant_balance_project_customer_fk" FOREIGN KEY ("tenant_id","deposit_balance_id","project_id","customer_account_id") REFERENCES "public"."deposit_balances"("tenant_id","id","project_id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_tenant_invoice_project_customer_fk" FOREIGN KEY ("tenant_id","invoice_id","project_id","customer_account_id") REFERENCES "public"."invoices"("tenant_id","id","project_id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_tenant_reversal_fk" FOREIGN KEY ("tenant_id","reverses_deposit_application_id") REFERENCES "public"."deposit_applications"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_tenant_actor_fk" FOREIGN KEY ("tenant_id","applied_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_balances" ADD CONSTRAINT "deposit_balances_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_balances" ADD CONSTRAINT "deposit_balances_tenant_project_customer_fk" FOREIGN KEY ("tenant_id","project_id","customer_account_id") REFERENCES "public"."projects"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_balances" ADD CONSTRAINT "deposit_balances_tenant_source_allocation_fk" FOREIGN KEY ("tenant_id","source_payment_allocation_id") REFERENCES "public"."payment_allocations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_tenant_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_tenant_approver_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_tenant_poster_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_tenant_reversal_fk" FOREIGN KEY ("tenant_id","reverses_invoice_adjustment_id") REFERENCES "public"."invoice_adjustments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_tenant_version_invoice_fk" FOREIGN KEY ("tenant_id","invoice_version_id","invoice_id") REFERENCES "public"."invoice_versions"("tenant_id","id","invoice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenant_version_invoice_fk" FOREIGN KEY ("tenant_id","invoice_version_id","invoice_id") REFERENCES "public"."invoice_versions"("tenant_id","id","invoice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenant_quote_line_fk" FOREIGN KEY ("tenant_id","accepted_quote_line_item_id") REFERENCES "public"."quote_line_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenant_job_charge_fk" FOREIGN KEY ("tenant_id","job_charge_id") REFERENCES "public"."job_charges"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenant_deposit_application_fk" FOREIGN KEY ("tenant_id","deposit_application_id") REFERENCES "public"."deposit_applications"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenant_credit_application_fk" FOREIGN KEY ("tenant_id","customer_credit_application_id") REFERENCES "public"."customer_credit_applications"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenant_adjustment_fk" FOREIGN KEY ("tenant_id","invoice_adjustment_id") REFERENCES "public"."invoice_adjustments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_tenant_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_tenant_preparer_fk" FOREIGN KEY ("tenant_id","prepared_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_tenant_poster_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_tenant_supersedes_fk" FOREIGN KEY ("tenant_id","supersedes_invoice_version_id") REFERENCES "public"."invoice_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_project_customer_fk" FOREIGN KEY ("tenant_id","project_id","customer_account_id") REFERENCES "public"."projects"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_job_project_fk" FOREIGN KEY ("tenant_id","job_id","project_id") REFERENCES "public"."jobs"("tenant_id","id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_replaces_fk" FOREIGN KEY ("tenant_id","replaces_invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_replaced_by_fk" FOREIGN KEY ("tenant_id","replaced_by_invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_payment_customer_fk" FOREIGN KEY ("tenant_id","payment_id","customer_account_id") REFERENCES "public"."payments"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_invoice_customer_fk" FOREIGN KEY ("tenant_id","invoice_id","customer_account_id") REFERENCES "public"."invoices"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_reversal_fk" FOREIGN KEY ("tenant_id","reverses_payment_allocation_id") REFERENCES "public"."payment_allocations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_actor_fk" FOREIGN KEY ("tenant_id","applied_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."customer_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_project_customer_fk" FOREIGN KEY ("tenant_id","project_id","customer_account_id") REFERENCES "public"."projects"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_evidence_fk" FOREIGN KEY ("tenant_id","evidence_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_verifier_fk" FOREIGN KEY ("tenant_id","verified_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_reverser_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."customer_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_project_customer_fk" FOREIGN KEY ("tenant_id","project_id","customer_account_id") REFERENCES "public"."projects"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_payment_customer_fk" FOREIGN KEY ("tenant_id","payment_id","customer_account_id") REFERENCES "public"."payments"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_credit_customer_fk" FOREIGN KEY ("tenant_id","customer_credit_id","customer_account_id") REFERENCES "public"."customer_credits"("tenant_id","id","customer_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_deposit_fk" FOREIGN KEY ("tenant_id","deposit_balance_id") REFERENCES "public"."deposit_balances"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_approver_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_reversal_fk" FOREIGN KEY ("tenant_id","reverses_refund_id") REFERENCES "public"."refunds"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_credit_applications_tenant_credit_idx" ON "customer_credit_applications" USING btree ("tenant_id","customer_credit_id","applied_at");--> statement-breakpoint
CREATE INDEX "customer_credit_applications_tenant_invoice_idx" ON "customer_credit_applications" USING btree ("tenant_id","invoice_id","applied_at");--> statement-breakpoint
CREATE INDEX "customer_credits_tenant_customer_status_idx" ON "customer_credits" USING btree ("tenant_id","customer_account_id","status");--> statement-breakpoint
CREATE INDEX "deposit_applications_tenant_balance_idx" ON "deposit_applications" USING btree ("tenant_id","deposit_balance_id","applied_at");--> statement-breakpoint
CREATE INDEX "deposit_applications_tenant_invoice_idx" ON "deposit_applications" USING btree ("tenant_id","invoice_id","applied_at");--> statement-breakpoint
CREATE INDEX "deposit_balances_tenant_project_status_idx" ON "deposit_balances" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
CREATE INDEX "invoice_adjustments_tenant_invoice_status_idx" ON "invoice_adjustments" USING btree ("tenant_id","invoice_id","status","effective_at");--> statement-breakpoint
CREATE INDEX "invoice_deliveries_tenant_invoice_attempt_idx" ON "invoice_deliveries" USING btree ("tenant_id","invoice_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_items_one_source_per_version_idx" ON "invoice_line_items" USING btree ("tenant_id","invoice_version_id","source_type","source_id") WHERE "invoice_line_items"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "invoice_line_items_tenant_version_sequence_idx" ON "invoice_line_items" USING btree ("tenant_id","invoice_version_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_versions_one_posted_idx" ON "invoice_versions" USING btree ("tenant_id","invoice_id") WHERE "invoice_versions"."status" = 'posted';--> statement-breakpoint
CREATE INDEX "invoice_versions_tenant_invoice_status_idx" ON "invoice_versions" USING btree ("tenant_id","invoice_id","status","version_number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_customer_status_idx" ON "invoices" USING btree ("tenant_id","customer_account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "invoices_tenant_project_type_idx" ON "invoices" USING btree ("tenant_id","project_id","invoice_type","created_at");--> statement-breakpoint
CREATE INDEX "payment_allocations_tenant_payment_idx" ON "payment_allocations" USING btree ("tenant_id","payment_id","applied_at");--> statement-breakpoint
CREATE INDEX "payment_allocations_tenant_invoice_idx" ON "payment_allocations" USING btree ("tenant_id","invoice_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_transaction_unique" ON "payments" USING btree ("tenant_id","provider_name","provider_transaction_id") WHERE "payments"."provider_transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_tenant_customer_received_idx" ON "payments" USING btree ("tenant_id","customer_account_id","received_at");--> statement-breakpoint
CREATE INDEX "payments_tenant_status_idx" ON "payments" USING btree ("tenant_id","status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_reference_unique" ON "refunds" USING btree ("tenant_id","provider_name","provider_refund_id") WHERE "refunds"."provider_refund_id" is not null;--> statement-breakpoint
CREATE INDEX "refunds_tenant_customer_status_idx" ON "refunds" USING btree ("tenant_id","customer_account_id","status","created_at");--> statement-breakpoint

CREATE FUNCTION finance_invoice_balance(p_tenant_id uuid, p_invoice_id uuid)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  posted_total bigint;
  adjustment_total bigint;
  payment_total bigint;
  deposit_total bigint;
  credit_total bigint;
BEGIN
  SELECT iv.total_cents
    INTO posted_total
    FROM invoice_versions iv
   WHERE iv.tenant_id = p_tenant_id
     AND iv.invoice_id = p_invoice_id
     AND iv.status = 'posted';

  IF posted_total IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO adjustment_total
    FROM invoice_adjustments
   WHERE tenant_id = p_tenant_id
     AND invoice_id = p_invoice_id
     AND status = 'posted';

  SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO payment_total
    FROM payment_allocations
   WHERE tenant_id = p_tenant_id
     AND invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO deposit_total
    FROM deposit_applications
   WHERE tenant_id = p_tenant_id
     AND invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO credit_total
    FROM customer_credit_applications
   WHERE tenant_id = p_tenant_id
     AND invoice_id = p_invoice_id;

  RETURN GREATEST(posted_total + adjustment_total - payment_total - deposit_total - credit_total, 0);
END;
$$;
--> statement-breakpoint

CREATE FUNCTION enforce_payment_allocation_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_amount bigint;
  source_currency varchar(3);
  source_status varchar(40);
  target_currency varchar(3);
  target_type varchar(40);
  target_status varchar(40);
  already_allocated bigint;
  already_refunded bigint;
  eligible_amount bigint;
  original payment_allocations%ROWTYPE;
BEGIN
  SELECT amount_cents, currency, status
    INTO source_amount, source_currency, source_status
    FROM payments
   WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id
   FOR UPDATE;

  SELECT currency, invoice_type, status
    INTO target_currency, target_type, target_status
    FROM invoices
   WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id
   FOR UPDATE;

  IF source_amount IS NULL OR target_currency IS NULL THEN
    RAISE EXCEPTION 'Payment Allocation source or target does not exist';
  END IF;
  IF source_currency <> target_currency THEN
    RAISE EXCEPTION 'Payment Allocation currency must match Invoice currency';
  END IF;

  IF NEW.entry_kind = 'reversal' THEN
    SELECT * INTO original
      FROM payment_allocations
     WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_payment_allocation_id
     FOR UPDATE;
    IF original.id IS NULL OR original.entry_kind <> 'application'
       OR original.payment_id <> NEW.payment_id OR original.invoice_id <> NEW.invoice_id
       OR original.customer_account_id <> NEW.customer_account_id
       OR original.amount_cents <> NEW.amount_cents THEN
      RAISE EXCEPTION 'Payment Allocation reversal must exactly match its original application';
    END IF;
    RETURN NEW;
  END IF;

  IF source_status NOT IN ('settled', 'partially_allocated', 'fully_allocated', 'partially_refunded') THEN
    RAISE EXCEPTION 'Payment must be settled before allocation';
  END IF;
  IF target_type = 'credit_memo' OR target_status IN ('draft', 'review_required', 'ready_to_post', 'voided', 'replaced', 'archived') THEN
    RAISE EXCEPTION 'Payment Allocation requires an eligible posted Invoice';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO already_allocated
    FROM payment_allocations
   WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id;

  SELECT COALESCE(SUM(amount_cents), 0)::bigint
    INTO already_refunded
    FROM refunds
   WHERE tenant_id = NEW.tenant_id
     AND payment_id = NEW.payment_id
     AND status NOT IN ('failed', 'cancelled', 'reversed');

  IF already_allocated + already_refunded + NEW.amount_cents > source_amount THEN
    RAISE EXCEPTION 'Payment Allocation exceeds available Payment amount';
  END IF;

  eligible_amount := finance_invoice_balance(NEW.tenant_id, NEW.invoice_id);
  IF eligible_amount IS NULL OR NEW.amount_cents > eligible_amount THEN
    RAISE EXCEPTION 'Payment Allocation exceeds eligible Invoice balance';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER payment_allocations_balance_guard
BEFORE INSERT ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION enforce_payment_allocation_balance();
--> statement-breakpoint

CREATE FUNCTION enforce_deposit_balance_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_amount bigint;
  allocation_kind varchar(20);
  allocation_customer uuid;
  invoice_project uuid;
  invoice_type varchar(40);
  payment_currency varchar(3);
  has_reversal boolean;
BEGIN
  SELECT pa.amount_cents, pa.entry_kind, pa.customer_account_id,
         i.project_id, i.invoice_type, p.currency
    INTO allocation_amount, allocation_kind, allocation_customer,
         invoice_project, invoice_type, payment_currency
    FROM payment_allocations pa
    JOIN invoices i ON i.tenant_id = pa.tenant_id AND i.id = pa.invoice_id
    JOIN payments p ON p.tenant_id = pa.tenant_id AND p.id = pa.payment_id
   WHERE pa.tenant_id = NEW.tenant_id
     AND pa.id = NEW.source_payment_allocation_id
   FOR UPDATE OF pa, i, p;

  SELECT EXISTS(
    SELECT 1 FROM payment_allocations
     WHERE tenant_id = NEW.tenant_id
       AND reverses_payment_allocation_id = NEW.source_payment_allocation_id
  ) INTO has_reversal;

  IF allocation_amount IS NULL OR allocation_kind <> 'application' OR has_reversal THEN
    RAISE EXCEPTION 'Deposit Balance requires an active Payment Allocation';
  END IF;
  IF invoice_type <> 'deposit' THEN
    RAISE EXCEPTION 'Deposit Balance source must be a Deposit Invoice allocation';
  END IF;
  IF allocation_customer <> NEW.customer_account_id OR invoice_project <> NEW.project_id THEN
    RAISE EXCEPTION 'Deposit Balance source must match its Customer and Project';
  END IF;
  IF allocation_amount <> NEW.original_amount_cents OR payment_currency <> NEW.currency THEN
    RAISE EXCEPTION 'Deposit Balance must preserve the allocated amount and currency';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER deposit_balances_source_guard
BEFORE INSERT ON deposit_balances
FOR EACH ROW EXECUTE FUNCTION enforce_deposit_balance_source();
--> statement-breakpoint

CREATE FUNCTION enforce_deposit_application_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_amount bigint;
  source_currency varchar(3);
  source_type varchar(40);
  source_status varchar(30);
  target_currency varchar(3);
  target_status varchar(40);
  already_applied bigint;
  already_refunded bigint;
  eligible_amount bigint;
  original deposit_applications%ROWTYPE;
BEGIN
  SELECT original_amount_cents, currency, deposit_type, status
    INTO source_amount, source_currency, source_type, source_status
    FROM deposit_balances
   WHERE tenant_id = NEW.tenant_id AND id = NEW.deposit_balance_id
   FOR UPDATE;

  SELECT currency, status
    INTO target_currency, target_status
    FROM invoices
   WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id
   FOR UPDATE;

  IF source_amount IS NULL OR target_currency IS NULL THEN
    RAISE EXCEPTION 'Deposit Application source or target does not exist';
  END IF;
  IF source_currency <> target_currency THEN
    RAISE EXCEPTION 'Deposit Application currency must match Invoice currency';
  END IF;

  IF NEW.entry_kind = 'reversal' THEN
    SELECT * INTO original
      FROM deposit_applications
     WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_deposit_application_id
     FOR UPDATE;
    IF original.id IS NULL OR original.entry_kind <> 'application'
       OR original.deposit_balance_id <> NEW.deposit_balance_id
       OR original.invoice_id <> NEW.invoice_id OR original.project_id <> NEW.project_id
       OR original.customer_account_id <> NEW.customer_account_id
       OR original.amount_cents <> NEW.amount_cents THEN
      RAISE EXCEPTION 'Deposit Application reversal must exactly match its original application';
    END IF;
    RETURN NEW;
  END IF;

  IF source_type NOT IN ('advance_payment', 'split_advance') THEN
    RAISE EXCEPTION 'Refundable security value cannot be applied to service Invoices';
  END IF;
  IF source_status IN ('fully_applied', 'refunded', 'retained', 'converted_to_credit', 'on_hold', 'disputed', 'resolved') THEN
    RAISE EXCEPTION 'Deposit Balance is not available for application';
  END IF;
  IF target_status IN ('draft', 'review_required', 'ready_to_post', 'voided', 'replaced', 'archived') THEN
    RAISE EXCEPTION 'Deposit Application requires an eligible posted Invoice';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO already_applied
    FROM deposit_applications
   WHERE tenant_id = NEW.tenant_id AND deposit_balance_id = NEW.deposit_balance_id;

  SELECT COALESCE(SUM(amount_cents), 0)::bigint
    INTO already_refunded
    FROM refunds
   WHERE tenant_id = NEW.tenant_id
     AND deposit_balance_id = NEW.deposit_balance_id
     AND status NOT IN ('failed', 'cancelled', 'reversed');

  IF already_applied + already_refunded + NEW.amount_cents > source_amount THEN
    RAISE EXCEPTION 'Deposit Application exceeds available Deposit amount';
  END IF;

  eligible_amount := finance_invoice_balance(NEW.tenant_id, NEW.invoice_id);
  IF eligible_amount IS NULL OR NEW.amount_cents > eligible_amount THEN
    RAISE EXCEPTION 'Deposit Application exceeds eligible Invoice balance';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER deposit_applications_balance_guard
BEFORE INSERT ON deposit_applications
FOR EACH ROW EXECUTE FUNCTION enforce_deposit_application_balance();
--> statement-breakpoint

CREATE FUNCTION enforce_customer_credit_application_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_amount bigint;
  source_currency varchar(3);
  source_status varchar(30);
  target_currency varchar(3);
  target_status varchar(40);
  already_applied bigint;
  already_refunded bigint;
  eligible_amount bigint;
  original customer_credit_applications%ROWTYPE;
BEGIN
  SELECT original_amount_cents, currency, status
    INTO source_amount, source_currency, source_status
    FROM customer_credits
   WHERE tenant_id = NEW.tenant_id AND id = NEW.customer_credit_id
   FOR UPDATE;

  SELECT currency, status
    INTO target_currency, target_status
    FROM invoices
   WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id
   FOR UPDATE;

  IF source_amount IS NULL OR target_currency IS NULL THEN
    RAISE EXCEPTION 'Customer Credit Application source or target does not exist';
  END IF;
  IF source_currency <> target_currency THEN
    RAISE EXCEPTION 'Customer Credit Application currency must match Invoice currency';
  END IF;

  IF NEW.entry_kind = 'reversal' THEN
    SELECT * INTO original
      FROM customer_credit_applications
     WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_customer_credit_application_id
     FOR UPDATE;
    IF original.id IS NULL OR original.entry_kind <> 'application'
       OR original.customer_credit_id <> NEW.customer_credit_id
       OR original.invoice_id <> NEW.invoice_id
       OR original.customer_account_id <> NEW.customer_account_id
       OR original.amount_cents <> NEW.amount_cents THEN
      RAISE EXCEPTION 'Customer Credit Application reversal must exactly match its original application';
    END IF;
    RETURN NEW;
  END IF;

  IF source_status IN ('fully_applied', 'on_hold', 'refunded', 'reversed', 'disputed', 'resolved') THEN
    RAISE EXCEPTION 'Customer Credit is not available for application';
  END IF;
  IF target_status IN ('draft', 'review_required', 'ready_to_post', 'voided', 'replaced', 'archived') THEN
    RAISE EXCEPTION 'Customer Credit Application requires an eligible posted Invoice';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO already_applied
    FROM customer_credit_applications
   WHERE tenant_id = NEW.tenant_id AND customer_credit_id = NEW.customer_credit_id;

  SELECT COALESCE(SUM(amount_cents), 0)::bigint
    INTO already_refunded
    FROM refunds
   WHERE tenant_id = NEW.tenant_id
     AND customer_credit_id = NEW.customer_credit_id
     AND status NOT IN ('failed', 'cancelled', 'reversed');

  IF already_applied + already_refunded + NEW.amount_cents > source_amount THEN
    RAISE EXCEPTION 'Customer Credit Application exceeds available Customer Credit amount';
  END IF;

  eligible_amount := finance_invoice_balance(NEW.tenant_id, NEW.invoice_id);
  IF eligible_amount IS NULL OR NEW.amount_cents > eligible_amount THEN
    RAISE EXCEPTION 'Customer Credit Application exceeds eligible Invoice balance';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER customer_credit_applications_balance_guard
BEFORE INSERT ON customer_credit_applications
FOR EACH ROW EXECUTE FUNCTION enforce_customer_credit_application_balance();
--> statement-breakpoint

CREATE FUNCTION enforce_refund_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_amount bigint;
  source_currency varchar(3);
  applied_amount bigint;
  reserved_amount bigint;
BEGIN
  applied_amount := 0;

  IF NEW.source_type = 'payment' THEN
    SELECT amount_cents, currency INTO source_amount, source_currency
      FROM payments
     WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id
     FOR UPDATE;
    SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
      INTO applied_amount
      FROM payment_allocations
     WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id;
  ELSIF NEW.source_type = 'deposit' THEN
    SELECT original_amount_cents, currency INTO source_amount, source_currency
      FROM deposit_balances
     WHERE tenant_id = NEW.tenant_id AND id = NEW.deposit_balance_id
     FOR UPDATE;
    SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
      INTO applied_amount
      FROM deposit_applications
     WHERE tenant_id = NEW.tenant_id AND deposit_balance_id = NEW.deposit_balance_id;
  ELSE
    SELECT original_amount_cents, currency INTO source_amount, source_currency
      FROM customer_credits
     WHERE tenant_id = NEW.tenant_id AND id = NEW.customer_credit_id
     FOR UPDATE;
    SELECT COALESCE(SUM(CASE WHEN entry_kind = 'application' THEN amount_cents ELSE -amount_cents END), 0)::bigint
      INTO applied_amount
      FROM customer_credit_applications
     WHERE tenant_id = NEW.tenant_id AND customer_credit_id = NEW.customer_credit_id;
  END IF;

  IF source_amount IS NULL THEN
    RAISE EXCEPTION 'Refund source does not exist';
  END IF;
  IF source_currency <> NEW.currency THEN
    RAISE EXCEPTION 'Refund currency must match source currency';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)::bigint
    INTO reserved_amount
    FROM refunds
   WHERE tenant_id = NEW.tenant_id
     AND id <> NEW.id
     AND status NOT IN ('failed', 'cancelled', 'reversed')
     AND ((NEW.source_type = 'payment' AND payment_id = NEW.payment_id)
       OR (NEW.source_type = 'deposit' AND deposit_balance_id = NEW.deposit_balance_id)
       OR (NEW.source_type = 'customer_credit' AND customer_credit_id = NEW.customer_credit_id));

  IF applied_amount + reserved_amount + NEW.amount_cents > source_amount THEN
    RAISE EXCEPTION 'Refund exceeds available source amount';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER refunds_balance_guard
BEFORE INSERT OR UPDATE OF amount_cents, currency, status, payment_id, deposit_balance_id, customer_credit_id
ON refunds
FOR EACH ROW EXECUTE FUNCTION enforce_refund_balance();
--> statement-breakpoint

CREATE FUNCTION protect_finance_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% financial history cannot be deleted', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION protect_invoice_version_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted Invoice Versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION protect_invoice_line_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status varchar(30);
BEGIN
  SELECT status INTO version_status
    FROM invoice_versions
   WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
     AND id = COALESCE(NEW.invoice_version_id, OLD.invoice_version_id);
  IF version_status = 'posted' THEN
    RAISE EXCEPTION 'Posted Invoice Line Items are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION protect_posted_invoice_adjustment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted Invoice Adjustments are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION protect_append_only_finance_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% entries are append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION protect_settled_refund()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'settled' THEN
    RAISE EXCEPTION 'Settled Refunds are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER invoice_versions_history_guard
BEFORE UPDATE ON invoice_versions
FOR EACH ROW EXECUTE FUNCTION protect_invoice_version_history();
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_history_guard
BEFORE INSERT OR UPDATE ON invoice_line_items
FOR EACH ROW EXECUTE FUNCTION protect_invoice_line_history();
--> statement-breakpoint
CREATE TRIGGER invoice_adjustments_history_guard
BEFORE UPDATE ON invoice_adjustments
FOR EACH ROW EXECUTE FUNCTION protect_posted_invoice_adjustment();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_append_only_guard
BEFORE UPDATE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION protect_append_only_finance_entry();
--> statement-breakpoint
CREATE TRIGGER deposit_applications_append_only_guard
BEFORE UPDATE ON deposit_applications
FOR EACH ROW EXECUTE FUNCTION protect_append_only_finance_entry();
--> statement-breakpoint
CREATE TRIGGER customer_credit_applications_append_only_guard
BEFORE UPDATE ON customer_credit_applications
FOR EACH ROW EXECUTE FUNCTION protect_append_only_finance_entry();
--> statement-breakpoint
CREATE TRIGGER refunds_settled_guard
BEFORE UPDATE ON refunds
FOR EACH ROW EXECUTE FUNCTION protect_settled_refund();
--> statement-breakpoint

CREATE TRIGGER customer_credit_applications_no_delete_guard BEFORE DELETE ON customer_credit_applications
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER customer_credits_no_delete_guard BEFORE DELETE ON customer_credits
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER deposit_applications_no_delete_guard BEFORE DELETE ON deposit_applications
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER deposit_balances_no_delete_guard BEFORE DELETE ON deposit_balances
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER invoice_adjustments_no_delete_guard BEFORE DELETE ON invoice_adjustments
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER invoice_deliveries_no_delete_guard BEFORE DELETE ON invoice_deliveries
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_no_delete_guard BEFORE DELETE ON invoice_line_items
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER invoice_versions_no_delete_guard BEFORE DELETE ON invoice_versions
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER invoices_no_delete_guard BEFORE DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_no_delete_guard BEFORE DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER payments_no_delete_guard BEFORE DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint
CREATE TRIGGER refunds_no_delete_guard BEFORE DELETE ON refunds
FOR EACH ROW EXECUTE FUNCTION protect_finance_deletion();
--> statement-breakpoint

CREATE TRIGGER customer_credits_row_update BEFORE UPDATE ON customer_credits
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER deposit_balances_row_update BEFORE UPDATE ON deposit_balances
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER invoice_adjustments_row_update BEFORE UPDATE ON invoice_adjustments
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER invoice_deliveries_row_update BEFORE UPDATE ON invoice_deliveries
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_row_update BEFORE UPDATE ON invoice_line_items
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER invoice_versions_row_update BEFORE UPDATE ON invoice_versions
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER invoices_row_update BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER payments_row_update BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint
CREATE TRIGGER refunds_row_update BEFORE UPDATE ON refunds
FOR EACH ROW EXECUTE FUNCTION set_row_update_metadata();
--> statement-breakpoint

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customer_credit_applications',
    'customer_credits',
    'deposit_applications',
    'deposit_balances',
    'invoice_adjustments',
    'invoice_deliveries',
    'invoice_line_items',
    'invoice_versions',
    'invoices',
    'payment_allocations',
    'payments',
    'refunds'
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

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON customer_credit_applications, deposit_applications,
      payment_allocations, customer_credits, deposit_balances, invoice_adjustments,
      invoice_deliveries, invoice_line_items, invoice_versions, invoices, payments, refunds TO ldg_app;
  END IF;
END;
$$;
