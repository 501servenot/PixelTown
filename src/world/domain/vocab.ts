/** Closed word tables. Adding a word is a kernel version bump. */

export const PROTOCOL_VERBS = ["look", "face", "move", "shout"] as const;
export const INTERACTION_VERBS = [
  "talk",
  "attack",
  "chop",
  "pickup",
  "drop",
  "give",
  "rest",
  "enter",
  "exit",
  "open",
  "insert",
  "deposit",
  "collect",
  "pet",
  "ignite",
  "drive",
  "buy",
  "hack",
] as const;
export const WORLD_VERBS = [...PROTOCOL_VERBS, ...INTERACTION_VERBS] as const;

/** Verbs the M1 command path actually executes. The rest stay as catalog placeholders. */
export const M1_WIRED_VERBS = ["look", "face", "move", "shout", "talk", "attack", "chop", "pickup", "rest", "collect"] as const;

export const EFFECT_OPS = ["damage", "heal", "status", "transfer", "spawn", "destroy", "transform", "emit"] as const;
export const M1_WIRED_OPS = ["damage", "heal", "status", "transfer", "spawn", "destroy", "emit"] as const;

export const BEHAVIOR_ACTIONS = ["wander", "rest", "patrol", "chase", "flee", "return_to"] as const;
export const M1_WIRED_BEHAVIORS = ["wander", "rest", "chase"] as const;

export const CONDITION_KEYS = [
  "by",
  "actorHasTag",
  "targetHasTag",
  "actorHolds",
  "actorIsOwner",
  "hasStatus",
  "health<",
  "energy<",
  "activity",
  "material",
  "linkAlive",
] as const;

export const DAMAGE_TYPES = ["kinetic", "chop", "fire"] as const;

/** 世界动词词表的类型：agent/玩家面对的语言（协议层 look/face/move/shout 加交互层动词）。 */
export type WorldVerb = (typeof WORLD_VERBS)[number];
/** effect 引擎可执行的原语词表类型：damage/heal/status/transfer/spawn/destroy/transform/emit。 */
export type EffectOpName = (typeof EFFECT_OPS)[number];
/** behavior 系统可执行的动作词表类型：wander/rest/patrol/chase/flee/return_to。 */
export type BehaviorActionName = (typeof BEHAVIOR_ACTIONS)[number];
/** effect 与 behavior 条件键的词表类型；匹配器只认识这些键。 */
export type ConditionKey = (typeof CONDITION_KEYS)[number];
/** 伤害类型词表（kinetic/chop/fire）：随 damaged/destroyed 事件传递，供 condition 的 by 键区分死因。 */
export type DamageType = (typeof DAMAGE_TYPES)[number];

export function isWorldVerb(value: unknown): value is WorldVerb {
  return typeof value === "string" && (WORLD_VERBS as readonly string[]).includes(value);
}

export function isEffectOp(value: unknown): value is EffectOpName {
  return typeof value === "string" && (EFFECT_OPS as readonly string[]).includes(value);
}

export function isDamageType(value: unknown): value is DamageType {
  return typeof value === "string" && (DAMAGE_TYPES as readonly string[]).includes(value);
}
