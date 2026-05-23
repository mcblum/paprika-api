import { z } from 'zod';

export const PaprikaGroceryListSchema = z.object({
  uid: z.string(),
  name: z.string(),
  order_flag: z.number(),
  is_default: z.boolean(),
  reminders_list: z.string(),
});

export type PaprikaGroceryList = z.infer<typeof PaprikaGroceryListSchema>;

export const PaprikaGroceryItemSchema = z.object({
  uid: z.string(),
  name: z.string(),
  ingredient: z.string(),
  quantity: z.string(),
  aisle: z.string(),
  aisle_uid: z.string(),
  list_uid: z.string(),
  recipe: z.string().nullable(),
  recipe_uid: z.string().nullable(),
  instruction: z.string(),
  purchased: z.boolean(),
  separate: z.boolean(),
  order_flag: z.number(),
});

export type PaprikaGroceryItem = z.infer<typeof PaprikaGroceryItemSchema>;

export const PaprikaLoginResultSchema = z.object({
  token: z.string(),
});

export type PaprikaLoginResult = z.infer<typeof PaprikaLoginResultSchema>;

export function paprikaApiResponse<T extends z.ZodTypeAny>(resultSchema: T) {
  return z.object({ result: resultSchema });
}
