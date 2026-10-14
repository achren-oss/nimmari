import { z } from "zod";

const fieldType = z.enum(["text", "textarea", "checkbox", "signature", "date", "hetu"]);

export const FieldSchema = z.object({
  type: fieldType,
  page: z.number().int().min(0),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(10),
  height: z.number().int().min(10),
  name: z.string().trim().min(1).max(200).optional(),
  label: z.string().optional(),
  required: z.boolean().default(true),
  privateForOtherSigners: z.boolean().default(false),
  assignedSignerKey: z.string().trim().min(1).max(200).nullable().optional(),
  assignedToSignerEmail: z.string().email().nullable().optional(),
});

/** Request body for PUT /api/documents/[id]/fields (replaces all fields). */
export const FieldsBody = z.object({ fields: z.array(FieldSchema) });
