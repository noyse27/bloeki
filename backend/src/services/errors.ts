export class RoundEngineError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RoundEngineError';
    this.code = code;
  }
}
