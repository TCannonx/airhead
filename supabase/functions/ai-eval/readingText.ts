/** The device's link pattern (src/lib/rules/links.ts), for the reading eval case. */
export function findUrlsServer(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0].replace(/[),.;:!?]+$/, ''));
}
