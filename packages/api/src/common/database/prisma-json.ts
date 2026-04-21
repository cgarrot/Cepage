import { Prisma } from '@prisma/client';

export function json(
  value: Prisma.InputJsonValue | Record<string, unknown> | readonly unknown[] = {},
): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function nullableJson(
  value:
    | Prisma.InputJsonValue
    | Record<string, unknown>
    | readonly unknown[]
    | null
    | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}
