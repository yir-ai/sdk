// Historical model facts are test input, never an implicit runtime admission list.
import { listModelContracts } from '../dist/shared/model-contracts.js';
import { createYirClient as createClient } from '../dist/server/client.js';
import { validateGeneration as validateRequest, validateModelParameters as validateParameters,
  buildImageGenerationRequest as buildRequest, buildImageQuoteRequest as buildQuote } from '../dist/shared/standard.js';

export const catalog = {
  schema_version: 'v1', schema_ref: 'fixture', models: listModelContracts(),
};
export const createYirClient = transport => createClient(transport, catalog);
export const validateGeneration = (operation, request) => validateRequest(operation, request, catalog);
export const validateModelParameters = (...args) => validateParameters(...args, catalog);
export const buildImageGenerationRequest = input => buildRequest(input, catalog);
export const buildImageQuoteRequest = input => buildQuote(input, catalog);
