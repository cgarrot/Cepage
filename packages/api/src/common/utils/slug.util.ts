// Tiny slug helper used for user-authored skills, webhooks, and any
// surface that accepts a human title and needs a URL-safe identifier.
export function toSlug(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || `skill-${Date.now()}`;
}

export function isValidSlug(candidate: string): boolean {
  if (!candidate || candidate.length > 64) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(candidate);
}
