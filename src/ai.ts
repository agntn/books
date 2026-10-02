/** Vercel AI SDK tool surface over the shared book tool definitions. */

import { toAiTool, type AiToolOutput } from "@agntn/tools/ai";
import type { Tool } from "ai";
import type {
  BookDetails,
  BookParams,
  ProvidersDetails,
  SearchDetails,
  SearchParams,
  TextDetails,
  TextParams,
  TextSearchDetails,
  TextSearchParams,
} from "./tool-operations.ts";
import {
  getTool,
  providersTool as providersDefinition,
  searchTool as searchDefinition,
  textSearchTool as textSearchDefinition,
  textTool as textDefinition,
} from "./tools.ts";

export const searchTool: Tool<SearchParams, AiToolOutput<SearchDetails>> = toAiTool(
  searchDefinition,
);
export const bookTool: Tool<BookParams, AiToolOutput<BookDetails>> = toAiTool(getTool);
export const textTool: Tool<TextParams, AiToolOutput<TextDetails>> = toAiTool(textDefinition);
export const textSearchTool: Tool<TextSearchParams, AiToolOutput<TextSearchDetails>> = toAiTool(
  textSearchDefinition,
);
export const providersTool: Tool<object, AiToolOutput<ProvidersDetails>> = toAiTool(
  providersDefinition,
);
