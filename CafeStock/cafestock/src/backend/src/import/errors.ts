/** A problem with the dataset or the import options, explained for the person running it. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
