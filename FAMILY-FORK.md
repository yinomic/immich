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
