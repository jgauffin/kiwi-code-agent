import { z } from 'zod'
import { readSkillBody, type SkillEntry } from '../../skills/skill-index'
import { fail, ok, truncate, type Tool } from './tool'

const schema = z.object({
  name: z.string().describe('The skill to load, as listed in the tool description'),
})

/**
 * Loads a workspace skill's instructions. The index rides in the tool
 * description so the model decides from the descriptions alone, the way
 * Claude Code's own Skill tool works.
 */
export function skillTool(skills: SkillEntry[]): Tool<typeof schema> {
  return {
    name: 'Skill',
    description: [
      "Loads a skill's instructions into the conversation. Call it before starting work whenever the task matches a skill's description; the instructions are the way this workspace does that kind of work.",
      'Available skills:',
      ...skills.map((s) => `- ${s.name}: ${s.description}`),
    ].join('\n'),
    schema,
    readOnly: true,
    async execute(input) {
      const skill = skills.find((s) => s.name === input.name)
      if (!skill) return fail(`Unknown skill "${input.name}". Available: ${skills.map((s) => s.name).join(', ')}`)
      const body = await readSkillBody(skill)
      return ok(truncate(`Skill "${skill.name}" loaded. Its folder is ${skill.dir}; relative paths in the instructions refer to files there.\n\n${body}`))
    },
  }
}
