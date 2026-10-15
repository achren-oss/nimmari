import { z } from "zod";

const fieldType = z.enum(["text", "textarea", "checkbox", "signature", "date", "hetu"]);

const FieldInputSchema = z.object({
  type: fieldType,
  page: z.number().int().min(0),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(10),
  height: z.number().int().min(10),
  name: z.string().trim().min(1).max(200).optional(),
  label: z.string().optional(),
  required: z.boolean().optional(),
  privateForOtherSigners: z.boolean().default(false),
  assignedSignerKey: z.string().trim().min(1).max(200).nullable().optional(),
  assignedToSignerEmail: z.string().email().nullable().optional(),
});

export const FieldSchema = FieldInputSchema.transform((f) => ({
  ...f, required: f.required ?? f.type === "signature",
}));

/** Existing IDs preserve omitted metadata; new fields receive type-based defaults. */
export const FieldsBody = z.object({ fields: z.array(FieldInputSchema.extend({
  id: z.string().min(1).optional(),
  value: z.string().nullable().optional(),
  prefilled: z.boolean().optional(),
  privateForOtherSigners: z.boolean().optional(),
}).transform((f) => f.id ? f : { ...f, required: f.required ?? f.type === "signature" })) });
