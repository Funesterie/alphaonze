import { describe, expect, it } from "vitest";
import {
  buildQflushRgbaMultiload,
  buildQflushRgbaPacket,
  inferQflushRgbaFace,
  inferQflushRgbaKind,
} from "./rgbaCube.js";

describe("Qflush RGBA cube", () => {
  it("infers kind and face from common payloads", () => {
    expect(inferQflushRgbaKind("bonjour")).toBe("conversation");
    expect(inferQflushRgbaFace("conversation", "bonjour")).toBe("R");
    expect(buildQflushRgbaPacket({ payload: { tool: "fs.search" } }).face).toBe("G");
    expect(buildQflushRgbaPacket({ payload: { filename: "image.png" }, contentType: "image/png" }).face).toBe("B");
    expect(buildQflushRgbaPacket({ payload: { flow: "a11.chat.v1", steps: [] } }).face).toBe("A");
  });

  it("deduplicates identical payloads per session", () => {
    const plan = buildQflushRgbaMultiload([
      { sessionId: "s1", payload: { filename: "same.png" }, contentType: "image/png" },
      { sessionId: "s1", payload: { filename: "same.png" }, contentType: "image/png" },
      { sessionId: "s2", payload: { filename: "same.png" }, contentType: "image/png" },
    ]);

    expect(plan.count).toBe(2);
    expect(plan.droppedDuplicates).toBe(1);
  });

  it("keeps payload previews disabled by default", () => {
    const packet = buildQflushRgbaPacket({ payload: "private draft" });
    expect(packet.preview).toBeNull();
  });
});
