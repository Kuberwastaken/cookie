/**
 * Minimal Cloudflare Pages Functions typings. Enough to type our one handler
 * without pulling the full @cloudflare/workers-types dependency into a weekend
 * project. At runtime the platform provides the real objects.
 */
declare type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (p: Promise<unknown>) => void;
  next: () => Promise<Response>;
  data: Record<string, unknown>;
}) => Response | Promise<Response>;
