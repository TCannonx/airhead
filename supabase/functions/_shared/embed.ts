/**
 * Supabase's built-in embedding model in the Edge Runtime: gte-small, 384
 * dimensions, normalised (Tasks 7.9–7.11). The `Supabase` global only exists
 * there, so tests inject their own embedder instead.
 */
interface Session {
  run(input: string, opts: Record<string, unknown>): Promise<unknown>;
}
declare const Supabase: { ai: { Session: new (model: string) => Session } } | undefined;

let session: Session | null = null;

export async function gteSmall(text: string): Promise<number[]> {
  if (typeof Supabase === 'undefined') throw new Error('No embedding model here.');
  session ??= new Supabase.ai.Session('gte-small');
  return (await session.run(text, { mean_pool: true, normalize: true })) as number[];
}
