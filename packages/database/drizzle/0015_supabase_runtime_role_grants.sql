-- Reconcile the restricted runtime role after environments provision ldg_app after schema setup.
-- Keep the grants explicit so immutable and append-only records do not gain delete privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ldg_app;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ldg_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ldg_app;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ldg_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO ldg_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_tenant_context(uuid) TO ldg_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  account_contacts,
  asset_assignments,
  asset_reservations,
  assets,
  checklist_instances,
  checklist_items,
  contacts,
  contract_public_links,
  contract_signatures,
  contracts,
  customer_accounts,
  delivery_zones,
  document_links,
  document_public_links,
  documents,
  dump_trailer_rental_details,
  estimate_cost_items,
  estimate_versions,
  estimates,
  expense_allocations,
  expenses,
  idempotency_keys,
  job_assignments,
  job_charges,
  job_events,
  jobs,
  lead_notes,
  lead_tasks,
  leads,
  location_contacts,
  material_delivery_details,
  material_load_assets,
  material_load_items,
  material_loads,
  material_quantity_variances,
  material_substitutions,
  materials,
  number_sequences,
  operational_holds,
  organizations,
  outbox_events,
  pricing_calculation_results,
  pricing_policies,
  pricing_rule_tiers,
  pricing_rules,
  pricing_versions,
  projects,
  quote_acceptances,
  quote_deliveries,
  quote_line_items,
  quote_public_links,
  quote_terms,
  quote_versions,
  quotes,
  readiness_evaluations,
  rental_debris_reviews,
  rental_extensions,
  rental_inspections,
  rental_pickup_attempts,
  disposal_loads,
  roles,
  route_stops,
  scheduled_jobs,
  schedule_blocks,
  service_locations,
  supplier_cost_versions,
  supplier_locations,
  supplier_materials,
  suppliers,
  user_roles,
  users,
  worker_heartbeats
TO ldg_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  customer_credit_applications,
  customer_credits,
  deposit_applications,
  deposit_balances,
  invoice_adjustments,
  invoice_deliveries,
  invoice_line_items,
  invoice_public_links,
  invoice_versions,
  invoices,
  notification_deliveries,
  notification_delivery_attempts,
  notification_preferences,
  notification_templates,
  payment_allocations,
  payments,
  project_public_links,
  refunds
TO ldg_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON
  audit_events,
  material_load_validations,
  project_public_link_views
TO ldg_app;
--> statement-breakpoint
REVOKE ALL ON public.__drizzle_migrations FROM ldg_app;
