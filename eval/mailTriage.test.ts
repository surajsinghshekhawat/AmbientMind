import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldSkip } from '../shared/mailTriage'

const body = 'Could you send me the signed contract by Friday? Thanks, Priya'
const mail = { sender: 'Priya <priya@acme.com>', subject: 'Contract', body }
const from = (headers: Record<string, string>) => ({ headers: Object.entries(headers).map(([name, value]) => ({ name, value })) })

test('a direct request from a person is read', () => {
  assert.equal(shouldSkip({ ...mail, labels: ['INBOX', 'CATEGORY_PERSONAL'] }, from({})), null)
  assert.equal(shouldSkip(mail, undefined), null)
})

test('bulk headers, bulk senders and size are skipped before any model', () => {
  assert.equal(shouldSkip(mail, from({ 'List-Unsubscribe': '<mailto:x>' })), 'bulk: List-Unsubscribe')
  assert.equal(shouldSkip(mail, from({ Precedence: 'bulk' })), 'bulk: Precedence')
  assert.equal(shouldSkip(mail, from({ 'Auto-Submitted': 'auto-replied' })), 'bulk: Auto-Submitted')
  assert.equal(shouldSkip({ ...mail, sender: 'no-reply@shop.com' }, undefined), 'bulk: sender address')
  assert.equal(shouldSkip({ ...mail, body: 'ok' }, undefined), 'too short to contain a task')
})

test("a helpdesk agent's reply is read; its receipt and out-of-office answers are not", () => {
  const zendesk = from({ 'Auto-Submitted': 'auto-generated' })
  const reply = { ...mail, sender: 'Acme <support@acme.example>', subject: '[Acme] Re: Acme Android Support: Sync Failed' }
  assert.equal(shouldSkip(reply, zendesk), null)
  assert.equal(shouldSkip({ ...reply, subject: 'Re: Sync Failed' }, zendesk), null)
  assert.equal(shouldSkip({ ...reply, subject: 'Support request received' }, zendesk), 'bulk: Auto-Submitted')
  assert.equal(shouldSkip({ ...reply, subject: 'Re: Contract' }, from({ 'Auto-Submitted': 'auto-replied' })), 'bulk: Auto-Submitted')
})

test("Gmail's Promotions tab is marketing, headers or not", () => {
  const invite = { sender: 'Events <events@example.com>', subject: 'Season 11', body: 'Register now for Season 11 and showcase your skills before 15 November!' }
  assert.equal(shouldSkip({ ...invite, labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }, from({})), 'bulk: Gmail Promotions')
  assert.equal(shouldSkip({ ...invite, labels: ['INBOX', 'CATEGORY_UPDATES'] }, from({})), null)
})
