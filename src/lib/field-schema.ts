import { z } from "zod";

export const FieldSchema = z.object({
  type: z.enum(["text", "textarea", "checkbox", "signature"]),
  page: z.number().int().min(0),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(10),
  height: z.number().int().min(10),
  label: z.string().optional(),
  required: z.boolean().default(true),
});

/** Request body for PUT /api/documents/[id]/fields (replaces all fields). */
export const FieldsBody = z.object({ fields: z.array(FieldSchema) });
