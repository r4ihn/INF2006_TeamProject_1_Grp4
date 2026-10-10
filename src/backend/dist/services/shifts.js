import { HttpError } from '../http/errors.js';
import { addDays, dateInTimeZone, dbDate, localTimeToInstant, timeInTimeZone, } from '../lib/dates.js';
/** Normal weekly working hours under Singapore's Employment Act; the roster flags more. */
export const WEEKLY_HOURS_LIMIT = 44;
/** Café-local date and times → the shift's real start and end. "24:00" ends at midnight. */
export function shiftBounds(date, start, end, timeZone) {
    const startsAt = localTimeToInstant(`${date} ${start}`, timeZone);
    const endsAt = end === '24:00'
        ? localTimeToInstant(`${addDays(date, 1)} 00:00`, timeZone)
        : localTimeToInstant(`${date} ${end}`, timeZone);
    if (!startsAt || !endsAt)
        throw new Error(`Invalid shift time ${date} ${start}–${end}`);
    return { startsAt, endsAt };
}
/** A shift's café-local date and times, the reverse of shiftBounds. */
export function localParts(startsAt, endsAt, timeZone) {
    const date = dateInTimeZone(startsAt, timeZone);
    let end = timeInTimeZone(endsAt, timeZone);
    if (end === '00:00' && dateInTimeZone(endsAt, timeZone) !== date)
        end = '24:00';
    return { date, start: timeInTimeZone(startsAt, timeZone), end };
}
export const hoursBetween = (startsAt, endsAt) => Math.round(((endsAt.getTime() - startsAt.getTime()) / 3_600_000) * 100) / 100;
/** What people are called on the roster: their name, or the start of their email. */
export function personName(u) {
    return u.displayName?.trim() || u.email.split('@')[0];
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-06" → "Tue 6 Oct" (fixed names: Node's locale data may say "Sept") */
export function dayLabel(date) {
    const d = dbDate(date);
    return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export const shiftInclude = {
    user: { select: { id: true, displayName: true, email: true, onRoster: true } },
};
export function shiftDto(row, timeZone) {
    return {
        id: row.id,
        ...localParts(row.startsAt, row.endsAt, timeZone),
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        hours: hoursBetween(row.startsAt, row.endsAt),
        position: row.position,
        note: row.note,
        /** null = open shift */
        assignee: row.user
            ? { id: row.user.id, name: personName(row.user), onRoster: row.user.onRoster }
            : null,
    };
}
const notOnTeam = () => new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
    userId: 'Choose someone on your team, or leave the shift open',
});
/**
 * Locks the people about to be booked (in a fixed order, so two requests can't deadlock)
 * and checks each is on this café's roster. Returns their names by id.
 */
export async function lockAssignees(tx, orgId, userIds) {
    const names = new Map();
    for (const id of [...new Set(userIds)].sort()) {
        const [row] = await tx.$queryRaw `SELECT id, display_name, email, on_roster
        FROM users
       WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid
         FOR UPDATE`;
        if (!row || !row.on_roster)
            throw notOnTeam();
        names.set(id, personName({ displayName: row.display_name, email: row.email }));
    }
    return names;
}
/** Another shift of this person's that overlaps [startsAt, endsAt), if any. */
export function findClash(tx, orgId, userId, startsAt, endsAt, excludeId) {
    return tx.shift.findFirst({
        where: {
            orgId,
            userId,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        orderBy: { startsAt: 'asc' },
    });
}
export function clashMessage(name, clash, timeZone) {
    const p = localParts(clash.startsAt, clash.endsAt, timeZone);
    return `${name} is already working ${p.start}–${p.end} on ${dayLabel(p.date)}.`;
}
export const clashError = (message) => new HttpError(409, 'SHIFT_CLASH', message, { userId: message });
//# sourceMappingURL=shifts.js.map