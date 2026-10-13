// 显式浏览器入口：无网络、无密钥、无服务端依赖。
export { findModelContract, findModelOperationContract, parseModelContractCatalog, defaultModelParameters, describeModelParameters, describeReferences } from '../shared/catalog.js';
export type { ModelParameterField, ModelParameterOption, ReferenceRoleSlot, ReferenceSlots } from '../shared/catalog.js';
export { validateModelParameters, validateGeneration, buildImageGenerationRequest, buildImageQuoteRequest, YirSDKValidationError } from '../shared/standard.js';
export type { Job, JobStatus, Quote } from '../shared/types.js';
