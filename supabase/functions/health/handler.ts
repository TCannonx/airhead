/** Health check used by the keep-alive workflow. Touching the database counts
 * as activity, which stops the free plan pausing the project after 7 idle days. */
export type DbCheck = () => Promise<void>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function handleHealth(req: Request, checkDb: DbCheck): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use GET.' }, 405);
  }
  try {
    await checkDb();
    return json({
      ok: true,
      error_code: null,
      message: 'Healthy.',
      time: new Date().toISOString(),
    });
  } catch {
    return json(
      { ok: false, error_code: 'db_unreachable', message: 'The database did not answer.' },
      503,
    );
  }
}
