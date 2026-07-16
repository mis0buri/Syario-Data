// ── Xアーカイブ閲覧（管理者専用） ──
// 複数アカウントのXアーカイブをFirebase Storageのchunk JSONとして保存し、
// 混合時系列タイムラインとして閲覧する。UIは_isAdminでゲート、保存はstorage.rulesの
// 管理者UID許可リストで制御（Storageルールは/adminsを参照できないため直書き）。
// Storage構成: archives/manifest.json, archives/{username}/{YYYY-MM}.json

// ── 閲覧 ──
function initAdminXArchive() {
  if (!_isAdmin) return;
  // Phase 3で実装
}

// ── 追加（アップロード） ──
function initAdminXArchiveAdd() {
  if (!_isAdmin) return;
  // Phase 2で実装
}

// 以下はHTMLのonclickから参照されるスタブ（Phase 2/3で実装）
function xaClearDates() {}
function xaToggleOrder() {}
function xaApplyFilters() {}
function xaReload() {}
function xaClearCache() {}
function xaUpload() {}
