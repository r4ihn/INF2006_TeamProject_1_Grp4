import { Router } from 'express';
import { authOf, requireRole } from '../auth/authenticate.js';
import { HttpError, notFound } from '../http/errors.js';
import { orgIdOf } from '../http/org-context.js';
import { byName, parseId } from '../http/params.js';
import { addDays, daysBetween, dateInTimeZone, localTimeToInstant, mondayOf, } from '../lib/dates.js';
import { clashError, clashMessage, findClash, localParts, lockAssignees, personName, shiftBounds, shiftDto, shiftInclude, WEEKLY_HOURS_LIMIT, } from '../services/shifts.js';
import { copyWeekSchema, createShiftSchema, listShiftsQuerySchema, shiftTimeErrors, updateShiftSchema, } from '../validation/shifts.js';
/** Shifts can be planned (or recorded) up to a year either side of today. */
const MAX_DAYS_AWAY = 366;
const TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 };
const invalid = (fields) => new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', fields);
/**
 * Staff scheduling.
 *   GET    /api/shifts              everyone — managers see the whole roster, staff only their own shifts
 *   POST   /api/shifts              managers — add a shift (userId null = open shift)
 *   PATCH  /api/shifts/:id          managers
 *   DELETE /api/shifts/:id          managers
 *   POST   /api/shifts/copy-week    managers — copy a week's shifts into the following week
 */
export function shiftsRouter(prisma) {
    const router = Router();
    const managersOnly = requireRole('MANAGER');
    const timezoneOf = async (orgId) => (await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { timezone: true },
    })).timezone;
    const checkDateWindow = (date, timeZone) => {
        const away = Math.abs(daysBetween(dateInTimeZone(new Date(), timeZone), date));
        if (away > MAX_DAYS_AWAY)
            throw invalid({ date: 'Choose a date within a year of today' });
    };
    // GET /api/shifts?from=2026-10-05&days=7[&mine=true]
    router.get('/', async (req, res) => {
        const auth = authOf(req);
        const orgId = orgIdOf(req);
        const q = listShiftsQuerySchema.parse(req.query);
        const timeZone = await timezoneOf(orgId);
        const from = q.from ?? mondayOf(dateInTimeZone(new Date(), timeZone));
        const until = addDays(from, q.days); // exclusive
        // Staff only ever see their own shifts — never colleagues' or open ones.
        const ownOnly = auth.role === 'STAFF' || q.mine;
        const rows = ownOnly && !auth.userId
            ? []
            : await prisma.shift.findMany({
                where: {
                    orgId,
                    startsAt: {
                        gte: localTimeToInstant(`${from} 00:00`, timeZone),
                        lt: localTimeToInstant(`${until} 00:00`, timeZone),
                    },
                    ...(ownOnly ? { userId: auth.userId } : {}),
                },
                include: shiftInclude,
                orderBy: [{ startsAt: 'asc' }, { endsAt: 'asc' }, { position: 'asc' }],
            });
        const shifts = rows.map((r) => shiftDto(r, timeZone));
        // Hours per person over the period: everyone on the roster (even with no shifts, so the
        // manager sees who is free), plus anyone removed from it who still has shifts here.
        let people = [];
        if (!ownOnly) {
            const team = await prisma.user.findMany({
                where: { orgId, onRoster: true },
                select: { id: true, displayName: true, email: true, onRoster: true },
            });
            const byId = new Map(team.map((u) => [
                u.id,
                { userId: u.id, name: personName(u), onRoster: u.onRoster, shifts: 0, hours: 0 },
            ]));
            for (const s of shifts) {
                if (!s.assignee)
                    continue;
                const p = byId.get(s.assignee.id) ?? {
                    userId: s.assignee.id,
                    name: s.assignee.name,
                    onRoster: s.assignee.onRoster,
                    shifts: 0,
                    hours: 0,
                };
                p.shifts += 1;
                p.hours = Math.round((p.hours + s.hours) * 100) / 100;
                byId.set(p.userId, p);
            }
            people = [...byId.values()].sort((a, b) => byName.compare(a.name, b.name));
        }
        const totalHours = Math.round(shifts.reduce((sum, s) => sum + s.hours, 0) * 100) / 100;
        res.json({
            from,
            to: addDays(from, q.days - 1),
            days: q.days,
            timezone: timeZone,
            weeklyHoursLimit: WEEKLY_HOURS_LIMIT,
            totals: {
                shifts: shifts.length,
                hours: totalHours,
                open: shifts.filter((s) => !s.assignee).length,
            },
            shifts,
            people,
        });
    });
    // POST /api/shifts
    router.post('/', managersOnly, async (req, res) => {
        const auth = authOf(req);
        const orgId = orgIdOf(req);
        const data = createShiftSchema.parse(req.body);
        const timeErrors = shiftTimeErrors(data.start, data.end);
        if (timeErrors)
            throw invalid(timeErrors);
        const timeZone = await timezoneOf(orgId);
        checkDateWindow(data.date, timeZone);
        const { startsAt, endsAt } = shiftBounds(data.date, data.start, data.end, timeZone);
        const userId = data.userId ?? null;
        const row = await prisma.$transaction(async (tx) => {
            if (userId) {
                const names = await lockAssignees(tx, orgId, [userId]);
                const clash = await findClash(tx, orgId, userId, startsAt, endsAt);
                if (clash)
                    throw clashError(clashMessage(names.get(userId), clash, timeZone));
            }
            return tx.shift.create({
                data: {
                    orgId,
                    userId,
                    startsAt,
                    endsAt,
                    position: data.position,
                    note: data.note ?? null,
                    createdById: auth.userId,
                },
                include: shiftInclude,
            });
        }, TX_OPTIONS);
        res.status(201).location(`/api/shifts/${row.id}`).json(shiftDto(row, timeZone));
    });
    // POST /api/shifts/copy-week { from } — the week containing `from` → the week after it
    router.post('/copy-week', managersOnly, async (req, res) => {
        const auth = authOf(req);
        const orgId = orgIdOf(req);
        const { from } = copyWeekSchema.parse(req.body);
        const timeZone = await timezoneOf(orgId);
        const sourceMonday = mondayOf(from);
        const targetMonday = addDays(sourceMonday, 7);
        checkDateWindow(targetMonday, timeZone);
        const result = await prisma.$transaction(async (tx) => {
            const source = await tx.shift.findMany({
                where: {
                    orgId,
                    startsAt: {
                        gte: localTimeToInstant(`${sourceMonday} 00:00`, timeZone),
                        lt: localTimeToInstant(`${targetMonday} 00:00`, timeZone),
                    },
                },
                include: shiftInclude,
                orderBy: { startsAt: 'asc' },
            });
            // Lock everyone still on the roster before checking any of their shifts
            const stillOnTeam = source
                .filter((s) => s.user?.onRoster)
                .map((s) => s.userId)
                .filter(Boolean);
            const names = await lockAssignees(tx, orgId, stillOnTeam);
            const existing = await tx.shift.findMany({
                where: {
                    orgId,
                    startsAt: {
                        gte: localTimeToInstant(`${targetMonday} 00:00`, timeZone),
                        lt: localTimeToInstant(`${addDays(targetMonday, 7)} 00:00`, timeZone),
                    },
                },
            });
            let copied = 0;
            let opened = 0;
            const skipped = [];
            for (const s of source) {
                const p = localParts(s.startsAt, s.endsAt, timeZone);
                const date = addDays(p.date, 7);
                const { startsAt, endsAt } = shiftBounds(date, p.start, p.end, timeZone);
                // Removed from the roster since: the slot is still needed, so it becomes an open shift
                const userId = s.userId && names.has(s.userId) ? s.userId : null;
                const name = s.user ? personName(s.user) : 'Open shift';
                const duplicate = existing.some((e) => e.startsAt.getTime() === startsAt.getTime() &&
                    e.endsAt.getTime() === endsAt.getTime() &&
                    e.position === s.position &&
                    e.userId === userId);
                if (duplicate) {
                    skipped.push({ date, start: p.start, end: p.end, name, reason: 'Already on the roster' });
                    continue;
                }
                if (userId) {
                    const clash = await findClash(tx, orgId, userId, startsAt, endsAt);
                    if (clash) {
                        skipped.push({
                            date,
                            start: p.start,
                            end: p.end,
                            name,
                            reason: clashMessage(names.get(userId), clash, timeZone),
                        });
                        continue;
                    }
                }
                const created = await tx.shift.create({
                    data: {
                        orgId,
                        userId,
                        startsAt,
                        endsAt,
                        position: s.position,
                        note: s.note,
                        createdById: auth.userId,
                    },
                });
                existing.push(created);
                copied += 1;
                if (s.userId && !userId)
                    opened += 1;
            }
            return { copied, opened, skipped, sourceCount: source.length };
        }, TX_OPTIONS);
        res.json({ from: sourceMonday, to: targetMonday, ...result });
    });
    // PATCH /api/shifts/:id — only the fields sent change
    router.patch('/:id', managersOnly, async (req, res) => {
        const id = parseId(req, 'Shift');
        const orgId = orgIdOf(req);
        const data = updateShiftSchema.parse(req.body);
        const timeZone = await timezoneOf(orgId);
        const row = await prisma.$transaction(async (tx) => {
            const current = await tx.shift.findFirst({ where: { id, orgId } });
            if (!current)
                throw notFound('Shift');
            const was = localParts(current.startsAt, current.endsAt, timeZone);
            const date = data.date ?? was.date;
            const start = data.start ?? was.start;
            const end = data.end ?? was.end;
            const timeErrors = shiftTimeErrors(start, end);
            if (timeErrors)
                throw invalid(timeErrors);
            if (data.date)
                checkDateWindow(date, timeZone);
            const { startsAt, endsAt } = shiftBounds(date, start, end, timeZone);
            const userId = data.userId !== undefined ? data.userId : current.userId;
            if (userId) {
                const names = await lockAssignees(tx, orgId, [userId]);
                const clash = await findClash(tx, orgId, userId, startsAt, endsAt, id);
                if (clash)
                    throw clashError(clashMessage(names.get(userId), clash, timeZone));
            }
            return tx.shift.update({
                where: { id_orgId: { id, orgId } },
                data: {
                    startsAt,
                    endsAt,
                    userId,
                    ...(data.position !== undefined ? { position: data.position } : {}),
                    ...(data.note !== undefined ? { note: data.note } : {}),
                },
                include: shiftInclude,
            });
        }, TX_OPTIONS);
        res.json(shiftDto(row, timeZone));
    });
    // DELETE /api/shifts/:id
    router.delete('/:id', managersOnly, async (req, res) => {
        const id = parseId(req, 'Shift');
        const orgId = orgIdOf(req);
        const { count } = await prisma.shift.deleteMany({ where: { id, orgId } });
        if (count === 0)
            throw notFound('Shift');
        res.status(204).end();
    });
    return router;
}
//# sourceMappingURL=shifts.js.map