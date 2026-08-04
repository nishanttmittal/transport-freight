// Unit test for the REAL production resolver — imports firebaseConfig.js itself,
// so it cannot drift from the shipped code the way a copied harness can.
// Run: node --test src/core/db/
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickAuthDomain, APPROVED_AUTH_HOSTS } from './firebaseConfig.js'

const PROJECT = 'unico-operations.firebaseapp.com'

test('the live production host is same-origin', () => {
  assert.equal(pickAuthDomain('unico-operations.firebaseapp.com'), PROJECT)
})

test('gh-pages fallback stays cross-origin on the project default', () => {
  assert.equal(pickAuthDomain('nishanttmittal.github.io'), PROJECT)
})

test('local dev falls back, never trusted as its own authDomain', () => {
  for (const h of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(pickAuthDomain(h), PROJECT, h)
  }
})

test('abandoned .web.app sites are NOT trusted (they fail redirect_uri_mismatch)', () => {
  for (const h of ['unico-plating.web.app', 'unico-welder.web.app', 'unico-operations.web.app']) {
    assert.equal(pickAuthDomain(h), PROJECT, h)
  }
})

test('arbitrary Firebase sites are NOT trusted by suffix', () => {
  for (const h of ['attacker.web.app', 'sub.evil.web.app', 'other-project.firebaseapp.com']) {
    assert.equal(pickAuthDomain(h), PROJECT, h)
  }
})

test('lookalike / malformed hosts fail closed', () => {
  for (const h of ['evil-firebaseapp.com.attacker.net', 'xfirebaseapp.com', 'firebaseapp.com',
                   'web.app', 'notweb.app', 'xn--80ak6aa92e.web.app', '', null, undefined]) {
    assert.equal(pickAuthDomain(h), PROJECT, String(h))
  }
})

test('normalises like a browser: case, whitespace, trailing FQDN dot', () => {
  for (const h of ['UNICO-OPERATIONS.FIREBASEAPP.COM', '  unico-operations.firebaseapp.com  ',
                   'unico-operations.firebaseapp.com.']) {
    assert.equal(pickAuthDomain(h), PROJECT, JSON.stringify(h))
  }
})

test('an approved custom domain becomes same-origin — only once listed', () => {
  const custom = 'freight.unicoproductsindia.com'
  assert.equal(pickAuthDomain(custom), PROJECT, 'must NOT be trusted before registration')
  assert.equal(pickAuthDomain(custom, new Set([custom])), custom, 'trusted once explicitly added')
})

test('the shipped allowlist contains only the pre-registered project domain', () => {
  assert.deepEqual([...APPROVED_AUTH_HOSTS], [PROJECT])
})
