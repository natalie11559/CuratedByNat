// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getFile, hasSignedContract, listFiles, removeFile, restoreFile, saveFile } from '../../src/lib/studio/files.ts';
import { cleanFileName, contentDisposition, formatBytes, MAX_FILE_BYTES, sniffFileType } from '../../src/lib/studio/filetypes.ts';
import { createLead, listActivities } from '../../src/lib/studio/queries.ts';
import { validateLeadFields } from '../../src/lib/studio/validate.ts';
import { createTestD1 } from './helpers/d1-sqlite.ts';
import { FakeR2 } from './helpers/fake-r2.ts';

const NAT = 'hello@curatedbynat.com';
const at = (iso: string) => ({ actor: NAT, now: new Date(iso) });

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
};

const PDF = concat(ascii('%PDF-1.7\n'), ascii('rest of the file'));
const JPEG = concat(bytes(0xff, 0xd8, 0xff, 0xe0), ascii('JFIF rest'));
const PNG = concat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), ascii('rest'));
const HEIC = concat(bytes(0, 0, 0, 0x18), ascii('ftypheic'), bytes(0, 0, 0, 0), ascii('mif1heic'));
const toBuffer = (data: Uint8Array) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

describe('sniffFileType', () => {
    it('recognises PDFs, JPEGs, PNGs and HEIC pictures from their first bytes', () => {
        assert.deepEqual(sniffFileType(PDF), { contentType: 'application/pdf', extension: 'pdf', inline: true });
        assert.deepEqual(sniffFileType(JPEG), { contentType: 'image/jpeg', extension: 'jpg', inline: true });
        assert.deepEqual(sniffFileType(PNG), { contentType: 'image/png', extension: 'png', inline: true });
        assert.deepEqual(sniffFileType(HEIC), { contentType: 'image/heic', extension: 'heic', inline: false });
    });

    it('refuses everything else, whatever it is called', () => {
        for (const [label, data] of [
            ['html', ascii('<html><script>alert(1)</script>')],
            ['svg', ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
            ['zip', bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0)],
            ['exe', ascii('MZ\u0090\u0000\u0003')],
            ['gif', ascii('GIF89a......')],
            ['text pretending to be a pdf', ascii(' %PDF-1.4')],
            ['mp4', concat(bytes(0, 0, 0, 0x20), ascii('ftypisom'), bytes(0, 0, 0, 0))],
            ['empty', bytes()],
            ['short', bytes(0xff, 0xd8)],
        ] as const) {
            assert.equal(sniffFileType(data), null, label);
        }
    });
});

describe('file names and headers', () => {
    it('cleans names without losing the useful part', () => {
        assert.equal(cleanFileName('Smith Wedding Contract (signed).pdf', 'pdf'), 'Smith Wedding Contract (signed).pdf');
        assert.equal(cleanFileName('C:\\Users\\nat\\contract.pdf', 'pdf'), 'contract.pdf');
        assert.equal(cleanFileName('../../etc/passwd', 'pdf'), 'passwd');
        assert.equal(cleanFileName('a\u0000b\nc.png', 'png'), 'abc.png');
        assert.equal(cleanFileName('', 'jpg'), 'file.jpg');
        assert.equal(cleanFileName('..', 'jpg'), 'file.jpg');
        assert.equal(cleanFileName('x'.repeat(300) + '.pdf', 'pdf').length, 120);
    });

    it('builds a header that cannot be broken out of', () => {
        const header = contentDisposition('attachment', 'Zoë "the bride".pdf; evil=1\r\nX-Injected: yes');
        assert.ok(header.startsWith('attachment; filename="'));
        assert.equal(header.includes('\r'), false);
        assert.equal(header.includes('\n'), false);
        assert.match(header, /filename\*=UTF-8''/);
        assert.equal(/filename="[^"]*"[^;]*;/.test(header), true);
        assert.equal(header.split('"').length, 3); // exactly one quoted value
    });

    it('prints sizes in plain words', () => {
        assert.equal(formatBytes(512), '512 B');
        assert.equal(formatBytes(2048), '2 KB');
        assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
    });
});

describe('saving files', () => {
    async function setup() {
        const db = createTestD1();
        const bucket = new FakeR2();
        const lead = validateLeadFields({ first_name: 'Ava' });
        if (!lead.ok) throw new Error('bad lead');
        const leadId = ((await createLead(db, lead.value, at('2026-10-01T14:00:00Z'))) as { id: string }).id;
        return { db, bucket, leadId };
    }

    it('stores the bytes under a random key, indexes the file and records who added it', async () => {
        const { db, bucket, leadId } = await setup();
        const result = await saveFile(db, bucket, leadId, { bytes: toBuffer(PDF), originalName: 'Ava & Cole contract.pdf', kind: 'contract' }, at('2026-10-05T15:00:00Z'));
        assert.equal(result.ok, true);

        const [file] = await listFiles(db, leadId);
        assert.deepEqual(
            [file!.kind, file!.original_name, file!.content_type, file!.size_bytes, file!.actor_email],
            ['contract', 'Ava & Cole contract.pdf', 'application/pdf', PDF.length, NAT],
        );
        // The key says nothing about the client, and the object really is in the bucket.
        assert.match(file!.r2_key, /^files\/[0-9a-f-]{36}$/);
        assert.equal(file!.r2_key.toLowerCase().includes('ava'), false);
        assert.equal(bucket.objects.get(file!.r2_key)!.contentType, 'application/pdf');
        assert.equal(await hasSignedContract(db, leadId), true);

        const timeline = (await listActivities(db, leadId)).find((activity) => activity.type === 'file')!;
        assert.equal(timeline.body, `Added a signed contract (PDF, ${PDF.length} B).`);
        assert.equal(timeline.body.includes('Ava'), false); // no client names in the log
        const audit = db.raw.prepare("SELECT action, actor_email, summary FROM audit_log WHERE entity = 'file'").get() as { action: string; actor_email: string; summary: string };
        assert.deepEqual({ ...audit }, { action: 'upload', actor_email: NAT, summary: `signed contract, pdf, ${PDF.length} B` });
    });

    it('reads the real type from the bytes, not the name', async () => {
        const { db, bucket, leadId } = await setup();
        await saveFile(db, bucket, leadId, { bytes: toBuffer(JPEG), originalName: 'scan.pdf', kind: 'other' }, at('2026-10-05T15:00:00Z'));
        await saveFile(db, bucket, leadId, { bytes: toBuffer(HEIC), originalName: 'IMG_1.JPG', kind: 'other' }, at('2026-10-05T15:01:00Z'));
        const types = (await listFiles(db, leadId)).map((file) => file.content_type).sort();
        assert.deepEqual(types, ['image/heic', 'image/jpeg']);
    });

    it('refuses wrong types, empty files, oversized files, bad kinds and missing leads, storing nothing', async () => {
        const { db, bucket, leadId } = await setup();
        const attempt = (input: { bytes: ArrayBuffer; originalName: string; kind: string }, lead = leadId) =>
            saveFile(db, bucket, lead, input, at('2026-10-05T15:00:00Z'));
        assert.deepEqual(await attempt({ bytes: toBuffer(ascii('<script>alert(1)</script>')), originalName: 'x.pdf', kind: 'other' }), { ok: false, error: 'unsupported-type' });
        assert.deepEqual(await attempt({ bytes: new ArrayBuffer(0), originalName: 'x.pdf', kind: 'other' }), { ok: false, error: 'empty' });
        const big = new Uint8Array(MAX_FILE_BYTES + 1);
        big.set(PDF);
        assert.deepEqual(await attempt({ bytes: toBuffer(big), originalName: 'x.pdf', kind: 'other' }), { ok: false, error: 'too-large' });
        assert.deepEqual(await attempt({ bytes: toBuffer(PDF), originalName: 'x.pdf', kind: 'secret' }), { ok: false, error: 'invalid' });
        assert.deepEqual(await attempt({ bytes: toBuffer(PDF), originalName: 'x.pdf', kind: 'other' }, 'missing'), { ok: false, error: 'not-found' });
        assert.equal(bucket.objects.size, 0);
        assert.equal((await listFiles(db, leadId)).length, 0);
    });

    it('accepts a file of exactly the largest size', async () => {
        const { db, bucket, leadId } = await setup();
        const exact = new Uint8Array(MAX_FILE_BYTES);
        exact.set(PDF);
        assert.equal((await saveFile(db, bucket, leadId, { bytes: toBuffer(exact), originalName: 'big.pdf', kind: 'other' }, at('2026-10-05T15:00:00Z'))).ok, true);
    });

    it('does not leave a file in the bucket when the index cannot be written', async () => {
        const { db, bucket, leadId } = await setup();
        db.raw.exec('DROP TABLE files');
        await assert.rejects(saveFile(db, bucket, leadId, { bytes: toBuffer(PDF), originalName: 'x.pdf', kind: 'other' }, at('2026-10-05T15:00:00Z')));
        assert.equal(bucket.objects.size, 0);
    });

    it('hides a removed file, keeps its bytes, and can bring it back', async () => {
        const { db, bucket, leadId } = await setup();
        const saved = await saveFile(db, bucket, leadId, { bytes: toBuffer(PDF), originalName: 'c.pdf', kind: 'contract' }, at('2026-10-05T15:00:00Z'));
        const id = (saved as { id: string }).id;
        const key = (await getFile(db, id))!.r2_key;

        assert.deepEqual(await removeFile(db, id, at('2026-10-06T15:00:00Z')), { ok: true, id });
        assert.equal(await getFile(db, id), null);
        assert.equal(await hasSignedContract(db, leadId), false);
        assert.equal(bucket.objects.has(key), true); // never deleted automatically
        assert.deepEqual(await removeFile(db, id, at('2026-10-06T15:00:00Z')), { ok: false, error: 'not-found' });

        assert.deepEqual(await restoreFile(db, id, at('2026-10-07T15:00:00Z')), { ok: true, id });
        assert.equal(await hasSignedContract(db, leadId), true);
        const actions = db.raw.prepare("SELECT action FROM audit_log WHERE entity = 'file' ORDER BY rowid").all().map((row) => (row as { action: string }).action);
        assert.deepEqual(actions, ['upload', 'delete', 'restore']);
    });

    it('lists the signed contract first', async () => {
        const { db, bucket, leadId } = await setup();
        await saveFile(db, bucket, leadId, { bytes: toBuffer(JPEG), originalName: 'inspo.jpg', kind: 'other' }, at('2026-10-05T15:00:00Z'));
        await saveFile(db, bucket, leadId, { bytes: toBuffer(PDF), originalName: 'contract.pdf', kind: 'contract' }, at('2026-10-04T15:00:00Z'));
        assert.deepEqual((await listFiles(db, leadId)).map((file) => file.kind), ['contract', 'other']);
    });
});
