// Files kept with a lead (the signed contract above all). The bytes go to a private R2 bucket under a random key;
// the database row is the index. Tested against real SQLite and a fake bucket.
import type { D1Database, R2Bucket } from '../cloudflare.ts';
import { cleanFileName, MAX_FILE_BYTES, sniffFileType, formatBytes } from './filetypes.ts';
import { auditStatement, getLead } from './queries.ts';

export type FileKind = 'contract' | 'other';

export interface FileRow {
    id: string;
    lead_id: string;
    kind: FileKind;
    r2_key: string;
    original_name: string;
    content_type: string;
    size_bytes: number;
    uploaded_at: string;
    actor_email: string;
}

export type FileResult =
    | { ok: true; id: string }
    | { ok: false; error: 'not-found' | 'unsupported-type' | 'too-large' | 'empty' | 'invalid' };

export async function listFiles(db: D1Database, leadId: string): Promise<FileRow[]> {
    const { results } = await db
        .prepare(
            `SELECT id, lead_id, kind, r2_key, original_name, content_type, size_bytes, uploaded_at, actor_email
             FROM files WHERE lead_id = ?1 AND deleted_at IS NULL ORDER BY kind = 'contract' DESC, uploaded_at DESC`,
        )
        .bind(leadId)
        .all<FileRow>();
    return results;
}

export async function getFile(db: D1Database, id: string): Promise<FileRow | null> {
    return db
        .prepare(
            `SELECT id, lead_id, kind, r2_key, original_name, content_type, size_bytes, uploaded_at, actor_email
             FROM files WHERE id = ?1 AND deleted_at IS NULL`,
        )
        .bind(id)
        .first<FileRow>();
}

export async function hasSignedContract(db: D1Database, leadId: string): Promise<boolean> {
    const row = await db.prepare("SELECT 1 AS found FROM files WHERE lead_id = ?1 AND kind = 'contract' AND deleted_at IS NULL LIMIT 1").bind(leadId).first();
    return row !== null;
}

/** Saves an upload. The type is read from the bytes; a file that is not a PDF or a picture is refused. */
export async function saveFile(
    db: D1Database,
    bucket: R2Bucket,
    leadId: string,
    input: { bytes: ArrayBuffer; originalName: string; kind: string },
    context: { actor: string; now?: Date },
): Promise<FileResult> {
    const now = context.now ?? new Date();
    if (!(await getLead(db, leadId))) return { ok: false, error: 'not-found' };
    if (input.kind !== 'contract' && input.kind !== 'other') return { ok: false, error: 'invalid' };
    if (input.bytes.byteLength === 0) return { ok: false, error: 'empty' };
    if (input.bytes.byteLength > MAX_FILE_BYTES) return { ok: false, error: 'too-large' };

    const type = sniffFileType(new Uint8Array(input.bytes, 0, Math.min(input.bytes.byteLength, 32)));
    if (!type) return { ok: false, error: 'unsupported-type' };

    const id = crypto.randomUUID();
    const key = `files/${crypto.randomUUID()}`;
    const name = cleanFileName(input.originalName, type.extension);
    const label = input.kind === 'contract' ? 'signed contract' : 'file';

    await bucket.put(key, input.bytes, { httpMetadata: { contentType: type.contentType } });
    try {
        await db.batch([
            db
                .prepare('INSERT INTO files (id, lead_id, kind, r2_key, original_name, content_type, size_bytes, uploaded_at, actor_email) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
                .bind(id, leadId, input.kind, key, name, type.contentType, input.bytes.byteLength, now.toISOString(), context.actor),
            db
                .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
                .bind(crypto.randomUUID(), leadId, 'file', `Added a ${label} (${type.extension.toUpperCase()}, ${formatBytes(input.bytes.byteLength)}).`, now.toISOString(), context.actor),
            auditStatement(db, { actor: context.actor, action: 'upload', entity: 'file', entityId: id, summary: `${label}, ${type.extension}, ${formatBytes(input.bytes.byteLength)}`, now }),
            db.prepare('UPDATE leads SET updated_at = ?2 WHERE id = ?1').bind(leadId, now.toISOString()),
        ]);
    } catch (error) {
        // Don't leave an orphan in the bucket if the index could not be written.
        await bucket.delete(key).catch(() => undefined);
        throw error;
    }
    return { ok: true, id };
}

/** Hides a file. The bytes stay in the bucket, so it can be restored; nothing deletes a contract by itself. */
export async function removeFile(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<FileResult> {
    const now = context.now ?? new Date();
    const file = await getFile(db, id);
    if (!file) return { ok: false, error: 'not-found' };
    const label = file.kind === 'contract' ? 'signed contract' : 'file';
    await db.batch([
        db.prepare('UPDATE files SET deleted_at = ?2 WHERE id = ?1').bind(id, now.toISOString()),
        db
            .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
            .bind(crypto.randomUUID(), file.lead_id, 'file', `Removed a ${label}.`, now.toISOString(), context.actor),
        auditStatement(db, { actor: context.actor, action: 'delete', entity: 'file', entityId: id, summary: label, now }),
    ]);
    return { ok: true, id };
}

export async function restoreFile(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<FileResult> {
    const now = context.now ?? new Date();
    const file = await db.prepare('SELECT id, lead_id, kind FROM files WHERE id = ?1 AND deleted_at IS NOT NULL').bind(id).first<{ id: string; lead_id: string; kind: string }>();
    if (!file) return { ok: false, error: 'not-found' };
    await db.batch([
        db.prepare('UPDATE files SET deleted_at = NULL WHERE id = ?1').bind(id),
        db
            .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
            .bind(crypto.randomUUID(), file.lead_id, 'file', 'Restored a file.', now.toISOString(), context.actor),
        auditStatement(db, { actor: context.actor, action: 'restore', entity: 'file', entityId: id, now }),
    ]);
    return { ok: true, id };
}
