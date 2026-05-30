/**
 * lib/actor-policy.d.ts
 *
 * Ambient types for actor-policy.js.
 * Consumed by Deno's type checker without a build step.
 */

export type Actor = 'patient' | 'operator';
export type Channel = 'whatsapp' | 'telegram' | 'crm';

export interface ActorPolicy {
  actor: Actor;
  channel: Channel;
  requiresFullData: boolean;
  minAdvanceHours: number;
  minCancelHours: number;
  allowOperatorDefaults: boolean;
  allowTimeWindowOverride: boolean;
}

/** Strict patient / WhatsApp policy (immutable). */
export declare const PATIENT_WA_POLICY: Readonly<ActorPolicy>;

/** Operator / Telegram policy — Kelly's assistant channel (immutable). */
export declare const OPERATOR_TELEGRAM_POLICY: Readonly<ActorPolicy>;

/** Operator / CRM policy — manual appointment entry (immutable). */
export declare const OPERATOR_CRM_POLICY: Readonly<ActorPolicy>;

/**
 * Returns the canonical ActorPolicy for a given actor + channel pair.
 * @throws {Error} if the combination is unknown
 */
export declare function makePolicy(actor: Actor, channel: Channel): Readonly<ActorPolicy>;

/** Returns true when the policy belongs to an operator channel. */
export declare function isOperator(policy: ActorPolicy): boolean;

/** Returns true when the policy belongs to the patient WhatsApp lane. */
export declare function isPatient(policy: ActorPolicy): boolean;

/**
 * Merges operator-supplied defaults into action args for operator policies.
 * For patient policies, returns the original args unchanged (no mutation).
 * Always returns a new object — never mutates input.
 * @throws {Error} if policy is null/undefined or lacks a boolean allowOperatorDefaults field
 */
export declare function mergeOperatorOverrides(
  policy: ActorPolicy,
  args: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown>;
