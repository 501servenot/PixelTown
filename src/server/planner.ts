import { AgentAction, AgentDecision, Direction, Observation, manhattanDistance } from "../shared/protocol";

function directionTo(from: { x: number; y: number }, to: { x: number; y: number }): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

export function planNextAction(observation: Observation): AgentDecision {
  const quest = observation.nearbyEntities.find((entity) => entity.kind === "quest");
  const questAlreadyInspected = observation.recentEvents.some(
    (event) => event.type === "agent.inspect" && event.entityId === quest?.id,
  );
  if (quest && !questAlreadyInspected && manhattanDistance(observation.agent.position, quest.position) <= 2) {
    const action: AgentAction = { type: "inspect", entityId: quest.id };
    return {
      agentId: observation.agent.id,
      observationVersion: observation.observationVersion,
      action,
      rationale: `任务牌就在附近，先读取「${quest.name}」的内容。`,
    };
  }

  const resource = observation.nearbyEntities.find(
    (entity) => entity.kind === "resource" && Number(entity.state.remaining ?? 0) > 0,
  );
  if (resource && manhattanDistance(observation.agent.position, resource.position) <= 1) {
    const action: AgentAction = { type: "gather", entityId: resource.id };
    return {
      agentId: observation.agent.id,
      observationVersion: observation.observationVersion,
      action,
      rationale: `已经到达「${resource.name}」，采集一份资源。`,
    };
  }

  const target = resource ?? quest;
  if (target) {
    const action: AgentAction = {
      type: "move",
      direction: directionTo(observation.agent.position, target.position),
    };
    return {
      agentId: observation.agent.id,
      observationVersion: observation.observationVersion,
      action,
      rationale: `向「${target.name}」移动，距离 ${manhattanDistance(observation.agent.position, target.position)} 格。`,
    };
  }

  const action: AgentAction = { type: "move", direction: "east" };
  return {
    agentId: observation.agent.id,
    observationVersion: observation.observationVersion,
    action,
    rationale: "附近没有可用目标，向东探索一格。",
  };
}
