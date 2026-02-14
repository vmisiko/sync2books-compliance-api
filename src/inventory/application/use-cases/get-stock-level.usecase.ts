import type { IStockRepository } from '../../domain/ports/stock-repository.port';

export interface GetStockLevelInput {
  itemId: string;
  branchId: string;
}

export interface GetStockLevelResult {
  itemId: string;
  branchId: string;
  quantityOnHand: number;
  reservedQuantity: number;
}

export async function getStockLevel(
  input: GetStockLevelInput,
  stockRepo: IStockRepository,
): Promise<GetStockLevelResult> {
  const stock = await stockRepo.getStock(input.itemId, input.branchId);
  return {
    itemId: input.itemId,
    branchId: input.branchId,
    quantityOnHand: stock?.quantityOnHand ?? 0,
    reservedQuantity: stock?.reservedQuantity ?? 0,
  };
}
