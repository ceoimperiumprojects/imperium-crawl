import { z } from "zod";
import * as manager from "../skills/manager.js";
import type { ExtractSkillConfig } from "../skills/manager.js";

export const name = "list_skills";

export const description = "List all saved skills and built-in recipes with their descriptions and URLs.";

export const schema = z.object({});

export type ListSkillsInput = z.infer<typeof schema>;

export async function execute(_input: ListSkillsInput) {
  const skills = await manager.listAll();

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
            skills: skills.map((s) => {
              const tool = s.tool ?? "extract";
              const base = {
                name: s.name,
                description: s.description,
                url: s.url,
                tool,
                created_at: s.created_at,
                ...(s.builtin && { builtin: true }),
              };

              // Only include fields/pagination for extract skills that have selectors
              if (tool === "extract" && "selectors" in s) {
                const extractConfig = s as ExtractSkillConfig;
                return {
                  ...base,
                  fields: Object.keys(extractConfig.selectors.fields),
                  has_pagination: !!extractConfig.pagination,
                };
              }

              return base;
            }),
          },
          null,
          2,
        ),
      },
    ],
  };
}
