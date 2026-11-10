import type {Request, RequestHandler} from 'express';

// Requests slower than this are written to the server log (Render Logs) so the
// slowest pages can be found and fixed. Search the logs for "request.slow".
export const slowRequestThresholdMs = 2000;

type SlowRequestEntry = {
  event: 'request.slow';
  requestId?: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  aborted: boolean;
};

// Route patterns only (for example /api/project-workflow/records/:id): never
// the real URL, query values, bodies, cookies or user details.
export function routePattern(req: Request): string {
  const path = req.route?.path;
  if (typeof path !== 'string') return 'unmatched';
  const pattern = `${req.baseUrl}${path === '/' ? '' : path}`;
  return pattern || '/';
}

export function slowRequestLog({
  thresholdMs = slowRequestThresholdMs,
  now = () => performance.now(),
  log = (entry: SlowRequestEntry) => console.warn(JSON.stringify(entry)),
}: {
  thresholdMs?: number;
  now?: () => number;
  log?: (entry: SlowRequestEntry) => void;
} = {}): RequestHandler {
  return (req, res, next) => {
    const started = now();
    // 'close' fires once per response, whether it finished or the browser left early.
    res.once('close', () => {
      const durationMs = Math.round(now() - started);
      if (durationMs < thresholdMs) return;
      try {
        log({
          event: 'request.slow',
          requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined,
          method: req.method,
          route: routePattern(req),
          status: res.statusCode,
          durationMs,
          aborted: !res.writableFinished,
        });
      } catch {
        // Logging must never affect the response.
      }
    });
    next();
  };
}
