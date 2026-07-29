export class ReferenceRunCancelledError extends Error {
    constructor() {
        super("Campagne de référence annulée.");
        this.name = "ReferenceRunCancelledError";
    }
}