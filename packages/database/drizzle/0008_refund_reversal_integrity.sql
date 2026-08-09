ALTER TABLE "refunds" DROP CONSTRAINT "refunds_alternate_method_check";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_alternate_method_check" CHECK ("refunds"."original_method" is null or "refunds"."refund_method" = "refunds"."original_method" or ("refunds"."alternate_method_reason" is not null and ("refunds"."status" not in ('approved', 'processing', 'partially_processed', 'processed', 'settled', 'reversed', 'resolved') or "refunds"."approved_by" is not null)));--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_payment_allocation_balance()
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

  SELECT COALESCE(SUM(CASE WHEN reverses_refund_id IS NULL THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO already_refunded
    FROM refunds
   WHERE tenant_id = NEW.tenant_id
     AND payment_id = NEW.payment_id
     AND status NOT IN ('failed', 'cancelled');

  IF already_allocated + already_refunded + NEW.amount_cents > source_amount THEN
    RAISE EXCEPTION 'Payment Allocation exceeds available Payment amount';
  END IF;

  eligible_amount := finance_invoice_balance(NEW.tenant_id, NEW.invoice_id);
  IF eligible_amount IS NULL OR NEW.amount_cents > eligible_amount THEN
    RAISE EXCEPTION 'Payment Allocation exceeds eligible Invoice balance';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_deposit_application_balance()
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

  SELECT COALESCE(SUM(CASE WHEN reverses_refund_id IS NULL THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO already_refunded
    FROM refunds
   WHERE tenant_id = NEW.tenant_id
     AND deposit_balance_id = NEW.deposit_balance_id
     AND status NOT IN ('failed', 'cancelled');

  IF already_applied + already_refunded + NEW.amount_cents > source_amount THEN
    RAISE EXCEPTION 'Deposit Application exceeds available Deposit amount';
  END IF;

  eligible_amount := finance_invoice_balance(NEW.tenant_id, NEW.invoice_id);
  IF eligible_amount IS NULL OR NEW.amount_cents > eligible_amount THEN
    RAISE EXCEPTION 'Deposit Application exceeds eligible Invoice balance';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_customer_credit_application_balance()
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

  SELECT COALESCE(SUM(CASE WHEN reverses_refund_id IS NULL THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO already_refunded
    FROM refunds
   WHERE tenant_id = NEW.tenant_id
     AND customer_credit_id = NEW.customer_credit_id
     AND status NOT IN ('failed', 'cancelled');

  IF already_applied + already_refunded + NEW.amount_cents > source_amount THEN
    RAISE EXCEPTION 'Customer Credit Application exceeds available Customer Credit amount';
  END IF;

  eligible_amount := finance_invoice_balance(NEW.tenant_id, NEW.invoice_id);
  IF eligible_amount IS NULL OR NEW.amount_cents > eligible_amount THEN
    RAISE EXCEPTION 'Customer Credit Application exceeds eligible Invoice balance';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_refund_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_amount bigint;
  source_currency varchar(3);
  applied_amount bigint;
  reserved_amount bigint;
  new_reserved_amount bigint;
  original refunds%ROWTYPE;
BEGIN
  IF NEW.reverses_refund_id IS NOT NULL THEN
    SELECT * INTO original
      FROM refunds
     WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_refund_id
     FOR UPDATE;
    IF original.id IS NULL OR original.status <> 'settled'
       OR NEW.status <> 'reversed'
       OR original.source_type <> NEW.source_type
       OR original.customer_account_id <> NEW.customer_account_id
       OR original.project_id IS DISTINCT FROM NEW.project_id
       OR original.payment_id IS DISTINCT FROM NEW.payment_id
       OR original.deposit_balance_id IS DISTINCT FROM NEW.deposit_balance_id
       OR original.customer_credit_id IS DISTINCT FROM NEW.customer_credit_id
       OR original.amount_cents <> NEW.amount_cents
       OR original.currency <> NEW.currency
       OR original.refund_method <> NEW.refund_method THEN
      RAISE EXCEPTION 'Refund reversal must exactly match one settled Refund';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'reversed' THEN
    RAISE EXCEPTION 'Reversed Refund status requires a linked settled Refund';
  END IF;

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

  SELECT COALESCE(SUM(CASE WHEN reverses_refund_id IS NULL THEN amount_cents ELSE -amount_cents END), 0)::bigint
    INTO reserved_amount
    FROM refunds
   WHERE tenant_id = NEW.tenant_id
     AND id <> NEW.id
     AND status NOT IN ('failed', 'cancelled')
     AND ((NEW.source_type = 'payment' AND payment_id = NEW.payment_id)
       OR (NEW.source_type = 'deposit' AND deposit_balance_id = NEW.deposit_balance_id)
       OR (NEW.source_type = 'customer_credit' AND customer_credit_id = NEW.customer_credit_id));

  new_reserved_amount := CASE WHEN NEW.status IN ('failed', 'cancelled') THEN 0 ELSE NEW.amount_cents END;
  IF applied_amount + reserved_amount + new_reserved_amount > source_amount THEN
    RAISE EXCEPTION 'Refund exceeds available source amount';
  END IF;
  RETURN NEW;
END;
$$;
