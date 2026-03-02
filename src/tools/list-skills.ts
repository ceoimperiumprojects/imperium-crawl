import { z } from "zod";
import * as manager from "../skills/manager.js";

export const name = "list_skills";

export const description = "List all saved skills with their descriptions and URLs.";

export const schema = z.object({});

export type ListSkillsInput = z.infer<typeof schema>;

export async function execute(_input: ListSkillsInput) {
  const skills = await manager.list();

  if (skills.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: "No skills found. Use create_skill to create one.",
              skills: [],
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            total: skills.length,
            skills: skills.map((s) => ({
              name: s.name,
              description: s.description,
              url: s.url,
              created_at: s.created_at,
              fields: Object.keys(s.selectors.fields),
              has_pagination: !!s.pagination,
            })),
          },
          null,
          2,
        ),
      },
    ],
  };
}
