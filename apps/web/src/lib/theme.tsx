// 前端多背景色主题模块：提供 6 套深色/浅色配色方案，持久化至 localStorage 并同步 ECharts 配色。
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "./i18n.tsx";

export type ThemeId = "slate" | "obsidian" | "forest" | "amethyst" | "snow" | "warm";

export interface ChartPalette {
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  legendText: string;
  axisLabel: string;
  axisLine: string;
  splitLine: string;
}

export interface ThemeOption {
  id: ThemeId;
  /** 对应 i18n 字典键，如 theme.slate */
  labelKey: string;
  /** 预览色块主背景色与强调色 */
  swatchBg: string;
  swatchAccent: string;
  isLight: boolean;
  chart: ChartPalette;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "slate",
    labelKey: "theme.slate",
    swatchBg: "#0f172a",
    swatchAccent: "#38bdf8",
    isLight: false,
    chart: {
      tooltipBg: "#0f172a",
      tooltipBorder: "#334155",
      tooltipText: "#f1f5f9",
      legendText: "#cbd5e1",
      axisLabel: "#94a3b8",
      axisLine: "#334155",
      splitLine: "#1e293b",
    },
  },
  {
    id: "obsidian",
    labelKey: "theme.obsidian",
    swatchBg: "#0a0a0c",
    swatchAccent: "#60a5fa",
    isLight: false,
    chart: {
      tooltipBg: "#111115",
      tooltipBorder: "#2e2e36",
      tooltipText: "#f4f4f5",
      legendText: "#d4d4d8",
      axisLabel: "#a1a1aa",
      axisLine: "#2e2e36",
      splitLine: "#1f1f26",
    },
  },
  {
    id: "forest",
    labelKey: "theme.forest",
    swatchBg: "#091713",
    swatchAccent: "#34d399",
    isLight: false,
    chart: {
      tooltipBg: "#0b1f19",
      tooltipBorder: "#254b40",
      tooltipText: "#ecfdf5",
      legendText: "#a7f3d0",
      axisLabel: "#86b8a8",
      axisLine: "#254b40",
      splitLine: "#163029",
    },
  },
  {
    id: "amethyst",
    labelKey: "theme.amethyst",
    swatchBg: "#131124",
    swatchAccent: "#a78bfa",
    isLight: false,
    chart: {
      tooltipBg: "#18152e",
      tooltipBorder: "#3b3668",
      tooltipText: "#f3f0ff",
      legendText: "#d8d0ff",
      axisLabel: "#a5a0cc",
      axisLine: "#3b3668",
      splitLine: "#252145",
    },
  },
  {
    id: "snow",
    labelKey: "theme.snow",
    swatchBg: "#f1f5f9",
    swatchAccent: "#0284c7",
    isLight: true,
    chart: {
      tooltipBg: "#ffffff",
      tooltipBorder: "#cbd5e1",
      tooltipText: "#0f172a",
      legendText: "#334155",
      axisLabel: "#475569",
      axisLine: "#cbd5e1",
      splitLine: "#e2e8f0",
    },
  },
  {
    id: "warm",
    labelKey: "theme.warm",
    swatchBg: "#f5f0e6",
    swatchAccent: "#b45309",
    isLight: true,
    chart: {
      tooltipBg: "#fffdf8",
      tooltipBorder: "#d8ccb6",
      tooltipText: "#292524",
      legendText: "#44403c",
      axisLabel: "#57534e",
      axisLine: "#d8ccb6",
      splitLine: "#e7dfd0",
    },
  },
];

const THEME_STORAGE_KEY = "lhm_theme";

export function isValidThemeId(value: string | null | undefined): value is ThemeId {
  return THEME_OPTIONS.some((opt) => opt.id === value);
}

export function getThemeOption(id: ThemeId): ThemeOption {
  return THEME_OPTIONS.find((opt) => opt.id === id) ?? THEME_OPTIONS[0]!;
}

export function detectInitialTheme(): ThemeId {
  if (typeof window === "undefined") return "slate";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isValidThemeId(saved)) return saved;
  } catch {
    // 忽略浏览器隐私模式下的存储访问异常
  }
  return "slate";
}

interface ThemeContextValue {
  theme: ThemeId;
  themeOption: ThemeOption;
  setTheme: (next: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "slate",
  themeOption: THEME_OPTIONS[0]!,
  setTheme: () => {},
});

export function ThemeProvider({
  children,
  initialTheme,
}: {
  children: ReactNode;
  initialTheme?: ThemeId;
}) {
  const [theme, setThemeState] = useState<ThemeId>(() => initialTheme ?? detectInitialTheme());
  const themeOption = useMemo(() => getThemeOption(theme), [theme]);

  const setTheme = (next: ThemeId) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // ignore storage error
      }
    }
  };

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = themeOption.isLight ? "light" : "dark";
    }
  }, [theme, themeOption.isLight]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themeOption, setTheme }),
    [theme, themeOption],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** 顶部快捷背景色切换器（支持一键点击色块切换，带无障碍语义与三语提示） */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <div className="theme-switcher" role="group" aria-label={t("shell.theme")}>
      {THEME_OPTIONS.map((opt) => {
        const label = t(opt.labelKey);
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            className={`theme-swatch ${active ? "active" : ""}`}
            style={{
              background: `linear-gradient(135deg, ${opt.swatchBg} 58%, ${opt.swatchAccent} 58%)`,
            }}
            title={label}
            aria-label={`${t("shell.theme")}: ${label}`}
            aria-pressed={active}
            onClick={() => setTheme(opt.id)}
          />
        );
      })}
    </div>
  );
}
