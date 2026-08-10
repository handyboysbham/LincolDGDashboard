ALTER TABLE "notification_delivery_attempts" DROP CONSTRAINT "notification_delivery_attempts_tenant_provider_key_unique";--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_tenant_provider_key_idx" ON "notification_delivery_attempts" USING btree ("tenant_id","provider_idempotency_key");
