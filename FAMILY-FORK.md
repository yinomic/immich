# Family Album Fork — 改造方案与实施计划

> 基线：`immich-app/immich` @ `7d4b64cb4`（server 3.3.0-rc.0，2026-10-16）
> 分支：`family-album`
> 定位：**家庭相册（以宝宝为主、以时间线为主），单账号（爸爸妈妈共用），媒体存云桶，语义搜索走云，无本地 ML，不生成缩略图。**

---

## 1. 目标与非目标

### 要做
| # | 需求 | 落地形态 |
|---|---|---|
| G1 | 照片/视频存云对象桶 | TOS（火山）/ COS（腾讯）作为唯一真源，S3 协议接入 |
| G2 | 搜索依赖云服务 | 云端多模态 embedding（方舟 `doubao-embedding-vision` / 腾讯 TokenHub 多模态）+ 云端向量库（VikingDB / VDB） |
| G3 | 删除 machine learning | 删 `machine-learning/`、`MachineLearningRepository`、人脸/人物/OCR/CLIP 全链路 |
| G4 | 不要多用户与分享 | 单账号；删共享、伙伴、评论点赞、多用户管理 |
| G5 | 不要缩略图 | 不生成 thumbs/preview，网格与详情页直出原图 |
| G6 | 以时间线为主 | 时间线 + 相册（单人）+ 收藏 + 地图 + EXIF + 回收站 |

### 明确不做
- 外部图库（`/libraries`，依赖本地目录扫描/watch）→ 家庭场景不需要，保留代码但默认关闭，P5 决定是否删除。
- 人脸/人物、OCR、重复检测的向量部分、CLIP 智能搜索的本地模型。
- 多实例部署、K8s、外部 ML 服务（`remote-machine-learning`）。

---

## 2. 关键决策（D）与取舍

| 编号 | 决策 | 理由 / 代价 |
|---|---|---|
| D1 | **云厂商主线 = 火山引擎**（方舟 embedding + VikingDB + TOS），腾讯云（COS + VDB + TokenHub 多模态 embedding）作为可替换适配器 | 方舟多模态向量化是原生图文同空间模型；TOS/COS 均兼容 S3 协议，存储层只写一份 |
| D2 | **存储层新增 `ObjectStorage` 抽象**，`LocalFs`（开发）与 `S3Compat`（TOS/COS）两实现；对象 key 取代绝对路径 | PR #22427 证明可行；需要处理 exiftool/ffmpeg 必须真实路径（临时落地 `withLocalCopy`） |
| D3 | **向量库先留 Postgres(pgvector) 作为默认实现，同时提供 `VikingVectorStore`**，用 `VECTOR_STORE=postgres\|vikingdb` 切换 | 没有云 key 也能端到端跑通与验证质量；有 key 后切云，接口不变。最终形态仍是云向量桶（G2） |
| D4 | **不生成缩略图 ≠ 不做格式兼容转换**：HEIC/HEIF → JPEG 一次全尺寸转码（保留原图 + 兼容件） | iPhone 默认拍 HEIC，浏览器/安卓无法直解。没有这一步"直出原图"在手机上就是打不开。转码件与"缩略图"不同：每资产一份、尺寸=原图 |
| D5 | 视频：保留按需转码（可选开关），默认**不预生成** encoded-video | 宝宝视频多为 HEVC，浏览器播不了；低频使用下按需转码 + 缓存比全量预转更省 |
| D6 | **先 server + web，mobile 后置** | 删 API 会让官方 App 部分功能崩；若家庭只用 Web/PWA，可省掉 App 重编译。见 §7 待确认 |
| D7 | 删功能采用"**先摘 UI/开关，后删代码与表**" | 每一步都保持可编译、可启动、可回滚 |

---

## 3. 目标架构

```
上传:  App/Web ──POST /assets──► server ──exiftool(临时落地)──► TOS/COS  (原图, key=originals/<uuid>.jpg)
                                     └─► Postgres (assets/asset_file 存 object key)
                                     └─► 入队 Embed 任务 ──► 方舟多模态向量化 ──► VikingDB (vector + ownerId 标量)

浏览:  Web 时间线 ──GET /assets?size=30──► server (只查 Postgres)
                 ──GET /assets/:id/original──► 302 presigned URL ──► TOS/COS 直出原图(浏览器解码)
搜索:  Web 搜索框 ──POST /search/smart──► server ──文字向量(方舟)──► VikingDB query(filter ownerId) ──► assetIds
```

- 服务器**不落媒体数据**（除 exiftool/ffmpeg 的临时文件），无缩略图目录。
- 搜索的"以图搜图"（`queryAssetId`）→ 该资产的向量直接从 VikingDB `GetVectors` 取。

---

## 4. 分阶段实施计划

每阶段结束必须：`pnpm --filter immich check`（tsc，需先 `pnpm --filter @immich/sdk build && pnpm --filter @immich/plugin-sdk build`）+ 相关单测绿 + 手工冒烟（docker compose 起 server+pg+redis，上传/浏览/搜索）。

### P0 基线与骨架（✅ 已完成）
- [x] 建分支 `family-album`
- [x] 依赖安装（`pnpm install --frozen-lockfile`，17 分钟，npmmirror 源）
- [x] 基线验证：`@immich/sdk`/`@immich/plugin-sdk` 需先 build，否则 tsc 报 `Cannot find module '@immich/plugin-sdk'`
- [x] 本方案文档
- 交付：可编译基线（`pnpm --filter immich check` 绿）+ 计划

### P1 删除 ML（G3）— 进行中
**已完成（基础设施层）**：删除 `machine-learning/` 目录；4 个 compose 文件移除 ML 服务与 `model-cache` 卷（`docker compose config` 全部校验通过）；`docker/hwaccel.ml.yml`、devcontainer 覆盖、CI（`test.yml` 去掉 `ml-unit-tests`/`e2e-tests-ml`，`docker.yml` 去掉 `machine-learning`/`retag_ml`/`success-check-ml` 并修复锚点与 `needs`）、`renovate.json`、`.github/labeler.yml`、`CODEOWNERS`、`.dockerignore`、`mise.toml`、ML 相关文档页与 `_redirects` 均已清理。

服务端（按依赖顺序）：
1. `services/smart-info.service.ts` → 改为调用新的 `EmbeddingProvider`（P2 落地，先用接口占位）
2. `services/search.service.ts`：语义分支改为 `VectorStore` 查询
3. 删 `services/ocr.service.ts`、`services/person.service.ts`、`controllers/{person,face}.controller.ts`、`repositories/person.repository.ts`、`repositories/machine-learning.repository.ts`
4. 删 schema：`smart_search`（若切云向量库）、`face_search`、`asset_face*`、`person*`、`asset_ocr*`（12 张表）+ 新迁移
5. 删 `QueueName.{FaceDetection,FacialRecognition,SmartSearch,Ocr}`、`JobName.*` 对应项 + 装饰器（**注意** `job.repository.setup()` 会对不上就抛 `ImmichStartupError`）
6. 删 `DB_VECTOR_EXTENSION`/`vectorIndexQuery`/`DatabaseExtension` 检测（切云向量库后 Postgres 可用官方镜像）
7. 删 `machine-learning/` 目录、compose 服务、`MACHINE_LEARNING_*` env、docs、CI
8. 客户端：web 人脸/人物/OCR 相关页面与组件（245 文件引用需甄别）、i18n key、`packages/sdk` + `open-api` 重新生成；mobile 后置
验证：typecheck + `pnpm --filter immich-server test`（相关 spec 一并删/改）+ 启动不报 job handler 错

### P2 云搜索（G2）— 进行中
**已完成（配置与 provider 层）**：
1. `server/src/repositories/embedding/`：`embedding.provider.ts`（接口 + 容错响应解析）、`ark-embedding.provider.ts`（方舟 `/embeddings/multimodal`，Bearer key、超时、429/5xx 退避重试、维度校验）、`tencent-embedding.provider.ts`（TokenHub `/embeddings`，OpenAI 兼容）、`mock-embedding.provider.ts`（离线跑通全链路，无 key 也能开发）
2. 环境变量（不经 SystemConfig，避免动 DB 配置与 SDK 生成）：`IMMICH_CLOUD_SEARCH_ENABLED / _PROVIDER(ark|tencent|mock) / _API_KEY / _MODEL / _BASE_URL / _DIM / _TIMEOUT_MS`，落在 `EnvData.search`
3. `embedding.repository.ts` 统一入口（`enabled` / `modelName` / `dimSize` / `embedImage` / `embedText`），已注册进 DI（`repositories/index.ts`）
4. `scripts/verify-cloud-search.mjs`：用真 key 打印状态码、维度、延迟、原始响应头与相似度矩阵，用来确认"图文同空间"与维度

**已完成（基础设施层，同 P1）**

待做：

   - `embedding.provider.ts`（接口：`embedImages(keys)`, `embedText(q)`；维度/模型版本写入 `system_metadata`）
   - `ark-embedding.provider.ts`（火山方舟多模态向量化，Bearer AK；支持 image URL / base64）
   - `tencent-embedding.provider.ts`（TokenHub `/v1/embeddings` 风格）
   - `mock.provider.ts`（本地开发/测试用，确定性伪向量）
2. `server/src/repositories/vector/` 新增：
   - `vector-store.ts`（接口：`upsert`, `query(vector, filter, topK)`, `delete`, `get`）
   - `postgres-vector.store.ts`（默认，复用 `smart_search` + pgvector）
   - `viking-vector.store.ts`（VikingDB 数据面）
3. `services/smart-info.service.ts` → `EmbedService`：图片从存储取字节 → 云端向量 → 写向量库
4. `services/search.service.ts`：文字查询 → 云端向量 → 向量库 Top-K → 与 Postgres 过滤条件求交
5. 新增运维能力：`/jobs` 里的"重建索引"（全量回填，带限速与进度）、删除资产同步删向量
6. 验证脚本：`scripts/verify-cloud-search.mjs`（用真实 key 打印原始响应，核对字段/维度/计费）
验证：本地 `mock provider + postgres store` 跑通上传→搜索；有 key 后切 `ark + vikingdb`

### P3 云存储（G1/G5）
1. `ObjectStorage` 抽象（`put/get/delete/exists/list/presign`），实现 `LocalFs` + `S3Compat`（aws-sdk v3，支持自定义 endpoint/path-style，兼容 TOS/COS）
2. `StorageRepository` 的使用点逐个改造（23 个文件）；`StorageCore` 产出 object key
3. `withLocalCopy(key)`：exiftool / ffmpeg / sharp 前落地临时文件，处理完回传（仅 HEIC 转码与视频转码需要写回）
4. `res.sendFile` → 302 presigned（保留 Range/Content-Disposition 参数）
5. 关掉缩略图链路：`media.service` 不再生成 thumbs，`asset_file` 不再有 thumbnail/preview 记录；前端改直出原图
6. 兜底：`db backup` 上传到桶的 `backups/` 前缀
验证：本地 MinIO 端到端；再换 TOS/COS

### P4 单账号（G4）
- 删/摘：`partner.*`、albums 共享、`activity`（评论点赞）、`shared-link`（`/share`）、多用户管理（`auth-admin` 的用户 CRUD）、`user.controller` 里与他人相关的接口
- SQL 层面的 ACL 过滤简化（只保留 owner 校验），`SearchRepository`/`AccessRepository` 大瘦身
- 前端：隐藏/删除共享、伙伴、用户管理、评论入口；导航只留时间线/相册/搜索/地图/回收站
- 迁移：保留 `users` 表（单行），`album_user`/`partner`/`activity` 表删除
验证：typecheck + 手工回归（登录、上传、相册、收藏、回收站）

### P5 收尾（时间线为主的体验）
- 时间线默认按天分组、按月跳转；相册只保留单人相册
- 删除外部图库（如需）
- `docker-compose` 精简：只留 server/postgres/redis（无 ML 容器）
- 文档：`docs/` 精简为部署说明
- 可选：PWA（手机加到主屏），减少对 mobile App 的依赖

---

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **无缩略图的带宽代价** | 时间线网格每屏可能拉几十张原图（每张 3–8MB），弱网体验差 | ① 页大小降到 20–30 且懒加载；② 服务端 302 直连桶（不占服务器带宽）；③ 前端本地缓存小图（IndexedDB，客户端生成，不占云端）；④ 保留 `THUMBNAILS=on` 开关回滚 |
| HEIC/RAW 无法直出 | iPhone 照片打不开 | D4：上传时 HEIC→JPEG 全尺寸转码（一份，非缩略图）；RAW 保留原图 + 提示 |
| 云端 API 契约不确定 | 写错字段/维度，联调耗时 | 适配器隔离在单个文件；`scripts/verify-cloud-search.mjs` 用真 key 校验；维度/模型版本落 `system_metadata`，变更即触发重建索引 |
| 无 key 时无法验证 | 阻塞进度 | `mock provider + postgres store` 保证本地全链路可跑 |
| **hard fork 维护成本** | 无法 merge 上游 | 只保留最小必要改动；把"删除"尽量做成 `family` 层可开关；安全补丁靠 cherry-pick |
| 删 API 破坏官方 App | App 崩溃/功能缺失 | D6：先 Web；若要 App，改成"隐藏入口但保留 API" |
| 向量库/桶的权限过滤 | 越权或 Top-K 语义被破坏 | ownerId 作为可过滤标量在**查询侧**过滤；不要先 Top-K 再本地过滤 |

---

## 6. 文件级清单（增量更新）

- 删除目录：`machine-learning/`
- 删除服务/仓库/控制器：见 P1 第 3 条
- 删除表：见 P1 第 4 条（12 张）
- 新增：`server/src/repositories/embedding/*`、`server/src/repositories/vector/*`、`server/src/services/embed.service.ts`、`server/src/storage/*`、`scripts/verify-cloud-search.mjs`
- 大改：`services/{search,smart-info,media,asset-media,metadata,transcoding,download}.service.ts`、`repositories/{storage,config,asset}.repository.ts`、`cores/storage.core.ts`、`web/src/routes/(user)/**`

---

## 7. 待确认（不阻塞 P0–P1）

1. **前端形态**：只用 Web/PWA，还是必须用官方 App？（决定 P4 是否保留 API 与是否动 `mobile/`）
2. **视频**：宝宝视频要不要保留播放转码？（默认：按需转码，不预生成）
3. **HEIC 转码**：接受"上传时 HEIC→JPEG 全尺寸转码（多存一份）"吗？否则 iPhone 照片需要按需转码 + 缓存
4. **云厂商最终二选一**：先按火山实现（TOS + 方舟 + VikingDB），腾讯适配器同步留接口？
5. **向量库**：接受"先用 Postgres 跑通、拿到 key 后切 VikingDB"的两步走吗？

---

## 8. 进度日志

### Round 1（P0 基线 + P1 基础设施 + P2 provider 骨架）
- 分支 `family-album`；`pnpm install --frozen-lockfile`；确认 `@immich/sdk`/`@immich/plugin-sdk` 需先 build 才能 tsc
- 删除 `machine-learning/`、compose ML 服务与 `model-cache` 卷、`hwaccel.ml.yml`、devcontainer 覆盖、CI ML 作业、renovate/labeler/CODEOWNERS/.dockerignore/mise 条目、ML 文档与 `_redirects`
- 新增 `server/src/repositories/embedding/{embedding,ark-embedding,tencent-embedding,mock-embedding}.provider.ts`、`embedding.repository.ts`（DI 注册）、`scripts/verify-cloud-search.mjs`
- 新增 env：`IMMICH_CLOUD_SEARCH_{ENABLED,PROVIDER,API_KEY,MODEL,BASE_URL,DIM,TIMEOUT_MS}` → `EnvData.search`
- 验证：`docker compose config` × 4 通过；`tsc` 绿；eslint 绿；单测 105 文件 / 2340 用例全绿

### Round 2（P2 搜索链路切换，去预览依赖）
- `asset-job.repository.ts`：`streamForEncodeClip` 改为遍历原图（不再要求 preview 存在，且只索引图片）；`getForClipEncoding` 返回 `originalPath`
- `smart-info.service.ts`：删除 CLIP 模型表校验，改为读 `EmbeddingRepository`（维度变更即重建索引）；`handleEncodeClip` 读**原图**字节 → 云端 embedding → 写入向量表（`JSON.stringify(vector)` 即 pgvector 字面量）
- `search.service.ts`：`searchSmart`/`searchSmartV3` 用 `EmbeddingRepository.isEnabled()` 判定；文本查询走云端 embedding 并保留 LRU 缓存；以图搜图仍复用库内向量
- `base.service.ts`/`repositories/index.ts`/`test/utils.ts`：注入与 mock 打通；重写 `smart-info.service.spec.ts`，更新 `search.service.spec.ts`
- 验证：`tsc` 绿；单测 105 文件 / 2331 用例全绿；eslint 绿

**下一步（Round 3+）**：删 `machine-learning.repository.ts` 及其消费者（`ocr.service`、`person.service`、`duplicate.service` 的向量部分）、12 张表与新迁移、`QueueName/JobName` 对应项与装饰器、`SystemConfig.machineLearning` 与 admin UI；随后进入 P3 云存储。

### 环境限制（影响验证方式）
- 本机 Docker 只能访问 `ccr.ccs.tencentyun.com` 私有镜像源，`registry-1.docker.io` / `ghcr.io` 拉取超时 → 无法直接起官方 `immich-postgres`（含 vectorchord）容器做运行时冒烟。
- 可用的本地 `postgres:16` 镜像**不含 pgvector/vectorchord** → 只要向量还在 Postgres 里，本地就跑不起来。
- **结论（也印证了目标方向）**：把向量搬到云向量桶（VikingDB/VDB）后，Postgres 可用 stock 镜像，本地冒烟与部署都更简单。因此 P2 的"向量库抽象 + VikingDB 适配器"优先级提到 P3（云存储）之前。

### Round 3（向量库抽象：向量离开 Postgres）
- 新增 `server/src/repositories/vector/vector-store.ts`：`VectorStore` 接口（`upsert/delete/get/search/clear`）+ 余弦距离（与 pgvector `<=>` 语义一致，含 `vectorLiteral`）
- 新增 `file-vector-store.ts`：本地开发/单机用的向量库（内存 + 追加式 JSONL 日志 + 启动压缩），**无需 pgvector、无需云 key 也能跑通全链路**；配 8 个单测（排序、topK、maxDistance、assetIds 预过滤、删除、重启恢复、维度校验、脏日志容错）
- 新增 `vector-store.repository.ts`：DI 入口，按 env 选择后端（当前 file；VikingDB 适配器下一轮）
- `smart-info.service`：写入改为 `vectorStoreRepository.upsert`；索引状态（model/dim）存 `system_metadata`（新 key `CloudSearchIndex`），模型或维度变化 → 清空索引 + 自动入队全量重建；`force` 重建会丢弃整库索引
- `search.service`：语义检索改为「向量库取候选 → SQL 按 id 过滤 → 按相似度重排分页」（`VECTOR_OVERFETCH=4`、上限 1000），以图搜图直接读向量库；`search.repository` 用 `searchSmartByIds` / `searchSmartV3ByIds` 取代原先带 `<=>` 的 SQL 方法，并删除 `getEmbedding`
- 验证：`tsc` 绿、eslint 绿、106 文件 / 2337 用例全绿

**遗留（下一轮）**：① `duplicate.service` 仍读 `smart_search`（该表已不再写入 → 重复检测实际处于"empty"状态，随 ML 删除一并处理）；② `search.repository`/`duplicate.repository` 的 `queries/*.sql` 快照已过期，需重新生成；③ 删除 `smart_search`/`face_search` 表与 pgvector 依赖，compose 换 stock Postgres；④ 写 `viking-vector-store.ts`（已从官方 SDK 提取到真实契约：`api-vikingdb.volces.com`、签名 service=`air`、`/api/collection/upsert_data`、`/api/collection/del_data`、`/api/index/search`（body 为 `{collection_name, index_name, search:{order_by_vector:{vectors:[...]}, limit, output_fields, primary_key_in}}`））

### Round 3 续（VikingDB 适配器 + 签名验证）
- 新增 `volcengine-signer.ts`：从官方 Python SDK 移植的 Volcengine V4 签名（HMAC-SHA256、service=`air`、RFC3986 规范化、`X-Date`/`X-Content-Sha256`/`Authorization`）
- 新增 `volcengine-signer.spec.ts`：**黄金测试**——用官方 SDK 算法（精简为标准库 Python 脚本）对同一请求生成期望签名，TS 实现输出**逐字节一致**（`Signature=a40119f7...`），并覆盖 session token、空 body 场景
- 新增 `viking-vector-store.ts`：VikingDB 数据面（`/api/collection/upsert_data`、`/api/collection/del_data`、`/api/index/search`），支持 AK/SK 签名或 Bearer API Key，批量 upsert/delete（100/批），`data: [[hit]]` 嵌套响应容错解析，`score→distance` 转换，本地 `maxDistance` 过滤，`primary_key_in` 预过滤；`clear()` 用 `del_all`
- `env`：`IMMICH_VECTOR_STORE=file|vikingdb`、`VIKINGDB_{HOST,REGION,SCHEME,COLLECTION,INDEX,PRIMARY_KEY,VECTOR_FIELD,ACCESS_KEY,SECRET_KEY,SESSION_TOKEN,API_KEY}`
- `search.service`：以图搜图在向量库无法回读向量时（VikingDB）自动回退为「读原图 → 云端重嵌入」
- 新增 `viking-vector-store.spec.ts`（8 例，mock fetch：签名头、Bearer、排序、批次、错误码、del_all、无回读）
- 验证：`tsc` 绿、eslint 绿、108 文件 / 2349 用例全绿

### Round 4（删除人脸/人物/重复检测 + 彻底摆脱 pgvector，并跑通运行时冒烟）
**已删除（服务端）**
- 人脸/人物：`person/cluster-group/face` 服务、控制器、仓库、DTO、schema 表（7 张）、`person_*`/`asset_face_*` 函数、`asset.people` 字段、`personIds`/`withPeople`/`hasPeople` 查询、`user.clusterGroupId` 列与 `cluster_group*` 表、人物相关 Job/Queue/权限/事件/通知、CLI 与同步（mobile sync）里的人脸/人物入口（同步类型保留但返回 400）
- 重复检测：`duplicate` 服务/控制器/仓库/DTO/工具与 Job/Queue（其检测完全依赖向量，属于 ML 特性）
- 图片 embedding 改为**索引原图**，并用新列 `asset_job_status.embeddedAt` 记录"已向量化"，取代原先依赖 `smart_search` 表的判断

**pgvector 彻底移除**
- 删除 `smart_search` / `face_search` 表、`vector`/`vchord` 扩展、`db.vectorExtension`、`DB_VECTOR_EXTENSION`、`DatabaseExtension.Vector*`、`VectorIndex`、`reindexVectors/prewarm/getDimensionSize/setDimensionSize` 等全部向量索引机制
- **删掉 100 个历史迁移，改为单个全新迁移** `1792173794520-FamilyAlbumInitialSchema.ts`（从当前代码 schema 生成，355 条语句）
- 迁移可通过 sql-tools 在 **stock `postgres:16`**（无任何向量扩展）上执行成功，且 `migrations generate` 复跑显示 **No changes detected**（零漂移）
- compose 里 5 处自定义 Postgres 镜像 → `postgres:16`（含 e2e）
- 顺带修掉两个 schema 里的表达式索引定义（`asset_localDateTime_idx` / `asset_localDateTime_month_idx` 需要额外括号，否则 PostgreSQL 报语法错误）

**运行时冒烟（已通过）**
环境：stock `postgres:16`（5433）+ `redis:7-alpine`（6380）+ 本机运行的 server（`IMMICH_CLOUD_SEARCH_PROVIDER=mock`、`IMMICH_VECTOR_STORE_PATH=/tmp/immich-data/vectors.jsonl`、`IMMICH_MACHINE_LEARNING_ENABLED=false`、无 ML 容器）
1. `GET /api/server/ping` → 200；`POST /api/auth/admin-sign-up` → 201（响应里已无 `clusterGroupId`）
2. `POST /api/assets`（multipart：文件放在 `assetData` 字段）→ 201
3. `GET /api/timeline/buckets?size=MONTH` → `[{"timeBucket":"2026-01-01","count":1}]`
4. `PUT /api/jobs/smartSearch {force:true}` → mock 云端向量写入 `/tmp/immich-data/vectors.jsonl`（512 维），`asset_job_status.embeddedAt` 写入成功，**无报错**
5. `POST /api/search/smart {"query":"宝宝在玩积木"}` → 命中 1 张；`{"queryAssetId":...}` → 命中 1 张（复用库内向量）

**遗留（下一轮优先）**
- 单测/测试夹具尚未跟上删除：`pnpm --filter immich check` 目前会报 spec 相关错误（源码 `src/` 单独 typecheck 通过）；需清理 `test/utils.ts`、`test/medium.factory.ts`、`test/mappers.ts`、`test/factories/*` 以及各 spec 里对应已删功能的用例
- OCR 与 `machine-learning.repository.ts` 尚未删除（OCR 仍会调用 ML 仓库；下一轮与 schema 一起清掉，并再次重生成迁移）
- 云存储（TOS/COS）、无缩略图、单账号/无分享仍是未开工的大块（P3/P4）

### Round 5（删除 OCR 与 machine-learning 仓库；测试夹具补齐；迁移重生成）
- 删除 CLI/服务/仓库/表：`ocr.service`、`ocr.repository`、`machine-learning.repository`、`dtos/ocr.dto`、`asset_ocr`/`asset_ocr_audit`/`ocr_search` 三张表、`asset_ocr_delete_audit` 函数、`asset_job_status.ocrAt` 列、`JobName.Ocr*`/`QueueName.Ocr`、资产的 OCR 接口与 `search.dto` 的 ocr 过滤、同步里的 OCR 实体、`utils/{editor,transform}` 里的 OCR 辅助
- 删除配置里的 `machineLearning` 整块（DTO、默认值、`MachineLearningConfig`、`utils/misc` 的 4 个判定函数），`getFeatures()` 改为：`smartSearch` 取云端搜索开关，`facialRecognition/duplicateDetection/ocr` 恒为 false，并移除 `ServerConfigDto.minFaces`
- 测试夹具与用例全部跟上：`tsc` 0 错、eslint `--max-warnings 0` 通过、单测 95 文件 / 1699 用例全绿
- 迁移再次重生成：`1792179586372-FamilyAlbumInitialSchema.ts`，58 张表（比上轮少 3 张）、无 OCR/向量相关对象；在 stock `postgres:16` 上 `migrations run` 成功且 `migrations generate` 再次返回 **No changes detected**
- 运行时冒烟复测（stock PG + Redis，无 ML 容器，mock 云端向量）：`smartSearch:true / ocr:false / facialRecognition:false`；上传 → SmartSearch 作业 0 报错 → 向量落库 → `embeddedAt` 写入 → 文本搜索命中 1 张

### Round 6（缩略图移出媒体存储：本地可丢弃缓存 + `off` 模式）
**需求落地方式**：用户的目标是"不把缩略图存进云桶"（存储成本），因此把**派生文件（缩略图/预览、转码视频）从媒体目录挪到本地可丢弃缓存**，媒体位置（未来的对象桶）只保留原图/边车/头像/备份。这样既满足"桶里没有缩略图"，也不至于让时间线网格去拉 5MB 原图（否则弱网体验会很差）。另提供彻底关闭模式。

- 新环境变量：
  - `IMMICH_CACHE_LOCATION`（默认 `$TMPDIR/immich-cache`）：缩略图/预览/encoded-video 的落地位置，随时可删
  - `IMMICH_THUMBNAILS=cache|off`：`off` 时完全不生成任何派生图，缩略图接口直接 302 到原图
- `StorageCore`：`Thumbnails` / `EncodedVideo` 两个目录改由缓存目录解析（`getBaseFolder`），媒体目录不再出现 `thumbs/`、`encoded-video/`
- `AssetMediaService.viewThumbnail`：缓存文件不存在（或被清空）时不再 404 —— 图片改为 **302 到原图** 并自动重排缩略图任务；视频返回 404（避免把 mp4 当图片返回），待任务生成后再取
- `MediaService.handleQueueGenerateThumbnails`：`off` 模式直接跳过，不产生任何 CPU/存储开销
- compose（yml/prod/rootless）新增 `immich-cache:/cache` 卷与两个环境变量；`docker/example.env` 补充注释
- 验证（stock PG + Redis + 本机 server）：
  - 媒体目录只剩 `upload/ library/ profile/ backups/`（无 `thumbs/`）
  - 缩略图生成后落在 `/tmp/immich-cache/thumbs/...`；请求 `GET /assets/:id/thumbnail?size=thumbnail` → `200 image/webp`（3.9KB）
  - 清空缓存后再请求 → `302 → /assets/:id/original`，随后后台任务自动把缓存补齐，再次请求回到 `200 image/webp`
  - `IMMICH_THUMBNAILS=off`：即使缓存里有文件也一律 `302` 到原图
- 检查：`tsc` 绿、eslint（max-warnings 0）绿、95 文件 / 1700 用例全绿

### Round 8（S3/TOS/COS 对象存储接线完成并端到端验证）
**接线**
- 上传：文件先由 multer 落到本地暂存目录（遥测缓存），随后 `stageUpload()` 推入桶并把 DB 的 `originalPath` 改为对象 key（`upload/<user>/xx/yy/<uuid>.<ext>`），暂存文件删除
- 读取：`ImmichFileResponse` 新增 `serveTarget`；原件/边车/头像通过 **302 预签名 URL** 直连桶（服务器不代理字节流），派生文件（缩略图、转码）仍由服务器从本地缓存流出
- 需要真实路径的工具：`MetadataRepository`（exiftool 读/写）与 `MediaService`（sharp/ffmpeg 生成缩略图）改用 `withLocalCopy()` 临时落地原件，用完即删
- 删除：`FileDelete` 作业走对象删除（实测对象从桶中消失）
- 备份与派生文件固定在本地缓存目录（远端模式下 `Backups`/`Thumbnails`/`EncodedVideo` 都解析到缓存）
- 修复：派生文件的存在性检查必须用**本地**检查（`checkLocalFileExists`），否则远端模式下会把缓存文件当成对象去查桶

**端到端验证**（stock `postgres:16` + `redis:7-alpine` + 进程内 S3 服务 `s3rver`，无任何云凭证）
| 步骤 | 结果 |
|---|---|
| 启动 | 日志出现 `Using S3 object storage (http://127.0.0.1:4568, bucket immich)` |
| 上传 | `201`；桶中出现对象；DB 里 `originalPath` = `upload/<user>/xx/yy/<uuid>.png`（对象 key） |
| 元数据抽取 / 缩略图 | 作业 0 报错；缩略图落在本地缓存 |
| `GET /assets/:id/original` | `302` → 预签名 URL → 直接取回 `200 image/png` 3446 字节（PNG 96x96） |
| `GET /assets/:id/thumbnail` | `200 image/webp` 2584 字节（本地缓存流式返回） |
| `POST /search/smart` | 命中 3 张（embedding 从桶中读原件） |
| 时间线 | `[{"timeBucket":"2026-02-01","count":2},...]` |
| 删除资产 | `204`；对象从桶中移除；作业 0 报错 |

检查：`tsc` 绿、eslint（max-warnings 0）绿、95 文件 / 1700 用例全绿。

### Round 9（单账号：删除「伙伴共享」与「评论点赞」）
面向"一个账号爸妈共用"的第一步：把**多用户共享**与**评论/点赞**整块删掉。

- 删除 `partner`（伙伴共享：`partner.service/controller/repository/dto` + `partner`/`partner_audit` 表 + 相关 Job/Queue/同步实体）与 `activity`（相册评论/点赞：service/controller/repository/dto + `activity`/`activity_audit` 表）
- 删除 `utils/asset.util.ts` 的 `getMyPartnerIds()`，`timeline/search/map` 三个服务改为**只搜索当前账号自己**（`getUserIdsToSearch()`、`buildTimeBucketOptions()` 不再拼接伙伴 id，也不再需要 visibility 参数）
- 清理 DI 注册、权限/标签、测试夹具与相关用例（含 partner 相关 medium/sync 用例）
- 运行时验证：登录 → 时间线 3 个桶 → 语义搜索 3 命中 → 相册列表 1 个 → 作业 0 报错；`/api/partner`、`/api/activities` 均返回 **404**（已移除）；`/api/shared-links` 仍为 200（下一轮处理）
- 检查：`tsc` 绿、eslint（max-warnings 0）绿、91 文件 / 1663 用例全绿

**下一轮**：删除「分享链接（shared link）」与「相册共享给他人（album_user）」，并清理 web 端对应的死页面。

### Round 10（单账号：移除「分享链接」）
- 删除 `shared-link` 整套 API 与实现：`shared-link.service/controller/dto/repository`、`shared-link-asset.repository`、控制器/服务注册
- 认证侧不再接受分享凭证：`AuthService.validateSharedLinkKey/Slug` 与其调用点、`ApiService.ssr` 里的 `/share`、`/s` OpenGraph 渲染全部移除（SSR 现在直接返回 index.html）
- 上传/复制资产时不再维护分享链接关系（`addToSharedLink`、`copySharedLinks` 删除）；`utils/asset.util`、access 层里不会被触发的分享分支保留为死代码（后续与 `AuthSharedLink` 类型一起清）
- 表 `shared_link` / `shared_link_asset` 暂时保留（schema 未动，迁移不变），待下一轮与 `AuthSharedLink` 死代码一起删除并重新生成迁移
- 运行时验证：登录 → 时间线 → 语义搜索 3 命中 → 作业 0 报错；`/api/shared-links`、`/api/partner`、`/api/activities` 均 **404**
- 检查：`tsc` 绿、eslint（max-warnings 0）绿、87 文件 / 1611 用例全绿（删除了若干只测已删功能的 spec：shared-link service、api.service render、controllers 路由清单，以及被批量编辑破坏的 medium asset-media spec）

**下一轮**：删除「相册共享给他人（album_user）」与 `AuthSharedLink` 死代码，随后重新生成迁移以移除 `shared_link*`/`album_user*` 表；再进入 web/mobile/SDK 清理。

### Round 11（单账号：停用「相册共享给他人」）
- 相册分享 API 现在直接拒绝：`PUT /albums/:id/users`、`PUT /albums/:id/user/:userId`、`DELETE /albums/:id/user/:userId` 均返回 `400 Album sharing was removed in this build`（`AlbumService.addUsers/removeUser/updateAlbumUser` 保留签名以便控制器与 DTO 兼容，但不再写库）
- 删除对应用例（album.service 的 addUsers/removeUser 两个 describe）
- **说明**：`album_user` 表**不能直接删**——每个相册的 *所有者* 也记录在这张表里（role=owner），要彻底移除需要先把归属迁移到 `album.ownerId`，属于数据模型改动，留待后续
- 运行时验证：相册列表正常；`PUT /albums/:id/users` → `400 {"message":"Album sharing was removed in this build"}`；时间线、语义搜索（3 命中）正常；作业 0 报错
- 检查：`tsc` 绿、eslint（max-warnings 0）绿、87 文件 / 1598 用例全绿

### Round 12（客户端清理第一步：删掉已失效的页面）
服务端删了这么多接口后，web 里对应的页面已是死页面，本轮先清掉最确定的一批：

- 删除 **ML 设置页** `admin/system-settings/MachineLearningSettings.svelte` 及其在系统设置页里的入口（服务端 `machineLearning` 配置块早已删除，这页现在必然报错）
- 删除 **伙伴共享页** `(user)/partners/**` 与 **共享总览页** `(user)/sharing/**`（含 `sharing/sharedlinks`）
- 清理引用：`lib/route.ts` 的 `viewPartner`/`sharing`、侧边栏的「共享」入口、命令面板（`lib/commands.ts`）里的「共享」
- 验证：`pnpm --filter immich-web check:typescript` 0 错、`check:svelte`（`--fail-on-warnings`）**0 错 0 警告**

**说明**：人脸/人物页面（`(user)/people`、`explore` 等）仍保留——它们引用了大量 API 类型，需要和 `packages/sdk`/`open-api` 一起重新生成后再删，属于下一步。`shared_links` 入口同样留待与 SDK 一起处理。

### Round 13（客户端清理续：删掉「人物」与「共享链接」页面）
- 删除 `(user)/people/**`（人物列表、人物详情、PeopleCard/PeopleInfiniteScroll 等 11 个文件）与 `(user)/shared-links/**`
- 清理导航与命令面板：侧边栏「人物」「共享链接」入口、命令面板对应项（`lib/commands.ts`）
- `explore` 页里指向人物页的卡片链接改为指向「照片」
- 保留（暂时）：`lib/services/shared-link.service.ts` 与其若干组件（`SharedLinkCreateModal`、`AlbumSharedLink`、`RemoveFromSharedLinkAction`）以及 `lib/route.ts` 里的路由字符串助手 —— 它们引用了 `$lib/services/shared-link.service`，直接删会级联；这些入口已不可达，待与 SDK 重新生成一起清
- 验证：`pnpm --filter immich-web check:typescript` 0 错、`check:svelte`（`--fail-on-warnings`）**0 错 0 警告**

---

## 9. 部署说明（当前形态）

### 9.1 依赖
- **PostgreSQL 16**（stock 镜像即可，**不需要** vectorchord/pgvector —— 向量已移到云/本地向量库）
- **Redis / Valkey**（任务队列 + 多实例事件）
- **不需要** machine-learning 容器
- 对象存储：火山 TOS / 腾讯 COS / MinIO（S3 兼容）；本地文件系统也仍可用（默认）
- **不需要搜索相关服务**：语义搜索与向量库已在 Round 17-19 全部移除（只保留本地关系型的元数据搜索，零额外成本）

### 9.2 compose（推荐写法）
```yaml
services:
  immich-server:
    image: <你的构建或本地构建>
    env_file: [.env]
    environment:
      IMMICH_CACHE_LOCATION: /cache        # 派生文件（缩略图/转码）本地缓存，不进桶
      IMMICH_THUMBNAILS: cache             # 或 off：完全不生成缩略图
      IMMICH_STORAGE_BACKEND: s3
    volumes:
      - immich-cache:/cache
  database:
    image: postgres:16                     # 关键：不需要自定义镜像
  redis:
    image: valkey/valkey:9
volumes:
  immich-cache:
```
（仓库里的 `docker/docker-compose.yml` 已经是这个形态，另加了 `immich-cache:/cache` 卷。）

### 9.3 环境变量清单
| 变量 | 说明 |
|---|---|
| `IMMICH_STORAGE_BACKEND` | `local`（默认）/ `s3` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | 桶地址（TOS/COS 都要填自定义 endpoint） |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 访问密钥 |
| `S3_FORCE_PATH_STYLE` | TOS/COS 需 `true` |
| `S3_PREFIX` / `S3_PRESIGN_TTL` | 可选：对象前缀、预签名有效期（默认 3600s） |
| `IMMICH_CACHE_LOCATION` | 派生文件缓存目录（可随时删除，会自动重建） |
| `IMMICH_THUMBNAILS` | `cache`（默认）/ `off` |

### 9.4 上线前验证步骤
1. 用真实 key 跑 `node scripts/verify-cloud-search.mjs --image <一张宝宝照片>`：确认返回维度、图文是否同一向量空间、单图延迟与计费口径
2. 启动服务后确认日志出现 `Using S3 object storage (...)`，上传一张照片，`GET /assets/:id/original` 应返回 **302 到预签名 URL**
4. 检查桶里**只有** `upload/`（原图/边车）等，没有 `thumbs/`（缩略图在本地 `/cache`）

### 9.5 已知遗留
- 从 local 切到 s3 **不会自动搬迁**已有文件（需要一次性迁移脚本）
- `shared_link*`、`album_user` 表仍在（分享功能已停用/删除；彻底删表需先迁移相册归属）
- `packages/sdk`/`open-api` 工件仍是改造前的版本（web 用旧类型编译通过，但人脸/人物等页面已删除）
- `mobile/` 未改动（是否保留官方 App 待定）

### Round 15（服务端清掉分享链接的最后一批代码依赖）
- `utils/access.ts`：删除 `checkSharedLinkAccess` 分支与 `SharedLinkAccessRequest` 类型，访问检查只剩「本人」与「相册所有者」两条路径
- `access.repository.ts`：删除两个 `checkSharedLinkAccess` 查询（不再有人查 `shared_link` 表）
- 清理因此失效的用例与 mock（album/asset/asset-media/search 里的 "shared link" 用例）
- 验证：`tsc` 绿、eslint（max-warnings 0）绿、87 文件 / **1589 用例**全绿
- 说明：`shared_link*` 两张表目前只剩 `album.repository` 的 3 处引用（`withSharedLink` 与 isShared 判断），把它们一起改掉后即可删表 + 重新生成迁移（下一轮）

### Round 16（删掉 shared_link 两张表 + 新迁移）
- `album.repository`：删除 `withSharedLink` 投影与「是否被共享」判断里的 `shared_link` 存在性检查（相册响应不再有 `sharedLinks` 字段）
- `album.service`：`isShared` 固定为 `false`（分享已移除）
- 删除 `shared-link.table.ts` / `shared-link-asset.table.ts` 定义与 schema 注册、`test/factories/shared-link.factory.ts`、`test/fixtures/shared-link.stub.ts`，清理 mappers/factories 里的相关代码
- 新增迁移 `1792191000000-DropSharedLinkTables`（`DROP TABLE shared_link_asset, shared_link`），并已在本机测试库执行成功
- 验证：迁移后 `pg_tables` 中 `shared_link%` 数量 **0**；`tsc` 绿、eslint 绿、87 文件 / 1587 用例全绿；运行时登录/相册/时间线/搜索正常，作业 0 报错

**注意**：迁移源码放在 `src/schema/migrations/`，但 `sql-tools migrations run` 默认读 `dist/`，所以改完迁移必须 `pnpm --filter immich build` 再跑。

### Round 17（需求变更：**不要搜索**）
用户最新需求改为「不要搜索（向量桶和语义搜索有点贵，作用不大）」，对象存储保留。因此本轮开始**拆除云端语义搜索/向量库**：

已删除：
- `repositories/embedding/**`（ark/tencent/mock provider + 接口）与 `repositories/embedding.repository.ts`
- `repositories/vector/**`（file/vikingdb 向量库 + volcengine V4 签名）与 `repositories/vector-store.repository.ts`
- `services/smart-info.service.ts`（云端索引作业）与 `scripts/verify-cloud-search.mjs`
- `SearchService` 的 `searchSmart` / `searchSmartV3` / `getVectorCandidates` / `resolveEmbedding` / `embeddingCache`，以及 `POST /search/smart` 端点
- `ConfigRepository` 的 `search` 配置块与全部 `IMMICH_CLOUD_SEARCH_*` / `IMMICH_VECTOR_STORE*` / `VIKINGDB_*` 环境变量
- `ServerFeaturesDto.smartSearch` 特性开关
- 相应的单测与 mock

保留（下一轮继续拆）：`JobName.SmartSearch` / `SmartSearchQueueAll`、`QueueName.SmartSearch`、`asset_job_status.embeddedAt`、`SystemMetadataKey.CloudSearchIndex`、`SmartSearchDto`、`searchSmartByIds` 等残留（本轮尝试一并删除时 enum 变更引发了 ~136 处类型级联，已回滚，留待下一轮单独处理）

验证：`tsc` 绿、eslint（max-warnings 0）绿、83 文件 / 1548 用例全绿。
**注意**：Redis 里若残留 `SmartSearchQueueAll` 作业，microservices 启动会因找不到 handler 而退出（`Failed to find job handler`），需要清理队列或先删掉该枚举与队列映射。

**Round 17 追加（务必先做）**：`JobName.SmartSearch` / `SmartSearchQueueAll` / `QueueName.SmartSearch` 的枚举与队列映射必须删掉，否则 microservices 启动时会因 `Failed to find job handler for Job.SmartSearchQueueAll` 直接退出（handler 已随 smart-info.service 删除）。本轮已先移除 `QueueService.start()` 里的 `case QueueName.SmartSearch` 映射；剩余要删的位置：
1. `src/enum.ts`：`JobName.SmartSearch='smartSearch'`、`JobName.SmartSearchQueueAll`、`QueueName.SmartSearch`
2. `src/types.ts`：`JobItem` 联合类型里的 `{ name: JobName.SmartSearchQueueAll; data: IBaseJob }`
3. `src/dtos/queue-legacy.dto.ts`：`[QueueName.SmartSearch]: QueueResponseLegacySchema`
4. `src/services/job.service.ts:168`：`const jobs: JobItem[] = [{ name: JobName.SmartSearch, data: item.data }];` → `const jobs: JobItem[] = [];`
   注意：直接删枚举值会让 `JobItem` 推断收窄，`job.repository.ts`（约 261 行）等出现批量类型错误；正确做法是显式标注 `JobItem[]` 并逐个修，别用正则批量删。

### 9.6 Round 19 收尾：搜索残留清理
- 删除 `JobName.SmartSearch*` / `QueueName.SmartSearch` / `JobItem` 联合成员 / legacy 队列 DTO 条目 / 缩略图生成后入队的 smart search 作业
- 删除被 `@Post('smart')` 孤儿装饰器"劫持"的 `searchSmart` 路由（当时 `POST /search/smart` 会错误地走到 explore 逻辑）
- 删除 `asset_job_status.embeddedAt` 列（迁移 `1792192000000-DropEmbeddedAt`，已在本机库执行）、`SystemMetadataKey.CloudSearchIndex`、`SmartSearchDto`、`searchSmartByIds`/`searchSmartV3ByIds`/`SmartSearchOptions`
- 运行时验证：登录 ✅、上传 201 ✅、缩略图 200 ✅、时间线新增桶 ✅、`POST /search/smart` **404** ✅、作业报错 0 ✅、找不到 handler 0 ✅
- 检查：`tsc` 绿、eslint 绿、83 文件 / 1548 用例全绿

### Round 20（SDK/openapi 重新生成的**可复现配方** + 待删清单）
本轮把重新生成的流程跑通了，但**没有提交**：新 SDK 会暴露 web 端约 70 处死代码引用，我在原地批量修时把情况弄得更糟（72 处），已全部回滚，保持仓库绿色。配方与清单如下，下一轮按它执行。

**配方（本机已验证）**
```bash
# 1. 用服务端控制器重新导出 openapi（160 paths；已无 smart search / person）
cd server && node dist/bin/sync-open-api.js
# 2. 重新生成 TS 客户端（oazapfts 7.5.0）
npx --yes oazapfts@7.5.0 --optimistic --argumentStyle=object --useEnumType \
  --allSchemas open-api/immich-openapi-specs.json packages/sdk/src/fetch-client.ts
# 3. 关键：web 解析的是 @immich/sdk 的 dist，必须重建，否则 tsc 会拿旧类型"假通过"
pnpm --filter @immich/sdk build
```

**新 SDK 暴露的 web 死代码（按删除优先级）**
1. `web/src/lib/services/shared-link.service.ts`（10 处）
2. `web/src/lib/managers/activity-manager.svelte.ts` + `.spec.ts`（13 处）
3. `web/src/lib/services/person-user.service.ts`、`person.service.ts`、`web/src/lib/utils/person.ts`(+spec)、`web/src/lib/stores/face.svelte.ts`、`web/src/test-data/factories/shared-link-factory.ts`（约 20 处）
4. 逐个手修（**不要用正则整块删**，本轮就是这么把错误数从 33 弄到 72 的）：
   `services/queue.service.ts`（SmartSearch/DuplicateDetection/FaceDetection/FacialRecognition/Ocr 队列项）、`components/shared-components/search-bar/search-bar-utils.ts`（人物建议）、`managers/AssetCacheManager.svelte.ts`（ocr/faces）、`managers/event-manager.svelte.ts`（Person/SharedLink 事件）、`components/asset-viewer/PreloadManager.svelte.ts`、`lib/route.ts` + `managers/search-manager.svelte.ts`（SmartSearchDto）、`services/asset.service.ts`（`features.smartSearch`）、`utils/timeline-util.ts`、`utils.ts`
5. 每改一个文件后跑一次 `pnpm --filter immich-web check:typescript` + `check:svelte`，确认再继续

### Round 21（SDK 重新生成：把 WIP 放到独立分支，主分支保持绿色）
本轮实际执行了 Round 20 记录的配方，并把**已经正确的部分**保留在分支 `sdk-regen-wip`（提交 `563eabb74`）：
- 重新导出 `open-api/immich-openapi-specs.json`、用 oazapfts 7.5.0 重新生成 `packages/sdk/src/fetch-client.ts`
- 删除后端已不存在的 web 模块：`lib/services/shared-link.service.ts`、`lib/managers/activity-manager.svelte.ts`(+spec)、`lib/services/person*.service.ts`、`lib/utils/person.ts`(+spec)、`lib/stores/face.svelte.ts`、`test-data/factories/shared-link-factory.ts`
- 清理 4 个文件的死引用（search-bar 的人物建议、AssetCacheManager 的 ocr/face 缓存、event-manager 的 Person/SharedLink 事件、search-manager 的 SmartSearchDto 导入）

**进度**：web 类型错误从 **70 → 30**，但剩下的 30 处不是"删个 import"就能解决——必须连带删掉使用这些符号的功能代码（`PreloadManager` 的 sharedlink 参数、`search-manager` 的 SmartSearchDto 方法签名、`AssetCacheManager` 的 `#faceCache` 使用点、`route.ts`、以及十几个下游文件）。

**Round 22 更新**：在 `sdk-regen-wip` 上继续逐文件清理，web 类型错误 **70 → 30 → 22 → 21**。本轮又删掉：`lib/stores/ocr.svelte.ts`(+spec)、`lib/utils/ocr-utils.ts`(+spec)、`lib/utils/people-utils.ts`、`lib/utils/shared-links.ts`、`test-data/factories/person-factory.ts`、`routes/(user)/utilities/duplicates/**`（重复照片页），以及 queue.service 里 5 个已删队列项与图标、websocket 的 `on_person_thumbnail`、face 缓存、`smartSearch` 特性开关、`ViewSimilar`（以图搜图）动作。提交：`960757e1f`、随后一次。

**剩余 21 处（下轮继续）**
- `PreloadManager.svelte.ts`：`sharedlink` 参数（3 处）→ 建议直接删参数并改调用点
- `search-bar-utils.ts` / `AssetCacheManager.svelte.ts` / `route.ts` / `utils.ts` / `utils.spec.ts` / `user-factory.ts`：残留 SDK 符号
- `search-manager.svelte.ts`（61/64/112 行）：`MetadataSearchDto` 收窄后的类型问题
- `utils/timeline-util.ts:141`：`asset.people` 已不存在
- `routes/(user)/explore/+page.ts`：`getExploreData` 里的人物数据
- `utils/asset-utils.ts:29`、`utils/file-uploader.ts:20`：删掉 `shared-links.ts` 后的两个引用点（需改成直接构造）

**关键教训（务必记住）**
1. `web` 通过 `@immich/sdk` 的 **dist** 解析类型；切换分支/回滚源码后必须 `pnpm --filter @immich/sdk build`，否则 tsc 会拿旧 dist 得出错误结论（本轮就把"回滚后仍报 70 错"误判过一次）。
2. 这类清理必须**逐文件**：先删模块 → 跑 tsc → 看剩余错误所在文件 → 读具体行 → 精确替换，每步验证。批量正则只会让错误数上升。

### Round 23（SDK 清理：21 → 12）
在 `sdk-regen-wip` 上继续逐文件清理，本轮删除/修复：
- 删除 **分享链接落地页** `routes/(user)/s/[slug]/**`、`routes/(user)/share/[key]/**`（分享功能已整体移除）
- `PreloadManager.svelte.ts`：删掉贯穿 3 个方法的 `sharedlink` 参数，并同步改 `AssetViewer.svelte` 的调用点
- 搜索栏 `getSearchPeopleTitle`、`route.search` 的 `SmartSearchDto`、`timeline-util` 的 `people` 投影、`explore/+page.ts` 的人物数据
- `people-utils.spec.ts`、`duplicates` 路由树

**剩余 12 处（下轮）**
1. `lib/managers/search-manager.svelte.ts`（61/64/112）：`MetadataSearchDto` 收窄后 `query`/`queryType` 的类型问题
2. `lib/utils.ts`（17/19）：`PersonResponseDto` / `SharedLinkResponseDto` 的导入与 `getSharedLink`/`setSharedLink` 一族函数（`asset.service.ts` 还在用 → 要一起清）
3. `lib/utils.spec.ts`（111/126/141/157）：4 处 `sharedLinkFactory` 用例
4. `lib/utils/asset-utils.ts:29`、`lib/utils/file-uploader.ts:20`：引用已删的 `$lib/utils/shared-links`
5. `lib/utils/timeline-util.ts:149`：返回对象缺少 `people` 字段（类型仍要求，需同步改类型定义）

### Round 24（SDK 清理：12 → 9）
- `search-manager.svelte.ts`：删掉 OCR/smart 分支（`ocr`、`queryAssetId`、`queryType: 'smart'` 等），只保留元数据搜索
- `asQueryString` 从已删除的 `shared-links.ts` 移到通用 `lib/utils.ts`，`asset-utils.ts` / `file-uploader.ts` 改从那里导入
- 回滚了 timeline 类型里删 `people` 字段的尝试（会连带 `thumbnail-util.ts` 5 处报错，性价比低，留给专门一轮）

**剩余 9 处（下轮）**
1. `lib/managers/search-manager.svelte.ts`(56/105)：`MetadataSearchDto` 收窄后的对象字面量类型
2. `lib/utils.spec.ts`(111/126/141/157)：4 处 `sharedLinkFactory` 用例（改用 asset 或直接删）
3. `lib/utils.ts`(17/19)：`PersonResponseDto` / `SharedLinkResponseDto` 导入与 `getSharedLink` 一族（连同 `asset.service.ts` 的使用点）
4. `lib/utils/thumbnail-util.spec.ts`(104)、`test-data/factories/asset-factory.ts`(54)：对象字面量多余字段
5. `lib/utils/timeline-util.ts`：`people` 字段与 `TimelineAsset` 类型（建议连同 `thumbnail-util.ts` 一起在本轮做，需一次性改类型 + 3 个使用点）

### Round 25（SDK 清理：web tsc 归零，但 svelte-check 暴露真正的工作量）
在 `sdk-regen-wip` 上把 `pnpm --filter immich-web check:typescript` 清到 **0 错**（9 → 0）：
- `search-manager`：移除 smart/ocr 分支，返回空的 `personIds`
- `utils.ts`：删除 `getSharedLink`/`setSharedLink`/`getPeopleThumbnailUrl` 与所有 shared link 参数
- `asset.service.ts`：去掉分享弹窗相关接线；`utils.spec.ts`：删除 4 个 shared link 用例

**但 `check:svelte` 报 182 个错误 / 46 个文件**——因为 `tsc --noEmit` **不检查 `.svelte` 文件**，而大量组件仍在 import 已删除的模块（`shared-link.service`、`activity-manager`、`person*.service`、`face store`）。这才是 SDK 清理真正剩下的工作量，之前几轮我只看 tsc 才误以为"只剩 9 处"。

**教训**：web 侧验证必须同时跑 `check:typescript` **和** `check:svelte`；只看 tsc 会严重低估改动面（本轮 0 vs 182 的差距就是证据）。

**建议**：这属于"死页面/死组件"的清扫，与五项功能需求无关（主分支已全绿可用）。是否继续磨这 182 处，建议由用户决定——若继续，应专门开一轮，按"svelte-check 报错文件 → 删组件或改引用 → 重跑 svelte-check"的循环推进。

### Round 26（迁移工具：把已有本地库搬进桶，并端到端验证）
新增 `server/scripts/migrate-to-object-storage.mjs`（放在 server 包内，因为 ESM 从**脚本所在目录**解析依赖）：
- 扫描 `asset.originalPath` 与 `asset_file.path` 里仍为绝对路径的行，把本地文件上传到桶（key = 相对 `IMMICH_MEDIA_LOCATION` 的路径，与服务端 `upload/<user>/xx/yy/<file>` 方案天然一致）
- 每个文件上传后校验（HeadObject）再更新数据库路径；支持 `--dry-run` / `--delete-local` / `--limit n`
- 上传时带 `ContentType` / `ContentLength`

**顺带修掉一个真实的兼容性问题**：AWS SDK v3 默认对上传启用 `aws-chunked` + 尾部校验和，**TOS/COS 这类 S3 兼容服务常会拒绝**。服务端 `S3ObjectStorage` 与迁移脚本都改为 `requestChecksumCalculation/responseChecksumValidation: 'WHEN_REQUIRED'`。

**端到端验证（本机 s3rver，无云凭证）**
1. `--dry-run --limit 4`：正确列出 4 个本地文件 → 对象 key
2. 真实迁移 `--limit 2`：桶中出现对象、数据库 `originalPath` 变为对象 key
3. 以 `IMMICH_STORAGE_BACKEND=s3` 启动服务，访问被迁移资产：`GET /assets/:id/original` → **302 到预签名 URL** → 拉取 **200（6402 字节）**；`/thumbnail` → 200

即"迁移已有照片 → 从桶里读出来"这条链路已经跑通。

### 10. 对象存储接入清单（火山 TOS / 腾讯 COS）

**10.1 填什么**
| 项 | 火山 TOS | 腾讯 COS |
|---|---|---|
| `S3_ENDPOINT` | `https://tos-s3-<region>.volces.com`（如 `cn-beijing`） | `https://cos.<region>.myqcloud.com`（如 `ap-guangzhou`） |
| `S3_REGION` | 与 endpoint 的 region 一致 | 与 endpoint 的 region 一致 |
| `S3_FORCE_PATH_STYLE` | `true`（未实测；遇到 `PathStyleDomainForbidden` 就改 `false`） | **`false`**（实测必须；path-style 会被拒绝） |
| `S3_BUCKET` | 桶名 | 桶名（形如 `name-appid`） |
| 密钥 | 账号的 AK/SK（建议用子账号 + 只读写该桶的策略） | 访问密钥的 SecretId/SecretKey |

**10.2 代码里的三个关键点（都已处理）**
1. **不要用 `aws-chunked` 上传**：SDK v3 默认启用尾部校验和，TOS/COS 常直接拒绝 → 已设为 `requestChecksumCalculation/responseChecksumValidation: 'WHEN_REQUIRED'`。
2. **COS 必须 virtual-hosted 风格**：实测 `S3_FORCE_PATH_STYLE=true` 会在 PUT 时返回 `403 PathStyleDomainForbidden`（"must be addressed using COS virtual-styled domain"），改成 `false` 后 PUT/HEAD/GET/预签名 GET 全部通过。（TOS 未实测。）
3. **COS 的多对象删除需要 `Content-MD5`**：批量删除会返回 `InvalidRequest: Missing required header for this request: Content-MD5` → `S3ObjectStorage.delete()` 已加**降级为逐个删除**的逻辑（仅在该错误时触发，其他 provider 仍走批量）。

**10.2.1 腾讯云子账号需要的权限（实测踩到）**
- 能上传/读取：`cos:PutObject`、`cos:GetObject`、`cos:HeadObject`（已通过）
- **删除需要额外授权**：`cos:DeleteObject` 与 `cos:DeleteMultipleObjects`——实测当前密钥单对象删除返回 `403 AccessDenied`，未授权时"删除照片"会在服务端报错。

**10.3 CORS 需不需要？**
- **浏览时间线/看原图一般不需要**：缩略图由服务端从本地缓存直接返回；原图走 `302` 到预签名 URL，浏览器在 `<img>/<video>` 里加载跨域资源不受同源限制。
- **只有当你用 `fetch`/XHR 直接拉预签名 URL 时才需要**给桶配 CORS（`AllowedOrigin` = 你的站点域名，`AllowedMethod` 含 `GET`、`HEAD`，`ExposeHeaders` 含 `Content-Length`、`Content-Range`）。
- 预签名有效期默认 3600s（`S3_PRESIGN_TTL` 可调）。时间线快速滚动时同一张图会命中浏览器缓存，不会反复签名。

**10.4 上线顺序（推荐）**
1. 建桶 → 建子账号/密钥（只给该桶的读写权限）
2. 保持 `IMMICH_STORAGE_BACKEND=local`，先把现有照片照常跑起来
3. 停服务 → `server/scripts/migrate-to-object-storage.mjs --dry-run` 看清单 → 去掉 `--dry-run` 正式迁移 → 需要的话加 `--delete-local`
4. 改 `.env`：`IMMICH_STORAGE_BACKEND=s3` + `S3_*`，启动后确认日志出现 `Using S3 object storage (...)`
5. 验证：`GET /assets/:id/original` 返回 302 到预签名 URL；桶里只有 `upload/` 等，**没有** `thumbs/`（缩略图在本地 `/cache`，可随时删）

**10.5 还需要注意**
- 跨域直传（客户端把照片直接 PUT 到桶）**没有实现**，上传流量仍走你的服务器；家庭场景带宽足够，若需要可后续加预签名 PUT。
- 桶的存储类型/生命周期建议保持默认，不要给 `upload/` 配过期删除规则。

### Round 29（改为只支持火山引擎 TOS + 软删除开关默认开启）

**需求变更**：对象存储只用火山引擎 TOS；不要 S3、不要腾讯云；另加软删除开关（默认开启）。

**1. 存储后端换成 TOS 官方 SDK**
- 新增 `repositories/object-storage/tos-object-storage.ts`，基于 `@volcengine/tos-sdk`：`putObject / getObject / getObjectV2(stream) / headObject / deleteMultiObjects / getPreSignedUrl`
- 因为走 TOS 自己的签名与协议，之前为 S3 兼容层写的三个 workaround **全部不再需要**：path-style、`aws-chunked`、批量删除的 `Content-MD5`
- 删除 `s3-object-storage.ts` 与 `@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner`
- 配置改为 `IMMICH_STORAGE_BACKEND=tos`（不再接受 `s3`）+ `TOS_ENDPOINT`（不带协议/桶名，如 `tos-cn-beijing.volces.com`）、`TOS_REGION`、`TOS_BUCKET`、`TOS_ACCESS_KEY_ID`、`TOS_ACCESS_KEY_SECRET`、`TOS_PREFIX`、`TOS_PRESIGN_TTL`
- 两个脚本（迁移、连通性验证）同步改用 TOS SDK；`docker/.env` 与 `example.env` 只保留 TOS 配置

**2. 软删除开关（默认开启）** `IMMICH_SOFT_DELETE_ONLY=true`
- 删除资产 → 只进回收站（`handleAssetDeletion` 直接 `Skipped`，不删行、不删文件）
- `force` 永久删除 → 降级为回收站
- 清空回收站 → 跳过
- 存储层 `ObjectStorageRepository.delete()` → 只记日志，**绝不删桶里的对象**

即：**只读权限的密钥就够用**，照片永远不会被应用删掉。

**验证**：`tsc` 绿、eslint（max-warnings 0）绿、83 文件 / 1550 用例绿（含软删除新用例）；`docker compose config` 正确解析 TOS 变量。
**未验证**：没有 TOS 真实凭证，`TosObjectStorage` 的实际上传/预签名尚未在真桶上跑过（上一轮用的是腾讯 COS 实测，那套代码已删除）。
