// Everything Nat can do to one lead: edit details, move it through the pipeline, log a call or note, set a
// follow-up date, mark it lost or reopen it, and delete or restore it. Forms post here and are sent back to a
// Studio page with a short banner code.
import type { APIRoute } from 'astro';
import { isId } from '../../../../../lib/studio/messages';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import {
    changeStage,
    getSettings,
    logActivity,
    markLost,
    reopenLead,
    restoreLead,
    setFollowUp,
    softDeleteLead,
    updateLead,
    type WriteResult,
} from '../../../../../lib/studio/queries';
import { actorEmail, formInput, redirectTo, safeStudioPath, studioDb } from '../../../../../lib/studio/server';
import { str, validateFollowUpDate, validateLeadFields } from '../../../../../lib/studio/validate';

export const prerender = false;

const MAX_BODY_BYTES = 64 * 1024;
const LOGGABLE = ['call', 'text', 'email', 'dm', 'meeting', 'note'];

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return json(413, { ok: false, error: 'That is too big.' });

    const id = params.id ?? '';
    if (!isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });

    const raw = formInput(await request.formData());
    const actor = actorEmail(locals);
    const leadPage = `/studio/leads/${id}`;
    const back = safeStudioPath(str(raw, 'return_to'), leadPage);

    /** Turns a result into the right redirect; `notice` is the banner for success. */
    const finish = (result: WriteResult, notice: string, to = back): Response =>
        result.ok
            ? redirectTo(to, { notice })
            : redirectTo(to === back ? back : leadPage, { error: result.error, lead: result.error === 'duplicate-email' ? result.conflictLeadId : undefined });

    switch (params.action) {
        case 'update': {
            const checked = validateLeadFields(raw);
            if (!checked.ok) return redirectTo(leadPage, { invalid: Object.keys(checked.errors).join(',') });
            return finish(await updateLead(db, id, checked.value, { actor }), 'saved', leadPage);
        }
        case 'stage':
            return finish(await changeStage(db, id, str(raw, 'stage'), { actor }), 'moved');
        case 'lost': {
            const reason = str(raw, 'reason');
            const { lostReasons } = await getSettings(db);
            if (!reason || !lostReasons.includes(reason)) return redirectTo(leadPage, { error: 'reason-needed' });
            return finish(await markLost(db, id, reason, { actor }), 'lost', leadPage);
        }
        case 'reopen':
            return finish(await reopenLead(db, id, { actor }), 'reopened', leadPage);
        case 'log': {
            const type = str(raw, 'type');
            if (!LOGGABLE.includes(type)) return redirectTo(leadPage, { error: 'invalid' });
            return finish(await logActivity(db, id, { type, body: str(raw, 'body') }, { actor }), type === 'note' ? 'note-added' : 'contact-logged', leadPage);
        }
        case 'followup': {
            // The Clear button sends clear=1 and no date.
            const checked = validateFollowUpDate(str(raw, 'clear') === '1' ? { next_follow_up_at: '' } : raw);
            if (!checked.ok) return redirectTo(leadPage, { invalid: 'next_follow_up_at' });
            return finish(await setFollowUp(db, id, checked.value, { actor }), checked.value ? 'followup-set' : 'followup-cleared', leadPage);
        }
        case 'delete': {
            const result = await softDeleteLead(db, id, { actor });
            return result.ok ? redirectTo('/studio/pipeline', { notice: 'deleted' }) : redirectTo('/studio/pipeline', { error: result.error });
        }
        case 'restore':
            return finish(await restoreLead(db, id, { actor }), 'restored', leadPage);
        default:
            return json(404, { ok: false, error: 'Not found.' });
    }
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the buttons in Studio.' });
