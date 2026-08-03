import createClient, { type ClientOptions } from "openapi-fetch";

import type { paths } from "./generated.js";

export type { components, operations, paths } from "./generated.js";

export interface ApiClientOptions extends ClientOptions {
  baseUrl: string;
}

/** Create a runtime client whose request and response types come from the committed API contract. */
export function createApiClient(options: ApiClientOptions) {
  return createClient<paths>(options);
}
