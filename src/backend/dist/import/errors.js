/** A problem with the dataset or the import options, explained for the person running it. */
export class ImportError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ImportError';
    }
}
//# sourceMappingURL=errors.js.map