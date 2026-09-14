import { createYirClient, type QuotePrice, type StandardImageGenerationRequest } from "@yir-ai/sdk";
import { getModelContract } from "@yir-ai/sdk/model-contracts";
import { createYirAIProvider } from "@yir-ai/sdk/vercel";
import {buildPriceInput,type ModelPriceFilter} from '@yir-ai/sdk';
import {calculatePrice,type PriceTable} from '@yir-ai/sdk/pricing';

const request: StandardImageGenerationRequest = {
  model: "openai/gpt-image-2", input: { type: "text", prompt: "test" }, parameters: {},
};
const price: QuotePrice = { kind: "estimate", amount: "0.04239", estimate: { scope: "output_only", output_tokens: 1413 } };
const client = createYirClient(async <T>(): Promise<T> => { throw new Error("No network in type validation"); });
client.quoteImage(request);
getModelContract(request.model);
createYirAIProvider({ client }).imageModel(request.model);
price.estimate.output_tokens satisfies number;
const filter:ModelPriceFilter={resolution:'4k',reference_count:2};
client.getModelPrices('openai/gpt-image-2','generate_image','image',{filter});
const table:PriceTable={format:'yir-price-table-v1',version:'v1',purpose:'retail',unit:'credit',scale:100,rows:[]};
calculatePrice(table,buildPriceInput('generate_image',request,table.version));

import type { Job } from '@yir-ai/sdk/shared';
import { calculatePrice as browserPrice } from '@yir-ai/sdk/browser';
import { createNodeYirClient } from '@yir-ai/sdk/server';
const jobID = (job: Job) => job.id;
void [jobID, browserPrice, createNodeYirClient];
