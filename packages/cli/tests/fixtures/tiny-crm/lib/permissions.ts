export function requirePermission(request: Request, permission: string) {
  if (request.headers.get('authorization') !== 'Bearer fixture-token')
    throw new Error(`Permission denied: ${permission}`);
}
