export class ItemNotReadyForEtimsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemNotReadyForEtimsError';
  }
}
