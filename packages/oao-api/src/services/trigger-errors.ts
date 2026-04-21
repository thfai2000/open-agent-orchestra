export type TriggerServiceErrorStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502;

export class TriggerServiceError extends Error {
  status: TriggerServiceErrorStatus;
  issues?: unknown;

  constructor(message: string, status: TriggerServiceErrorStatus = 400, issues?: unknown) {
    super(message);
    this.name = 'TriggerServiceError';
    this.status = status;
    this.issues = issues;
  }
}