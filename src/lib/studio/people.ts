// Who is signed in, in words. Studio only ever has the two people on the allowlist.

/** "hello@curatedbynat.com" is Nat; otherwise the first word of the address, for example "Matt". */
export function firstNameFromEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (normalized.startsWith('hello@')) return 'Nat';
    const word = (normalized.split('@')[0] ?? '').split(/[._+-]/)[0]?.replace(/\d+$/, '') ?? '';
    return word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : 'there';
}
