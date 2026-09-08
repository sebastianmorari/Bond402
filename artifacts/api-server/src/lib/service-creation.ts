import type { db } from "@workspace/db";

export type ServiceTransactionClient = Pick<typeof db, "insert" | "select">;

export type ServiceTransaction = <T>(
  callback: (tx: ServiceTransactionClient) => Promise<T>,
) => Promise<T>;

export async function runServiceCreationTransaction<T>(
  transaction: ServiceTransaction,
  callback: (tx: ServiceTransactionClient) => Promise<T>,
) {
  return transaction(callback);
}