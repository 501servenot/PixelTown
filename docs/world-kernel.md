# PixelTown 世界内核设计（v2.1 草案）

> 状态：设计草案，未实现。目标读者：评审本设计的 Agent 与实现者。
> v2.1 修订（依据首轮评审）：合并 transfer/contain 为单一原语；补齐四张封闭词表；确立 activity 单一写入者规则；硬上限与造价的职责分离；全文按 M1/M2/M3 分期，M1 不依赖任何 M2/M3 概念。
> 现有代码见 `src/world/`。与现状的差异按里程碑见 §8。

## 0. 要解决的问题

让玩家创造不同风格的世界，但完全不约束就会乱。参照物是 r/place：每人领一个像素、涂一个颜色，数万人涌现出国旗、动漫人物、建筑。

r/place 的启示：它约束的不是**内容**，而是**通道**——

1. **空间**：一块共享的、有限的画布（稀缺 → 领地、协作、战争）
2. **时间**：速率限制（逼迫优先级与协作）
3. **语法**：一个像素 + 一种颜色是唯一合法操作（封闭、人人可懂、可组合出一切）

PixelTown 已有空间（格子 + chunk）和时间（20Hz tick + intent 循环），缺的是**语法**。本文就是这套语法的设计。

核心方法论一句话：**枚举的地方越少越好，组合的地方越多越好。约束介质，释放内容。**

## 1. 总原则

- **万物皆实体，实体皆配方，配方只能用封闭语法写。** 唯一的创造通道是提交配方（entity recipe JSON）。
- **动词是词典，原语是语法，实体是文章。** 词典小而封闭，语法只有八条，文章用户写不完。
- **可叙述性 > 拟真度**：世界居民是 LLM agent，物理必须"能用一句话讲成故事"。能用文案（emit 字符串）解决的拟真，绝不用系统解决。
- **上限防模拟崩溃，价格防玩法失衡**：硬有界域只保护模拟器完整性（单 tick 位移、感知半径、事件深度、op 预算）；实体"强不强"一律由造价定价，不设硬顶。
- **真实度是世界旋钮，不是全局答案**：和平镇禁用 damage、生存服调稀缺。内核只给默认值。
- **创造复杂度分层**：画图摆放零配置；勾选项一分钟；effect 链是 power user 层；自然语言可经 AI 编译成配方（封闭 DSL 使生成结果可类型检查、可沙盒预演）。

## 2. 内核系统清单（~10 个，守住这个数）

| 系统 | 状态 | 职责 | 读的属性 |
| --- | --- | --- | --- |
| move | 已有 | 位移、碰撞、朝向、运行时速度钳制 | footprint、collision、speed |
| vitals | combat.ts 泛化（M1） | 伤害/治疗/死亡；**伤害带类型**，死因传入 destroyed 事件 | health、maxHealth |
| perception | observe.ts 已有 | 视野锥、heard/said/seen 事件 | vision |
| speech | talk/shout 已有 | 私聊、广播 | — |
| behavior | 已有 | 自主行为循环，按 condition 切换动作。**effects 不能写 activity**；玩家/Agent 的 activity 由 command 写，NPC 自主 activity 由 behavior 写 | tickRate、energy |
| spawn | 已有 | 生成/移除实体 | — |
| status | 新增（M1：只计时；M2：传播） | 计时状态（burning/wet/alert…）的挂载与过期 | statuses[] |
| contain | 新增（M1：单层拾取；M2：容器联动/嵌套） | **transfer 原语的唯一执行者**：位置/归属/容纳的唯一写入路径 | capacity、containedIn、ownerId |
| field | 新增（M2） | 实体对 footprint 覆盖格子施加速度向量/状态 | field、rotation |
| effect engine | effects.ts 泛化（M1） | trigger → condition → 原语 的查表执行；事件深度上限防循环 | effects[] |

## 3. 四张封闭词表

语法不是一张表，是四张，各有读者。**向任何一张表加词 = 内核版本升级。** 四张表都封闭，世界主只能选子集，不能造词。

### 3.1 世界动词目录 v1（agent/玩家面对的语言，~22 个）

协议层（感知与移动，现有）：`look` `face` `move` `shout`
交互层（对实体使用，配方在 interaction 里勾选响应）：`talk` `attack` `chop` `pickup` `drop` `give` `rest` `enter` `exit` `open` `insert` `deposit` `collect` `pet` `ignite` `drive` `buy` `hack`

世界旋钮示例：和平镇禁用 `attack` `ignite` `hack`。

### 3.2 原语目录（effect 引擎执行，恰好 8 个）

| 原语 | 含义 | 覆盖示例 |
| --- | --- | --- |
| `damage(type, amount)` | 扣状态值，带伤害类型 | 砍、烧、撞 |
| `heal` | 回状态值 | 喝水、休息 |
| `status(apply/remove, name)` | 挂载/移除计时状态（写 statuses[]，**不能写 activity**） | 点燃、潮湿、逃跑 |
| `transfer(what, to)` | 位置/归属/容纳的唯一原语。词表地址含 self/actor/实体/坐标/world；**M1 只接线 item→actor 与 item→world** | 拾取=transfer(item→actor)；放下=transfer(item→world)；进建筑/传送是 M3 |
| `spawn` / `destroy` | 生成/消灭实体 | 掉落、消耗 |
| `transform` | 变成另一个配方（保留位置与血量比例） | 树桩、黑化、开封 |
| `emit` | 发信号（sound/alarm/said，进 heard/see/said） | 警报、氛围、对话 |

`spawn` 支持 `fromTable`（加权随机表）与 `to: "actor"`。**加权随机表是内核能力**（服务端权威摇骰、入事件日志、可审计），不是第 9 个原语，但计入内核账单。

### 3.3 behavior 动作目录 v1（behavior 系统执行）

`wander` `rest` `patrol` `chase` `flee` `return_to`

### 3.4 condition 键目录 v1（匹配器执行，无计算能力）

`by`（伤害类型）、`actorHasTag`、`targetHasTag`、`actorHolds`、`actorIsOwner`、`hasStatus`、`health<`、`energy<`、`activity`、`material`、`linkAlive`

## 4. 实体配方 schema v2

完整示例（保安机器人）。注意：本例用到 `hasStatus` 而非直接写 activity。

```json
{
  "id": "npc.guard_bot",
  "version": 1,
  "type": "npc",
  "name": "保安机器人",
  "description": "在街区巡逻的自动保安，听到骚动会赶过去",

  "material": "metal",

  "render": { "assetKey": "guard_bot", "scale": 1, "anchor": "foot" },

  "attributes": {
    "health": 300, "maxHealth": 300,
    "energy": 100, "speed": 4,
    "footprintWidth": 1, "footprintHeight": 1,
    "collision": true,
    "movable": false, "mass": 120,
    "capacity": 2,
    "vision": 12,
    "faction": "city_security"
  },

  "tags": ["robot", "authority"],

  "state": { "status": "alive", "activity": "idle", "targetId": null, "facing": "east" },

  "behavior": {
    "tickRate": 2,
    "actions": [
      { "type": "patrol",            "enabled": true },
      { "type": "chase",             "enabled": true, "condition": { "hasStatus": "alert" } },
      { "type": "return_to",         "enabled": true, "condition": { "energy<": 15 } }
    ]
  },

  "interaction": {
    "enabled": true,
    "range": 2,
    "actions": [
      { "type": "talk",    "targetTypes": ["player", "agent", "npc"] },
      { "type": "attack",  "targetTypes": ["player", "agent", "npc", "animal"] },
      { "type": "hack",    "targetTypes": ["player", "agent"] },
      { "type": "deposit", "targetTypes": ["player", "agent", "npc"] }
    ]
  },

  "effects": [
    {
      "trigger": "use:deposit",
      "do": [
        { "op": "transfer", "what": "actor.heldItem", "to": "self" },
        { "op": "emit", "signal": "said", "text": "证物已收讫。", "target": "actor" }
      ]
    },
    {
      "trigger": "damaged",
      "do": [
        { "op": "emit", "signal": "sound", "text": "咣——金属撞击的巨响", "radius": 8 },
        { "op": "status", "name": "alert", "target": "self", "duration": 400 }
      ]
    },
    {
      "trigger": "tick:100",
      "condition": { "health<": 90 },
      "do": [
        { "op": "emit", "signal": "alarm", "text": "保安机器人发出求援警报", "radius": 24 }
      ]
    },
    {
      "trigger": "use:hack",
      "condition": { "actorHasTag": "hacker_tool" },
      "do": [
        { "op": "transform", "into": "npc.guard_bot_rogue" },
        { "op": "emit", "signal": "sound", "text": "机器人的眼睛变成了红色", "radius": 6 }
      ]
    },
    {
      "trigger": "destroyed",
      "condition": { "by": "kinetic" },
      "do": [ { "op": "spawn", "entityType": "item.scrap_metal", "count": 3 } ]
    },
    {
      "trigger": "destroyed",
      "condition": { "by": "fire" },
      "do": [
        { "op": "damage", "value": 30, "damageType": "fire", "radius": 3 },
        { "op": "spawn", "entityType": "item.scrap_metal", "count": 1 }
      ]
    }
  ]
}
```

### 4.1 标识区

| 字段 | 含义 |
| --- | --- |
| `id` | 配方 ID（定义），非实例 ID |
| `version` | 配方版本，变更 +1；实例记录依据版本，供审计 |
| `type` | 粗分类，只决定**权限与感知角色**。类型集合不扩张——building/vehicle/road 都只是参数组合。M3 起用户配方禁选保留类型 `player`/`agent` |
| `name` / `description` | 纯文案，进 agent 的 `see`，是 agent 理解实体的主要途径 |

### 4.2 material（材质预设包，M2）

一行继承一组物理性质：可燃性、弱哪些伤害类型、默认掉落、health 系数。预设 ~12 种：wood / stone / metal / concrete / flesh / plant / paper / cloth / liquid / glass / energy / food。材质与外观解耦；单属性可覆盖（`material: wood` + `flammable: false` = 湿木头）。

### 4.3 render

`assetKey`、`scale`、`anchor: "foot"`。纯表现层。M3 用户自定义外观 = 固定每格分辨率的像素画，尺度统一是视觉不乱的保证。

### 4.4 attributes

| 字段 | 含义 | 读它的系统 |
| --- | --- | --- |
| `health` / `maxHealth` | 到 0 触发 destroyed；造价公式中最贵的属性之一（M3） | vitals |
| `energy` | 行为燃料 | behavior |
| `speed` | 移动能力；运行时 clamp 到世界上限 | move |
| `footprintWidth/Height` | 占格数 | move / spatial |
| `collision` | 是否挡路 | move |
| `movable` / `mass` | 能否被推动/拾取 | move / contain |
| `capacity` | >0 即是容器；**不设硬顶，由造价定价**（M3） | contain |
| `vision` | 感知半径；硬上限保护 perception 成本 | perception |
| `rotation` | 0/90/180/270；field 方向与渲染共用（M2） | field / render |
| `ownerId` | 放置时世界写入，配方不可写 | contain / 权限 |
| `restores` | 被消耗时恢复什么 | vitals |
| 任意其他键 | **惰性数据**，供其他配方的 condition 引用（如 `faction`） | 用户配方（M3） |

### 4.5 tags

惰性字符串数组。无系统认识则无行为；配方可用 `condition` 引用。M3 用户层自由实验场。

### 4.6 state 与运行时字段

配方只给初值（status/activity/targetId/facing）。**写入者规则：effects 只能写 `statuses[]`，不能写 activity；玩家/Agent 的 activity 由 command 系统写；NPC 的自主 activity 由 behavior 写。** behavior 的 condition 用 `hasStatus` 读 statuses。运行时额外字段（配方不可写）：`statuses[]`、`containedIn`、`position`。
词表可以一次定稿，接线按里程碑勾选：M1 只接 look/face/move/shout 与 talk/attack/chop/pickup/rest/collect，以及 wander/rest/chase。`enter`/`exit` trigger 在 M1 表示踏上/离开 footprint，不改变 `containedIn`。

### 4.7 behavior

- `tickRate`：每 N tick 思考一次，越大越省电越迟钝
- `actions`：按优先级排列，condition 满足才激活。动作只能从 §3.3 目录选

### 4.8 interaction

动词只能从 §3.1 目录选，声明谁可发起（`targetTypes`）与距离（`range`）。interaction 只声明"可以发起"，发起后发生什么全在 effects。动词与后果分离：同一个 attack 打在猫（逃跑）和机器人（反击）上结果不同。

### 4.9 effects（事件 → 反应）

每条规则 = `trigger` + `condition` + `do`。同 trigger 多条规则按序匹配第一条条件满足者（if/else 语义）。

- trigger 集：`use:<verb>` / `damaged` / `destroyed` / `status:<name>` / `enter` / `exit` / `tick:<N>`
- condition 键见 §3.4
- do 的 op 见 §3.2

实体之间只用事件通信，永不直接互相调用。

## 5. 防作弊四层（M3 完整生效；M1 只有第 3 层）

作弊 = 提交词表之外的输入。**上限防模拟崩溃，价格防玩法失衡**——两套机制职责不同，不互相替代。

1. **入口校验**：四张词表是枚举，词表外的输入过不了类型检查。硬有界域只覆盖模拟器完整性：单 tick 位移、vision 半径、effect.radius、单 tick op 预算（≤16）、事件深度上限。capacity/health 这类平衡属性**不设硬顶**。
2. **经济定价**：造价 = f(属性总和, op 强度, 稀有材质)，放置时支付。强不是作弊，强是贵。
3. **运行时钳制**：系统读属性时无条件 clamp，不信任配方。事件深度上限已有（`maxEventDepth`）。
4. **权限边界**：spawn 只能引用可合成配方且扣资源；transfer 玩家需要 consent 或特定状态（无 consent 的转移 = 偷窃，合法但 emit 目击事件——**有些事不禁止，而是留痕**）；用户配方禁选保留 type。

治理：所有 op 执行入事件日志（`parentEventId` + `depth` 已有），世界主可审计、回滚；世界旋钮可收紧默认。

## 6. 真实度的衡量标准

不追求拟真，追求**有趣**。每条规则过三关：

1. **制造互动还是家务？** 稀缺产生交易/合作/战争 → 留；每十分钟吃饭 → 砍。
2. **因果能用一句话讲清吗？** 可叙述性是 agent 世界的真实度。
3. **一次决策还是无限重复？**

操作原则：**动作从简，后果从真**。文案层拟真免费（emit 字符串），系统层拟真昂贵。

## 7. 案例（验收目标，非已实现声明）

以下案例是各里程碑完成后的**验收用例**。内核账单共两项新能力：`enter`/`exit` trigger（M1）与加权随机表（M2）。传送门/商场依赖 contain 空间语义定案（§9.2），在定案前不进任何迁移清单。

| 案例 | 关键机制 | 验收什么 | 里程碑 |
| --- | --- | --- | --- |
| 猫 | material:flesh、movable+mass、use:pet→emit、damaged→status(fleeing) | 材质继承、单一写入者（flee 由 behavior 读 hasStatus 驱动） | M2 |
| 保安机器人 | 见 §4 | effects v2 全链路、伤害类型、transform | M2 |
| 扭蛋机 | tables 加权表、actorHolds、collect+actorIsOwner | 加权随机、支付与所有权 | M2 |
| 商场 | enter→transfer(actor→mall)、墙独立成 1×1 实体 | contain 空间语义、大实体组合 | M3（依赖 §9.2） |
| 传送门 | enter→transfer(actor→坐标)、cooldown 防双向震荡 | transfer 统一语义、循环防护 | M3（依赖 §9.2） |

## 8. 分期与迁移清单

### M1：内核硬化（不接 UGC，不动现有协议）

保持 said/heard 寿命、`expectSelf`、chunk 碰撞、collider/render 完全兼容。

1. **四张词表定稿**（§3）：动词目录、op 目录、behavior 动作目录、condition 键目录，写成代码里的枚举常量
2. **effects v2**：`EntityEffect` 升级为 `{ trigger, condition, do[] }`；effects.ts 的 if-else 派发改查表执行 8 原语
3. **vitals**：`applyDamage` 加 `damageType`，死因传入 `entity_destroyed` 事件
4. **status 系统（只计时）**：`statuses[]` 挂载/过期；不做传播
5. **contain 系统（单层拾取）**：`containedIn`、capacity、transfer 只做 item→actor / item→world；捡起后离开空间索引，载体移动时坐标跟着走
6. **`enter`/`exit` trigger**：踏上/离开 footprint 时开火，不改 contain
7. behavior condition 支持 `hasStatus`；现有 `reactToEvent` 的 alert 改为写 statuses[]；M1 额外接线 `chase`（朝 targetId 走一格）供保安机器人验收
8. `defaultCollider`/`defaultRender` 的名字特判（`entity.ts:206-221`）迁入配方显式字段

M1 验收：现有 entities/*.json 全部迁移为 v2 schema，行为不变；`npm test` 全绿。

### M2：涌现物理

status 传播（火蔓延）、field 系统、材质预设表、weighted table、行为动作扩充（`flee` 等）。

M2 验收：猫、保安机器人、扭蛋机三个配方跑通 §7 描述的行为。

### M3：UGC 创造产品

**准入门槛（第 0 问）：先回答"谁可以提交配方、什么速率、agent 与人类是否同权"，回答不了不开工。**

造价公式与钱包、配方提交与校验管线、材质/像素画编辑器、AI 编译（自然语言→配方）、世界旋钮、商场/传送门（依赖 §9.2 定案）。

## 9. 开放问题（请评审者重点攻击）

1. **effect DSL 的表达力边界**：condition 无计算能力。需要计数（杀 10 只老鼠）或状态记忆时怎么办？加 accumulator 属性还是禁止？
2. **contain 的空间语义**（阻塞商场/传送门）：进建筑是传送到内部 chunk 还是原地打标？嵌套 contain 的深度限制？
3. **field 的叠加规则**（M2）：两个相反方向传送带叠同格，谁赢？
4. **词表治理**：四张表加词 = 内核升级。谁提议、谁批准、docs/agent.md 如何同步版本化？
5. **造价公式**：f(属性, op, 材质) 的具体形态未定（M3 前置）。
6. **时间系统缺失**：condition 无法表达"晚上"。世界时钟属性还是保持无昼夜？
7. **配方版本升级**：v2 发布后存活的 v1 实例——原地 transform、冻结、还是并存？
8. **M3 准入**：agent 能否与人类同权提交配方？24h 不停的创造者如何限流？
9. **weighted table 的种子方案**：per-tick 种子可重放审计，但玩家能否通过观察 tick 预测出货？
10. **感知遮挡**：建筑内部实体对外部观察者是否可见？需要遮挡概念吗？
