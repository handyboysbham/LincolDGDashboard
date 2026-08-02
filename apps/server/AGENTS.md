# Server Application Instructions

- Controllers remain thin and call application services.
- Commands own mutations and state transitions.
- Queries own reads.
- Every mutation runs in the correct tenant transaction context.
- State transitions must create Audit and outbox events in the same transaction.
- Map domain errors to stable API error codes.
- Do not import another module's infrastructure repository.
- Cross-module workflows use public application services or orchestration services.
- Domain code must not import NestJS, Drizzle, provider SDKs, or browser code.
- Retryable critical commands require idempotency.
- Financial commands require row locking and explicit invariants.
- Never allow a controller to set status or balance directly.
