import { z } from 'zod';

export const ItemSideStateSchema = z.object({
  hash: z.string(),
  changedAt: z.string().datetime(),
});

export const ItemSnapshotSchema = z.object({
  paprika: ItemSideStateSchema,
  connector: ItemSideStateSchema,
});

export const ItemSchema = z.object({
  connectorName: z.string(),
  paprikaUid: z.string(),
  name: z.string(),
  paprika: ItemSideStateSchema,
  connector: ItemSideStateSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export type ItemSideState = z.infer<typeof ItemSideStateSchema>;
export type ItemSnapshot = z.infer<typeof ItemSnapshotSchema>;
export type Item = z.infer<typeof ItemSchema>;

export interface UpsertItemInput {
  readonly connectorName: string;
  readonly paprikaUid: string;
  readonly name: string;
  readonly snapshot: ItemSnapshot;
  readonly occurredAt: string;
  readonly isCompleted: boolean;
}
