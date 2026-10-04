// Reply templates: filling in a client's details, and the pieces that need them. Pure, so it is easy to test.
import { formatDate } from './dates.ts';
import { formatCents } from './money.ts';
import { celebratingLabels } from './vocab.ts';

/** The placeholders Nat can use, with what they stand for. */
export const PLACEHOLDERS: ReadonlyArray<{ name: string; meaning: string }> = [
    { name: 'first_name', meaning: "Their first name" },
    { name: 'last_name', meaning: 'Their last name' },
    { name: 'partner_name', meaning: "Their partner's name" },
    { name: 'event_date', meaning: 'The date of their event' },
    { name: 'celebrating', meaning: 'What they are celebrating (wedding, bachelorette weekend...)' },
    { name: 'location', meaning: 'Where it is' },
    { name: 'venue', meaning: 'The venue' },
    { name: 'package', meaning: 'The package they booked' },
    { name: 'packages', meaning: 'Your packages with their prices' },
    { name: 'extras', meaning: 'Your extras with their prices' },
    { name: 'included_in_all', meaning: 'What every package includes' },
];

/** What reads naturally when a detail isn't known yet. */
export const FALLBACKS: Record<string, string> = {
    first_name: 'there',
    last_name: '',
    partner_name: 'your partner',
    event_date: 'your date',
    celebrating: 'celebration',
    location: 'the location we talked about',
    venue: 'your venue',
    package: 'your package',
    packages: '(add your packages in Settings)',
    extras: '(add your extras in Settings)',
    included_in_all: 'everything we talked about',
};

export interface FilledText {
    text: string;
    /** Details that weren't known, so a stand-in was used. */
    usedFallbacks: string[];
    /** Placeholders that aren't recognised and were left as typed. */
    unknown: string[];
}

export function fillTemplate(template: string, values: Readonly<Record<string, string>>): FilledText {
    const usedFallbacks: string[] = [];
    const unknown: string[] = [];
    const text = template.replace(/\{([a-z_]+)\}/g, (match, name: string) => {
        // Own properties only, so a placeholder like {constructor} can never reach into the object's internals.
        const value = Object.hasOwn(values, name) ? values[name] : undefined;
        if (typeof value === 'string' && value.trim() !== '') return value;
        if (Object.hasOwn(FALLBACKS, name)) {
            if (!usedFallbacks.includes(name)) usedFallbacks.push(name);
            return FALLBACKS[name]!;
        }
        if (!unknown.includes(name)) unknown.push(name);
        return match;
    });
    return { text, usedFallbacks, unknown };
}

/** ["wedding", "bachelorette weekend", "celebration"] becomes "wedding, bachelorette weekend and celebration". */
export function joinNaturally(items: readonly string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export interface PriceLine {
    name: string;
    priceCents: number;
    details: readonly string[];
}

/** The lines every package has in common (only when there are at least two packages to compare). */
export function commonLines(packages: readonly PriceLine[]): string[] {
    if (packages.length < 2) return [];
    const [first, ...rest] = packages;
    return first!.details.filter((line) => rest.every((other) => other.details.includes(line)));
}

export function describePackages(packages: readonly PriceLine[]): string {
    const common = new Set(commonLines(packages));
    return packages
        .map((entry) => {
            const own = entry.details.filter((line) => !common.has(line));
            return `${entry.name} (${formatCents(entry.priceCents)})${own.length ? `: ${own.join(', ')}` : ''}`;
        })
        .join('\n');
}

export function describeExtras(extras: readonly PriceLine[]): string {
    return extras.map((entry) => `${entry.name}: ${formatCents(entry.priceCents)}`).join('\n');
}

export interface TemplateLead {
    first_name: string;
    last_name: string;
    partner_name: string;
    event_date: string | null;
    end_date: string | null;
    celebrating: readonly string[];
    location: string;
    venue: string;
}

export function templateValues(input: {
    lead: TemplateLead;
    packages: readonly PriceLine[];
    extras: readonly PriceLine[];
    bookedPackage?: string;
}): Record<string, string> {
    const { lead } = input;
    const celebrating = lead.celebrating.filter((id) => id !== 'not-sure');
    return {
        first_name: lead.first_name,
        last_name: lead.last_name,
        partner_name: lead.partner_name,
        event_date: lead.event_date ? formatDate(lead.event_date) : '',
        celebrating: joinNaturally(celebratingLabels(celebrating).map((label) => label.toLowerCase())),
        location: lead.location,
        venue: lead.venue,
        package: input.bookedPackage ?? '',
        packages: describePackages(input.packages),
        extras: describeExtras(input.extras),
        included_in_all: joinNaturally(commonLines(input.packages).map((line) => line.replace(/^./, (letter) => letter.toLowerCase()))),
    };
}

/** A link that opens the message in the person's own email app. */
export function mailtoLink(to: string, subject: string, body: string): string {
    const encode = (value: string) => encodeURIComponent(value.replace(/\r?\n/g, '\r\n'));
    return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encode(subject)}&body=${encode(body)}`;
}

/** Long messages can be cut off by some email apps when opened from a link. */
export const MAILTO_SAFE_LENGTH = 1800;
