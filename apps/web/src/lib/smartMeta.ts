// 常见 ATA SMART 关键属性的三语中文/英文/日文释义与风险视觉级别辅助（仅用于可读性增强，不替代后端健康评分）
import type { SmartAttributeRow } from "./api.ts";
import type { Locale } from "./i18n.tsx";

interface SmartAttrDesc {
  zh: string;
  en: string;
  ja: string;
}

const SMART_ATTR_DESCRIPTIONS: Record<number, SmartAttrDesc> = {
  1: { zh: "底层读取错误率", en: "Raw read error rate", ja: "生読み込みエラー率" },
  2: { zh: "吞吐量性能", en: "Throughput performance", ja: "スループット性能" },
  3: { zh: "主轴起转耗时", en: "Spin-up time", ja: "スピンアップ時間" },
  4: { zh: "主轴启停次数", en: "Spindle start/stop count", ja: "スピンドル起動・停止回数" },
  5: {
    zh: "重映射扇区数（坏道替换，应为 0）",
    en: "Reallocated bad sectors (should be 0)",
    ja: "代替処理済みセクタ数（0 が正常）",
  },
  7: { zh: "寻道错误率", en: "Seek error rate", ja: "シークエラー率" },
  8: { zh: "寻道时间性能", en: "Seek time performance", ja: "シーク時間性能" },
  9: { zh: "累计通电小时数", en: "Power-on hours", ja: "累計通電時間" },
  10: {
    zh: "主轴起转重试次数（应为 0）",
    en: "Spin retry count (should be 0)",
    ja: "スピンアップ再試行回数（0 が正常）",
  },
  12: { zh: "通电冷启动次数", en: "Power cycle count", ja: "電源投入回数" },
  175: {
    zh: "闪存编程失败次数（应为 0）",
    en: "NAND program fail count (should be 0)",
    ja: "NAND プログラム失敗回数（0 が正常）",
  },
  177: { zh: "SSD 磨损均衡计数", en: "SSD wear leveling count", ja: "SSD ウェアレベリング回数" },
  180: { zh: "剩余保留块总数", en: "Unused reserved block count", ja: "未使用予備ブロック数" },
  183: { zh: "SATA 接口降速次数", en: "SATA downshift error count", ja: "SATA 速度低下回数" },
  184: {
    zh: "端到端数据校验错误（应为 0）",
    en: "End-to-end error count (should be 0)",
    ja: "エンドツーエンドエラー数（0 が正常）",
  },
  187: {
    zh: "无法校正错误计数（应为 0）",
    en: "Reported uncorrectable errors (should be 0)",
    ja: "訂正不能エラー回数（0 が正常）",
  },
  188: { zh: "命令超时次数", en: "Command timeout count", ja: "コマンドタイムアウト回数" },
  190: { zh: "气流/壳体温度", en: "Airflow temperature", ja: "エアフロー温度" },
  191: { zh: "冲击加速度传感器计数", en: "G-sense shock error count", ja: "衝撃検知回数" },
  192: { zh: "异常断电磁头回缩次数", en: "Power-off retract count", ja: "異常電源断退避回数" },
  193: {
    zh: "磁头归位加载/卸载次数",
    en: "Head load/unload cycle count",
    ja: "ロード/アンロード回数",
  },
  194: { zh: "硬盘当前温度（及历史最值）", en: "Drive temperature (with min/max)", ja: "ドライブ温度（最小/最大）" },
  196: {
    zh: "扇区重映射事件次数（应为 0）",
    en: "Reallocation event count (should be 0)",
    ja: "代替処理イベント回数（0 が正常）",
  },
  197: {
    zh: "待映射不稳定扇区（应为 0）",
    en: "Current pending unstable sectors (should be 0)",
    ja: "代替処理保留中セクタ数（0 が正常）",
  },
  198: {
    zh: "脱机不可修复扇区（应为 0）",
    en: "Offline uncorrectable sectors (should be 0)",
    ja: "回復不能セクタ数（0 が正常）",
  },
  199: {
    zh: "接口 UDMA CRC 校验错（线缆/接口问题）",
    en: "Interface UDMA CRC error count (cable/link)",
    ja: "UDMA CRC エラー数（ケーブル・接続異常）",
  },
  223: { zh: "磁头加载重试次数", en: "Load/unload retry count", ja: "ロード再試行回数" },
  231: { zh: "SSD 剩余寿命/磨损指标（厂商定义）", en: "SSD life left / wear indicator", ja: "SSD 寿命/摩耗指標" },
  233: { zh: "闪存介质磨损指标", en: "Media wearout indicator", ja: "メディア摩耗指標" },
  241: { zh: "累计宿主写入总量（LBA/厂商单位）", en: "Total host writes (vendor units)", ja: "総ホスト書き込み量" },
  242: { zh: "累计宿主读取总量（LBA/厂商单位）", en: "Total host reads (vendor units)", ja: "総ホスト読み込み量" },
};

export function getSmartAttrMeaning(attrId: number, locale: Locale): string {
  const entry = SMART_ATTR_DESCRIPTIONS[attrId];
  return entry ? entry[locale] : "—";
}

const CRITICAL_NONZERO_IDS = new Set([5, 10, 175, 184, 187, 196, 197, 198]);

/** 客观按 SMART 规范阈值/坏道计数返回视觉高亮级别（仅作醒目展示，不推断整机健康） */
export function getSmartAttrTone(attr: SmartAttributeRow): "critical" | "warning" | null {
  if (
    attr.value !== null &&
    attr.threshold !== null &&
    attr.threshold > 0 &&
    attr.value <= attr.threshold
  ) {
    return "critical";
  }

  const numericRaw = Number(attr.rawValue);
  if (CRITICAL_NONZERO_IDS.has(attr.attrId) && Number.isFinite(numericRaw) && numericRaw > 0) {
    return "critical";
  }
  if (attr.attrId === 199 && Number.isFinite(numericRaw) && numericRaw > 0) {
    return "warning";
  }
  if (attr.attrId === 193 && Number.isFinite(numericRaw) && numericRaw >= 200_000) {
    return "warning";
  }
  return null;
}
