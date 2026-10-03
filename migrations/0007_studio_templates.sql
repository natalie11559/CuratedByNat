-- Studio part 5: saved reply templates. Studio never sends email itself: a template is filled with the client's
-- details and opens in Nat's own email app (or is copied). The four starters are drafts for Nat to edit in her own
-- voice. They contain no prices: {packages} and {extras} are filled in from the private price lists when used.

CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_draft INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO templates (id, name, subject, body, sort_order, is_draft, created_at, updated_at) VALUES
('00000000-0000-4000-8000-000000000001', 'Thanks for inquiring', 'Thanks for reaching out, {first_name}!',
'Hi {first_name}!

Thank you so much for reaching out about your {celebrating}. I''m so excited you found me!

I''d love to hear more about what you have in mind. Is there a good time this week for a quick call, or would you rather chat over text? Tell me what you''re celebrating and I''ll take it from there.

Talk soon,
Nat
Curated by Nat', 10, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),

('00000000-0000-4000-8000-000000000002', 'Packages and availability', 'Packages and availability for {event_date}',
'Hi {first_name}!

Good news: I''m checking my calendar for {event_date} and wanted to get my packages in front of you so you can see what feels right for your {celebrating}.

{packages}

Extras you can add:
{extras}

Every package includes: {included_in_all}.

Travel fees may apply for locations outside my local service area.

Want to hop on a quick call to talk it through? I''d love to hear what you''re picturing.

Nat
Curated by Nat', 20, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),

('00000000-0000-4000-8000-000000000003', 'Following up', 'Checking in, {first_name}',
'Hi {first_name}!

Just popping back in to see if you had any questions about my packages or what I''d capture for your {celebrating}. No pressure at all, I just want to make sure you have everything you need.

If {event_date} is still the plan, I''d love to hold it for you. Let me know and we can set up a quick chat!

Nat
Curated by Nat', 30, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),

('00000000-0000-4000-8000-000000000004', 'Booking confirmed', 'You''re booked, {first_name}!',
'Hi {first_name}!

Yay, you''re officially on my calendar for {event_date}! I''m so happy to be part of your {celebrating}.

I have your celebration down for {location}. If anything changes, just tell me!

Here''s what happens next:
1. Your signed contract and retainer hold your date.
2. A few weeks before, we''ll chat about the moments that matter most to you.
3. Within 24 hours of your celebration, you''ll get your content, plus all of your raw footage.

If you have any questions at all, just text or email me.

Nat
Curated by Nat', 40, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
