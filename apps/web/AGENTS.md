# Web Application Instructions

- Use the generated API client from `@ldg/api-client`.
- Do not duplicate authoritative business rules in React components.
- Do not connect directly to PostgreSQL.
- Core business mutations must call explicit API action endpoints.
- Support mobile layouts from the start.
- Every page needs loading, empty, error, and success states.
- Driver views require large touch targets and minimal typing.
- Customer pages must never expose internal costs, margin, approvals, or employee notes.
- Preserve keyboard navigation, labels, focus behavior, and screen-reader meaning.
- Browser calculations are previews only; the API recalculates authoritative values.
