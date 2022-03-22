interface ErrorOptions {
    cause?: any | unknown;
}

interface ErrorConstructor {
    new(message?: string, options?: ErrorOptions): Error;
    (message?: string, options?: ErrorOptions): Error;
    readonly prototype: Error;
}

declare var Error: ErrorConstructor
