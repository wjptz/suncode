/** Grok Build agent templates. */
import { createTemplateReader, type AgentTemplate } from "../template-utils.js";

const { listMdAgents } = createTemplateReader(import.meta.url);

export function getAllAgents(): AgentTemplate[] {
  return listMdAgents();
}
