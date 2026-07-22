/** Kimi Code agent prompts installed as private skills. */
import { createTemplateReader, type AgentTemplate } from "../template-utils.js";

const { listMdAgents } = createTemplateReader(import.meta.url);

export function getAllAgents(): AgentTemplate[] {
  return listMdAgents();
}
