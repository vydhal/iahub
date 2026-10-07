import { zodToCatalog } from './schemaDoc.js';
import { aiAnalyzeTool } from './aiAnalyze.js';
import { browserTool } from './browser.js';
import { dataMetricsTool } from './dataMetrics.js';
import { emailSendTool, telegramSendTool, webhookSendTool } from './delivery.js';
import { httpRequestTool } from './httpRequest.js';
import { sandboxDatasetTool } from './sandboxDataset.js';
import { ToolDefinition } from '../types.js';

const TOOLS: ToolDefinition<any>[] = [
  httpRequestTool,
  browserTool,
  sandboxDatasetTool,
  dataMetricsTool,
  aiAnalyzeTool,
  telegramSendTool,
  emailSendTool,
  webhookSendTool,
];

export const toolRegistry = new Map(TOOLS.map((t) => [t.name, t]));

export function toolCatalog() {
  return TOOLS.map((t) => ({
    name: t.name,
    label: t.label,
    description: t.description,
    category: t.category,
    credentialTypes: t.credentialTypes || [],
    fields: zodToCatalog(t.inputSchema),
    example: t.example,
  }));
}
