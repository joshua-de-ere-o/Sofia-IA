/**
 * lib/actor-policy.js
 *
 * Actor/channel policy boundary.
 *
 * PURPOSE
 * -------
 * Separates the patient WhatsApp lane (strict, no operator defaults) from
 * operator lanes (Telegram, CRM). Operator overrides are auditable and
 * MUST NOT contaminate patient behavior.
 *
 * PATIENT LANE CONTRACT (WhatsApp)
 * ---------------------------------
 * - requiresFullData: true          — nombre, fecha_nacimiento, modalidad, zona, motivo
 * - minAdvanceHours: 24             — cannot book < 24h ahead
 * - minCancelHours: 48              — cannot cancel < 48h before appointment
 * - allowOperatorDefaults: false    — operator relaxations are invisible here
 * - allowTimeWindowOverride: false  — time windows are hard constraints
 *
 * OPERATOR LANE CONTRACT (Telegram / CRM)
 * ----------------------------------------
 * - allowOperatorDefaults: true     — Kelly can fill missing fields with valid defaults
 * - allowTimeWindowOverride: true   — Kelly can book/cancel at any time (audited)
 * - minAdvanceHours: 0              — no advance booking constraint
 * - minCancelHours: 0               — no cancellation window constraint
 *
 * ISOLATION GUARANTEE
 * --------------------
 * All exported constants are frozen. mergeOperatorOverrides() returns a NEW
 * object when the policy is operator — it never mutates input args or patient
 * policy constants.
 */

/** @typedef {'patient' | 'operator'} Actor */
/** @typedef {'whatsapp' | 'telegram' | 'crm'} Channel */

/**
 * @typedef {Object} ActorPolicy
 * @property {Actor} actor
 * @property {Channel} channel
 * @property {boolean} requiresFullData
 * @property {number} minAdvanceHours
 * @property {number} minCancelHours
 * @property {boolean} allowOperatorDefaults
 * @property {boolean} allowTimeWindowOverride
 */

/**
 * Strict patient / WhatsApp policy.
 * Rules here are immutable — freezing is enforced at module load.
 *
 * @type {Readonly<ActorPolicy>}
 */
export const PATIENT_WA_POLICY = Object.freeze({
  actor: 'patient',
  channel: 'whatsapp',
  requiresFullData: true,
  minAdvanceHours: 24,
  minCancelHours: 48,
  allowOperatorDefaults: false,
  allowTimeWindowOverride: false,
})

/**
 * Operator / Telegram policy (Kelly's assistant channel).
 * Relaxed constraints — no time windows, operator defaults allowed.
 *
 * @type {Readonly<ActorPolicy>}
 */
export const OPERATOR_TELEGRAM_POLICY = Object.freeze({
  actor: 'operator',
  channel: 'telegram',
  requiresFullData: false,
  minAdvanceHours: 0,
  minCancelHours: 0,
  allowOperatorDefaults: true,
  allowTimeWindowOverride: true,
})

/**
 * Operator / CRM policy (manual appointment entry).
 * Same relaxed rules as Telegram — kept separate for channel attribution.
 *
 * @type {Readonly<ActorPolicy>}
 */
export const OPERATOR_CRM_POLICY = Object.freeze({
  actor: 'operator',
  channel: 'crm',
  requiresFullData: false,
  minAdvanceHours: 0,
  minCancelHours: 0,
  allowOperatorDefaults: true,
  allowTimeWindowOverride: true,
})

/** @type {Map<string, Readonly<ActorPolicy>>} */
const POLICY_MAP = new Map([
  ['patient:whatsapp', PATIENT_WA_POLICY],
  ['operator:telegram', OPERATOR_TELEGRAM_POLICY],
  ['operator:crm', OPERATOR_CRM_POLICY],
])

/**
 * Returns the canonical policy for a given actor + channel pair.
 *
 * @param {Actor} actor
 * @param {Channel} channel
 * @returns {Readonly<ActorPolicy>}
 * @throws {Error} if the combination is unknown
 */
export function makePolicy(actor, channel) {
  const key = `${actor}:${channel}`
  const policy = POLICY_MAP.get(key)
  if (!policy) throw new Error(`[actor-policy] Unknown policy combination: ${key}`)
  return policy
}

/**
 * Returns true when the policy belongs to an operator channel.
 *
 * @param {ActorPolicy} policy
 * @returns {boolean}
 */
export function isOperator(policy) {
  return policy.actor === 'operator'
}

/**
 * Returns true when the policy belongs to the patient WhatsApp lane.
 *
 * @param {ActorPolicy} policy
 * @returns {boolean}
 */
export function isPatient(policy) {
  return policy.actor === 'patient'
}

/**
 * Merges operator-supplied defaults into action args, but ONLY for operator
 * policies. For patient policies the original args are returned unmodified.
 *
 * Isolation guarantee: this function NEVER mutates `args` or any policy
 * constant — it always returns a new object.
 *
 * @param {ActorPolicy} policy
 * @param {Record<string, unknown>} args  Original action arguments (not mutated)
 * @param {Record<string, unknown>} defaults  Operator-supplied defaults to apply
 * @returns {Record<string, unknown>}  Merged args (new object) or original args (patient)
 */
export function mergeOperatorOverrides(policy, args, defaults) {
  if (policy == null || typeof policy.allowOperatorDefaults !== 'boolean') {
    throw new Error('[actor-policy] mergeOperatorOverrides requires a valid policy')
  }
  if (!policy.allowOperatorDefaults) {
    // Patient lane — return a shallow copy so callers cannot accidentally alias
    return { ...args }
  }
  // Operator lane — args take precedence; defaults fill in missing fields only
  return { ...defaults, ...args }
}
