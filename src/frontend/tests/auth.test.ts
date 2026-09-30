import { describe, expect, it } from 'vitest'
import { loadSession, parseToken, saveSession } from '../src/auth.ts'
import { makeToken } from './helpers.ts'

describe('parseToken', () => {
  it('reads username and role from the claims', () => {
    expect(parseToken(makeToken('manager'))).toMatchObject({ username: 'test-manager', role: 'manager' })
    expect(parseToken(`  ${makeToken('staff')}\n`)).toMatchObject({ role: 'staff' })
  })

  it('prefers manager when both groups are present', () => {
    const token = makeToken('staff', { 'cognito:groups': ['staff', 'manager'] })
    expect(parseToken(token)?.role).toBe('manager')
  })

  it.each([
    ['garbage', 'not-a-token'],
    ['two parts', 'a.b'],
    ['bad payload', 'a.!!!.c'],
    ['no role', makeToken('staff', { 'cognito:groups': [] })],
    ['unknown role', makeToken('staff', { 'cognito:groups': ['guest'] })],
    ['expired', makeToken('staff', { exp: Math.floor(Date.now() / 1000) - 10 })],
  ])('rejects %s', (_name, token) => {
    expect(parseToken(token)).toBeNull()
  })
})

describe('session storage', () => {
  it('keeps a valid token for the tab and ignores invalid ones', () => {
    expect(saveSession('nope')).toBeNull()
    expect(loadSession()).toBeNull()
    saveSession(makeToken('staff'))
    expect(loadSession()?.username).toBe('test-staff')
  })
})
