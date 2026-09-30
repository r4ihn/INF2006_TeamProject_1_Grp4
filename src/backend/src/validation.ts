import { z } from "zod";

export const MOVEMENT_TYPES = [
  "RECEIVE",
  "SELL",
  "SPOILAGE",
  "ADJUST",
] as const;

const id = z.coerce.number().int().positive();
const text = (max: number) => z.string().trim().min(1).max(max);
// numeric(14,3): at most 3 decimal places and 11 integer digits.
const quantity = z
  .number()
  .finite()
  .refine((q) => Math.abs(q) < 1e11, "quantity is too large")
  .refine(
    (q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6,
    "at most 3 decimal places"
  );

export const idParam = z.object({ id });

// quantity is a positive magnitude for RECEIVE, SELL and SPOILAGE (the API applies the sign).
// For ADJUST (stocktake correction) it is signed: positive adds stock, negative removes it.
export const movementBody = z
  .strictObject({
    productId: id,
    movementType: z.enum(MOVEMENT_TYPES),
    quantity,
    batchId: text(40).optional(),
    expiryDate: z.iso.date().optional(),
    reason: text(200).optional(),
  })
  .superRefine((m, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (m.movementType === "ADJUST") {
      if (m.quantity === 0) issue("quantity", "must not be zero");
    } else if (m.quantity <= 0) {
      issue("quantity", "must be greater than zero");
    }
    if (m.movementType !== "RECEIVE" && m.expiryDate !== undefined) {
      issue("expiryDate", "can only be set when receiving stock");
    }
    if (
      (m.movementType === "SPOILAGE" || m.movementType === "ADJUST") &&
      !m.batchId
    ) {
      issue("batchId", `is required for ${m.movementType}`);
    }
    if (
      (m.movementType === "SPOILAGE" || m.movementType === "ADJUST") &&
      !m.reason
    ) {
      issue("reason", `is required for ${m.movementType}`);
    }
  });

export const listMovementsQuery = z.object({
  productId: id.optional(),
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  beforeId: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const listStockQuery = z.object({
  lowOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type MovementBody = z.infer<typeof movementBody>;
