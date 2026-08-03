import type { DomainStatus } from '../../shared/status';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}

export function isDomainStatus(value: unknown): value is DomainStatus {
  return value === 'available' || value === 'taken';
}
