import { expect, type Page } from '@playwright/test';

export const easternToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
export const unique = (label: string) => `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export interface NewLead {
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    eventDate?: string;
}

/** Adds a lead through the form, the way Nat would, and lands on its page. */
export async function addLead(page: Page, lead: NewLead) {
    await page.goto('/studio/leads/new');
    await page.getByLabel('First name').fill(lead.firstName);
    if (lead.lastName) await page.getByLabel('Last name').fill(lead.lastName);
    if (lead.email) await page.getByLabel('Email').fill(lead.email);
    if (lead.phone) await page.getByLabel('Phone').fill(lead.phone);
    await page.getByLabel('Where did they come from?').selectOption('instagram');
    await page.getByRole('checkbox', { name: 'Wedding' }).check();
    await page.getByLabel('Event date').fill(lead.eventDate ?? '2027-05-15');
    await page.getByRole('button', { name: 'Add lead' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(lead.firstName);
    await expect(page.getByRole('status')).toHaveText('Lead added.');
}
