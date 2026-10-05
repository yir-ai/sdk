// Historical model facts are test input, never an implicit runtime admission list.
import { readFileSync } from 'node:fs';
import { createYirClient as createClient } from '../dist/server/client.js';
import { findModelContract, findModelOperationContract } from '../dist/shared/catalog.js';
import { validateGeneration as validateRequest, validateModelParameters as validateParameters,
  buildImageGenerationRequest as buildRequest, buildImageQuoteRequest as buildQuote } from '../dist/shared/standard.js';

const snapshot = JSON.parse(readFileSync(new URL('../../spec/models.json', import.meta.url), 'utf8'));

export const catalog = {
  schema_version: 'v1', schema_ref: 'fixture', models: snapshot.models,
};
export const listModelContracts = () => catalog.models;
export const getModelContract = model => findModelContract(catalog, model);
export const getModelOperationContract = (model, operation, inputMode) =>
  findModelOperationContract(catalog, model, operation, inputMode);
export const createYirClient = transport => createClient(transport, catalog);
export const validateGeneration = (operation, request) => validateRequest(operation, request, catalog);
export const validateModelParameters = (...args) => validateParameters(...args, catalog);
export const buildImageGenerationRequest = input => buildRequest(input, catalog);
export const buildImageQuoteRequest = input => buildQuote(input, catalog);
