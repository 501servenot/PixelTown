import type { WorldPosition } from "./entity";

/** 位置组件：实体在世界中的坐标；move/contain 系统改位置时同步更新它。 */
export interface TransformComponent {
  position: WorldPosition;
}

/** 碰撞组件：footprint 占格尺寸与是否挡路；move 系统做碰撞检查时读它。 */
export interface ColliderComponent {
  width: number;
  height: number;
  solid: boolean;
}

/** 渲染组件：素材键、缩放、锚点与图层；纯表现层数据，客户端据此绘制。 */
export interface RenderComponent {
  assetKey: string;
  scale: number;
  anchor: "foot";
  /** Ground tiles sort under every standing sprite. */
  layer?: "ground" | "actor";
}

/** 实体的组件集合（transform/collider/render）：实例化时从配方派生，与平铺字段并存以兼容旧代码。 */
export interface EntityComponents {
  transform: TransformComponent;
  collider: ColliderComponent;
  render: RenderComponent;
}
