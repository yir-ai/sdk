import { findModelOperationContract, type ModelContractCatalog } from "../shared/catalog.js";

/**
 * Returns the catalog only when it describes the request's model, operation and
 * input mode. Anything newer than that snapshot is left to the Gateway, so a
 * stale catalog never blocks a model published after it was read.
 */
export function coveringCatalog(
  catalog: ModelContractCatalog | undefined,
  operation: "generate_image" | "generate_video",
  request: { readonly model?: unknown; readonly input?: { readonly type?: unknown } },
): ModelContractCatalog | undefined {
  if (!catalog || typeof request?.model !== "string" || typeof request.input?.type !== "string") return undefined;
  return findModelOperationContract(catalog, request.model, operation, request.input.type) ? catalog : undefined;
}
