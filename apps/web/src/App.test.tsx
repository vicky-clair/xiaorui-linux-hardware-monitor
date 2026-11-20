import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App, formatReadingValue } from "./App.tsx";

describe("App & reading formatting", () => {
  test("never renders null/missing readings as 0", () => {
    expect(formatReadingValue(null, "celsius", "missing")).toBe("— (无数据)");
    expect(formatReadingValue(0, "rpm", "valid")).toBe("0 RPM");
    expect(formatReadingValue(42.5, "celsius", "valid")).toBe("42.5 °C");
  });

  test("renders initial scaffold markup", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Linux Hardware Monitor");
    expect(html).toContain("v1.0");
  });
});
