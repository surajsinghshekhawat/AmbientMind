import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExtractedTask } from '../electron/services/ollama'
import { aggregate, pair, scoreMessage, similarity } from './score'
import type { GoldTask, LabelledMessage } from './types'

const gold = (title: string, deadline: string | null = null): GoldTask => ({
  title,
  deadline,
  priority: 'medium'
})

const pred = (title: string, deadline: string | null = null): ExtractedTask => ({
  title,
  deadline,
  priority: 'medium',
  people: [],
  confidence: 0.9
})

const message = (id: string, goldTasks: GoldTask[]): LabelledMessage => ({
  id,
  sender: 'a@b.com',
  recipients: 'c@d.com',
  sentAt: '2001-03-12T09:00:00',
  subject: 's',
  body: 'b',
  goldTasks
})

test('similarity ignores stopwords and word order', () => {
  assert.ok(similarity('Send the Q3 budget report to Sarah', 'send Q3 budget report Sarah') > 0.8)
  assert.ok(similarity('Call Rob about indemnity', 'Book flights to Bangalore') < 0.2)
})

test('paraphrases match, unrelated tasks do not', () => {
  const result = pair(
    [gold('Send Q1 East desk volume numbers to Louise')],
    [pred('Send the Q1 volume numbers for the East desk to Louise')]
  )
  assert.equal(result.matched.length, 1)
  assert.equal(result.unmatchedGold.length, 0)
  assert.equal(result.unmatchedPredicted.length, 0)
})

test('one gold task cannot absorb two predictions', () => {
  const result = pair(
    [gold('Review the ISDA redline')],
    [pred('Review the ISDA redline'), pred('Review the ISDA redline again')]
  )
  assert.equal(result.matched.length, 1)
  assert.equal(result.unmatchedPredicted.length, 1)
})

test('hallucinated task on a task-free message counts as a false positive', () => {
  const scored = scoreMessage(message('m1', []), [pred('Unsubscribe from newsletter')], 0)
  assert.deepEqual(
    [scored.truePositives, scored.falsePositives, scored.falseNegatives],
    [0, 1, 0]
  )
})

test('missed task counts as a false negative', () => {
  const scored = scoreMessage(message('m2', [gold('Call Rob Walls about indemnity')]), [], 0)
  assert.deepEqual(
    [scored.truePositives, scored.falsePositives, scored.falseNegatives],
    [0, 0, 1]
  )
})

test('aggregate computes micro precision, recall and F1', () => {
  const corpus = [
    message('a', [gold('Send the report to Sarah')]),
    message('b', [gold('Call Rob Walls about indemnity')]),
    message('c', [])
  ]
  const scored = [
    scoreMessage(corpus[0]!, [pred('Send the report to Sarah')], 100),
    scoreMessage(corpus[1]!, [], 100),
    scoreMessage(corpus[2]!, [pred('Read the newsletter')], 100)
  ]

  const metrics = aggregate(scored, corpus)
  // 1 TP, 1 FP, 1 FN -> P = R = 0.5, F1 = 0.5
  assert.equal(metrics.truePositives, 1)
  assert.equal(metrics.falsePositives, 1)
  assert.equal(metrics.falseNegatives, 1)
  assert.equal(metrics.precision, 0.5)
  assert.equal(metrics.recall, 0.5)
  assert.equal(metrics.f1, 0.5)
  // The single task-free message was not left alone.
  assert.equal(metrics.emptySpecificity, 0)
})

test('deadline accuracy is measured per calendar day on matched pairs only', () => {
  const corpus = [
    message('d', [gold('Send the report to Sarah', '2001-03-13T17:00:00')]),
    message('e', [gold('Call Rob about indemnity', '2001-03-15T17:00:00')])
  ]
  const scored = [
    // Right day, wrong hour: counts as a hit.
    scoreMessage(corpus[0]!, [pred('Send the report to Sarah', '2001-03-13T09:00:00')], 0),
    // Wrong day: counts as a miss.
    scoreMessage(corpus[1]!, [pred('Call Rob about indemnity', '2001-03-16T17:00:00')], 0)
  ]

  assert.equal(aggregate(scored, corpus).deadlineAccuracy, 0.5)
})

test('a corpus with no gold tasks and no predictions scores perfectly', () => {
  const corpus = [message('f', []), message('g', [])]
  const scored = corpus.map((m) => scoreMessage(m, [], 0))
  const metrics = aggregate(scored, corpus)
  assert.equal(metrics.f1, 1)
  assert.equal(metrics.emptySpecificity, 1)
})
