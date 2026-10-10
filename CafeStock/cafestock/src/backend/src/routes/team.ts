import { Router } from 'express';
import type { PrismaClient } from '../db/client.js';
import { authOf, requireRole } from '../auth/authenticate.js';
import { PG, pgErrorCode } from '../db/errors.js';
import { HttpError, notFound } from '../http/errors.js';
import { orgIdOf } from '../http/org-context.js';
import { byName, parseId } from '../http/params.js';
import { personName } from '../services/shifts.js';
import {
  addTeamMemberSchema,
  listTeamQuerySchema,
  updateTeamMemberSchema,
} from '../validation/shifts.js';

const memberSelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  cognitoSub: true,
  onRoster: true,
} as const;

type MemberRow = {
  id: string;
  email: string;
  displayName: string | null;
  role: 'STAFF' | 'MANAGER';
  cognitoSub: string | null;
  onRoster: boolean;
};

function memberDto(u: MemberRow, me: string | null) {
  return {
    id: u.id,
    name: personName(u),
    email: u.email,
    role: u.role,
    /** Has signed in at least once (their Cognito account is linked) */
    signedIn: u.cognitoSub !== null,
    onRoster: u.onRoster,
    isYou: u.id === me,
  };
}

const ALREADY_ON_TEAM = () =>
  new HttpError(409, 'CONFLICT', 'This person is already on your team', {
    email: 'Someone with this email is already on your team',
  });

/**
 * The café's team, for the roster (managers only).
 *   GET   /api/team[?all=true]   people on the roster (all=true: also people removed from it)
 *   POST  /api/team              add someone by name and email, before or after their first sign-in
 *   PATCH /api/team/:id          rename, or remove from / return to the roster
 *
 * Adding someone here doesn't create a sign-in account: the admin creates that in Cognito
 * with the same email, and the first sign-in links the two (src/auth/authenticate.ts).
 */
export function teamRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireRole('MANAGER'));

  router.get('/', async (req, res) => {
    const auth = authOf(req);
    const { all } = listTeamQuerySchema.parse(req.query);
    const rows = await prisma.user.findMany({
      where: { orgId: orgIdOf(req), ...(all ? {} : { onRoster: true }) },
      select: memberSelect,
    });
    const members = rows.map((u) => memberDto(u, auth.userId));
    members.sort((a, b) => byName.compare(a.name, b.name));
    res.json(members);
  });

  router.post('/', async (req, res) => {
    const auth = authOf(req);
    const orgId = orgIdOf(req);
    const { name, email } = addTeamMemberSchema.parse(req.body);

    const existing = await prisma.user.findUnique({
      where: { orgId_email: { orgId, email } },
      select: memberSelect,
    });
    if (existing?.onRoster) throw ALREADY_ON_TEAM();
    if (existing) {
      // Removed earlier and coming back: same person, same history.
      const back = await prisma.user.update({
        where: { id: existing.id },
        data: { onRoster: true, ...(existing.cognitoSub ? {} : { displayName: name }) },
        select: memberSelect,
      });
      return res.json(memberDto(back, auth.userId));
    }
    try {
      const row = await prisma.user.create({
        data: { orgId, email, displayName: name, role: 'STAFF' },
        select: memberSelect,
      });
      res.status(201).json(memberDto(row, auth.userId));
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) throw ALREADY_ON_TEAM();
      throw err;
    }
  });

  router.patch('/:id', async (req, res) => {
    const auth = authOf(req);
    const id = parseId(req, 'Team member');
    const orgId = orgIdOf(req);
    const data = updateTeamMemberSchema.parse(req.body);

    const result = await prisma.$transaction(
      async (tx) => {
        // Lock the person so nobody can book them while they're being removed.
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`;
        if (!locked) throw notFound('Team member');
        const member = await tx.user.update({
          where: { id },
          data: {
            ...(data.name !== undefined ? { displayName: data.name } : {}),
            ...(data.onRoster !== undefined ? { onRoster: data.onRoster } : {}),
          },
          select: memberSelect,
        });
        // Their upcoming shifts still need covering: they become open shifts.
        let openedShifts = 0;
        if (data.onRoster === false) {
          ({ count: openedShifts } = await tx.shift.updateMany({
            where: { orgId, userId: id, startsAt: { gte: new Date() } },
            data: { userId: null },
          }));
        }
        return { member, openedShifts };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
    res.json({ ...memberDto(result.member, auth.userId), openedShifts: result.openedShifts });
  });

  return router;
}
