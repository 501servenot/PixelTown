export { EntityCatalog, loadEntityCatalog } from "./state/catalog";
export { Chunk } from "./state/chunk";
export { CommandQueue, sortCommands, type Command, type CommandReject, type CommandType } from "./domain/command";
export {
  CHUNK_SIZE,
  SPATIAL_CELL_SIZE,
  chunkIdAt,
  instantiate,
  isFacing,
  isObserveDirection,
  isObserver,
  manhattan,
  placedPosition,
  type EntityDefinition,
  type EntityType,
  type ObserveDirection,
  type RuntimeEntity,
  type WorldPosition,
} from "./domain/entity";
export {
  DEFAULT_OBSERVE_RADIUS,
  inView,
  offeredInteractions,
  type AgentObservation,
  type WorldBroadcast,
} from "./perception/observe";
export {
  BROADCAST_RADIUS,
  PUBLIC_BROADCASTS,
  PUBLIC_EVENT_DURATION_TICKS,
  PublicEventManager,
} from "./perception/public-event";
export { MAX_TALK_CHARS, SpeechInbox, type SpeechLine } from "./perception/speech";
export {
  EVENT_PRIORITY,
  EventQueue,
  MAX_EVENT_DEPTH,
  type EventType,
  type WorldSimEvent,
} from "./domain/event";
export { SpatialIndex } from "./state/spatial";
export { TICK_MS, WorldSimulation, type SimulationSnapshot, type WorldSimulationOptions } from "./simulation";
