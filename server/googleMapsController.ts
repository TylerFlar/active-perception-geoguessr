import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { StreetViewAction, StreetViewMoveTarget, StreetViewState } from "../src/agent/types";
import { saveImageSnapshot, type SnapshotResult } from "./snapshotStore";

declare const document: any;
declare const window: { innerWidth: number; innerHeight: number };

export interface GoogleMapsStatus {
  open: boolean;
  streetView: boolean;
  currentUrl?: string;
  state: StreetViewState;
  lastSnapshotUrl?: string;
  message?: string;
}

export interface GoogleMapsSnapshot extends SnapshotResult {
  state: StreetViewState;
}

interface GoogleMapsControllerOptions {
  rootDir: string;
  startUrl: string;
}

interface ViewportSize {
  width: number;
  height: number;
}

const DEFAULT_VIEWPORT: ViewportSize = { width: 1280, height: 720 };
const STARTUP_TIMEOUT_MS = 45_000;
const MAPS_SETTLE_MS = 900;
const MIN_ACTION_SETTLE_MS = 500;

export class GoogleMapsController {
  private context?: BrowserContext;
  private page?: Page;
  private sessionId = nanoid(8);
  private lastSnapshotUrl?: string;
  private state: StreetViewState = buildStreetViewState(this.sessionId, DEFAULT_VIEWPORT);

  constructor(private readonly options: GoogleMapsControllerOptions) {}

  async open(url = this.options.startUrl): Promise<GoogleMapsStatus> {
    const page = await this.ensurePage(url);
    await page.bringToFront();
    await this.waitForMaps(page);
    this.state = await this.readState(page);
    return this.status();
  }

  async status(): Promise<GoogleMapsStatus> {
    const page = this.livePage();
    if (!page) {
      return {
        open: false,
        streetView: false,
        state: this.state,
        lastSnapshotUrl: this.lastSnapshotUrl,
        message: "Google Maps window is not open."
      };
    }

    this.state = await this.readState(page);
    const streetView = isStreetViewUrl(page.url());
    return {
      open: true,
      streetView,
      currentUrl: page.url(),
      state: this.state,
      lastSnapshotUrl: this.lastSnapshotUrl,
      message: streetView ? undefined : "Google Maps is open, but Street View is not selected."
    };
  }

  async capture(snapshotDir: string): Promise<GoogleMapsSnapshot> {
    const page = await this.ensurePage();
    await page.bringToFront();
    await this.waitForMaps(page);
    this.state = await this.readState(page);

    if (!isStreetViewUrl(page.url())) {
      return {
        state: this.state,
        warning: "Google Maps is open, but Street View is not selected."
      };
    }

    const viewport = await viewportSize(page);
    await addHudMasks(page, hudMaskRects(viewport));
    try {
      const data = await page.screenshot({
        fullPage: false,
        type: "jpeg",
        quality: 90,
        animations: "disabled"
      });
      const saved = await saveImageSnapshot({
        snapshotDir,
        data: Buffer.from(data),
        extension: "jpg"
      });
      this.lastSnapshotUrl = saved.publicUrl;
      return { ...saved, state: this.state };
    } finally {
      await removeHudMasks(page);
    }
  }

  async applyAction(action: StreetViewAction): Promise<GoogleMapsStatus> {
    if (action.type === "hold") {
      return this.status();
    }

    const page = await this.ensurePage();
    await page.bringToFront();
    await this.waitForMaps(page);
    const viewport = await viewportSize(page);

    if (action.type === "pan") {
      await dragStreetView(page, viewport, action.headingDelta, action.pitchDelta ?? 0);
      this.state = {
        ...this.state,
        heading: normalizeHeading(this.state.heading + action.headingDelta),
        pitch: clamp(this.state.pitch + (action.pitchDelta ?? 0), -90, 90)
      };
    } else if (action.type === "zoom") {
      await wheelZoom(page, viewport, action.zoomDelta);
      this.state = {
        ...this.state,
        zoom: clamp(this.state.zoom + action.zoomDelta, 0, 4)
      };
    } else if (action.type === "move") {
      await clickMoveTarget(page, viewport, action.linkIndex);
    } else if (action.type === "inspect") {
      await inspectTarget(page, viewport, this.state, action);
    }

    await page.waitForTimeout(MAPS_SETTLE_MS);
    this.state = await this.readState(page);
    return this.status();
  }

  private async ensurePage(url = this.options.startUrl): Promise<Page> {
    const existing = this.livePage();
    if (existing) {
      return existing;
    }

    const userDataDir = path.join(this.options.rootDir, ".active-perception", "google-maps-profile");
    await fs.mkdir(userDataDir, { recursive: true });

    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: DEFAULT_VIEWPORT,
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
      timeout: STARTUP_TIMEOUT_MS
    });
    this.context.on("close", () => {
      this.context = undefined;
      this.page = undefined;
    });

    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.page.setDefaultTimeout(STARTUP_TIMEOUT_MS);
    this.page.on("close", () => {
      this.page = undefined;
    });

    if (!this.page.url() || this.page.url() === "about:blank") {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: STARTUP_TIMEOUT_MS });
    }
    return this.page;
  }

  private livePage(): Page | undefined {
    if (!this.page || this.page.isClosed()) {
      return undefined;
    }
    return this.page;
  }

  private async waitForMaps(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded", { timeout: STARTUP_TIMEOUT_MS }).catch(() => undefined);
    await page.waitForTimeout(MAPS_SETTLE_MS);
  }

  private async readState(page: Page): Promise<StreetViewState> {
    const viewport = await viewportSize(page);
    const parsed = parseGoogleMapsView(page.url());
    return buildStreetViewState(this.sessionId, viewport, {
      heading: parsed.heading ?? this.state.heading,
      pitch: parsed.pitch ?? this.state.pitch,
      zoom: parsed.zoom ?? this.state.zoom
    });
  }
}

function buildStreetViewState(
  sessionId: string,
  viewport: ViewportSize,
  override: Partial<Pick<StreetViewState, "heading" | "pitch" | "zoom">> = {}
): StreetViewState {
  return {
    source: "google_maps",
    sessionId,
    heading: override.heading ?? 0,
    pitch: override.pitch ?? 0,
    zoom: override.zoom ?? 1,
    moves: moveTargets(viewport)
  };
}

function moveTargets(viewport: ViewportSize): StreetViewMoveTarget[] {
  const wideEnough = viewport.width >= 700;
  const targets: Array<Omit<StreetViewMoveTarget, "index">> = [
    {
      screenX: 0.5,
      screenY: 0.66,
      description: "center lower screen; usually the forward Street View arrow"
    },
    {
      screenX: wideEnough ? 0.38 : 0.35,
      screenY: 0.66,
      description: "lower left navigation target"
    },
    {
      screenX: wideEnough ? 0.62 : 0.65,
      screenY: 0.66,
      description: "lower right navigation target"
    },
    {
      screenX: 0.5,
      screenY: 0.52,
      description: "center screen navigation target"
    }
  ];
  return targets.map((target, index) => ({ ...target, index }));
}

async function viewportSize(page: Page): Promise<ViewportSize> {
  const viewport = page.viewportSize();
  if (viewport) {
    return viewport;
  }
  return await page.evaluate(() => ({
    width: window.innerWidth || 1280,
    height: window.innerHeight || 720
  }));
}

function parseGoogleMapsView(url: string): Partial<Pick<StreetViewState, "heading" | "pitch" | "zoom">> {
  const result: Partial<Pick<StreetViewState, "heading" | "pitch" | "zoom">> = {};
  const headingMatch = url.match(/,(-?\d+(?:\.\d+)?)h(?:,|\/|\?|$)/);
  const tiltMatch = url.match(/,(-?\d+(?:\.\d+)?)t(?:,|\/|\?|$)/);
  const fovMatch = url.match(/,(-?\d+(?:\.\d+)?)y(?:,|\/|\?|$)/);

  if (headingMatch) {
    result.heading = normalizeHeading(Number(headingMatch[1]));
  }
  if (tiltMatch) {
    result.pitch = clamp(90 - Number(tiltMatch[1]), -90, 90);
  }
  if (fovMatch) {
    result.zoom = fovToZoom(Number(fovMatch[1]));
  }

  try {
    const parsed = new URL(url);
    const heading = parsed.searchParams.get("heading");
    const pitch = parsed.searchParams.get("pitch");
    const fov = parsed.searchParams.get("fov");
    if (heading !== null) {
      result.heading = normalizeHeading(Number(heading));
    }
    if (pitch !== null) {
      result.pitch = clamp(Number(pitch), -90, 90);
    }
    if (fov !== null) {
      result.zoom = fovToZoom(Number(fov));
    }
  } catch {
    return result;
  }

  return result;
}

function isStreetViewUrl(url: string): boolean {
  return /\/maps\/@[^?]*,3a(?:,|\/|\?|$)/.test(url)
    || url.includes("!1e1")
    || url.includes("map_action=pano");
}

function fovToZoom(fov: number): number {
  if (!Number.isFinite(fov)) {
    return 1;
  }
  return clamp((100 - fov) / 20, 0, 4);
}

async function dragStreetView(page: Page, viewport: ViewportSize, headingDelta: number, pitchDelta: number): Promise<void> {
  const center = safeCenter(viewport);
  const dx = clamp(-headingDelta * 5, -520, 520);
  const dy = clamp(pitchDelta * 5, -300, 300);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + dx, center.y + dy, { steps: 12 });
  await page.waitForTimeout(MIN_ACTION_SETTLE_MS);
  await page.mouse.up();
}

async function wheelZoom(page: Page, viewport: ViewportSize, zoomDelta: number): Promise<void> {
  const center = safeCenter(viewport);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, clamp(-zoomDelta * 650, -1800, 1800));
  await page.waitForTimeout(MIN_ACTION_SETTLE_MS);
}

async function clickMoveTarget(page: Page, viewport: ViewportSize, linkIndex: number): Promise<void> {
  const target = moveTargets(viewport)[linkIndex] ?? moveTargets(viewport)[0];
  const beforeKey = physicalStreetViewUrlKey(page.url());
  for (const point of moveClickCandidates(target, viewport)) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(MAPS_SETTLE_MS);
    if (physicalStreetViewUrlKey(page.url()) !== beforeKey) {
      return;
    }
  }
}

async function inspectTarget(
  page: Page,
  viewport: ViewportSize,
  state: StreetViewState,
  action: Extract<StreetViewAction, { type: "inspect" }>
): Promise<void> {
  if (typeof action.heading === "number" || typeof action.pitch === "number") {
    const headingDelta = typeof action.heading === "number" ? shortestHeadingDelta(state.heading, action.heading) : 0;
    const pitchDelta = typeof action.pitch === "number" ? action.pitch - state.pitch : 0;
    await dragStreetView(page, viewport, headingDelta, pitchDelta);
  }
  if (typeof action.zoom === "number") {
    await wheelZoom(page, viewport, action.zoom - state.zoom);
  }
}

function safeCenter(viewport: ViewportSize): { x: number; y: number } {
  return {
    x: clamp(Math.max(440, viewport.width * 0.52), 16, viewport.width - 16),
    y: viewport.height * 0.52
  };
}

function moveClickCandidates(target: StreetViewMoveTarget, viewport: ViewportSize): Array<{ x: number; y: number }> {
  const baseX = target.screenX * viewport.width;
  const baseY = target.screenY * viewport.height;
  const offsets = [
    { x: 0, y: 0 },
    { x: 0, y: -viewport.height * 0.08 },
    { x: 0, y: viewport.height * 0.08 },
    { x: -viewport.width * 0.04, y: 0 },
    { x: viewport.width * 0.04, y: 0 }
  ];
  return offsets.map((offset) => ({
    x: clamp(baseX + offset.x, 16, viewport.width - 16),
    y: clamp(baseY + offset.y, 16, viewport.height - 16)
  }));
}

function physicalStreetViewUrlKey(url: string): string {
  return url
    .replace(/,-?\d+(?:\.\d+)?h(?=,|\/|\?|$)/g, ",Hh")
    .replace(/,-?\d+(?:\.\d+)?t(?=,|\/|\?|$)/g, ",Tt")
    .replace(/,-?\d+(?:\.\d+)?y(?=,|\/|\?|$)/g, ",Yy")
    .replace(/([?&])(heading|pitch|fov)=[^&]*/g, "$1");
}

function hudMaskRects(viewport: ViewportSize) {
  const leftWidth = Math.min(430, viewport.width);
  const bottomHeight = Math.min(58, viewport.height);
  return [
    { x: 0, y: 0, width: leftWidth, height: Math.min(220, viewport.height) },
    { x: 0, y: Math.max(0, viewport.height - 175), width: Math.min(340, viewport.width), height: Math.min(175, viewport.height) },
    { x: 0, y: Math.max(0, viewport.height - bottomHeight), width: viewport.width, height: bottomHeight },
    {
      x: Math.max(0, viewport.width - 94),
      y: Math.max(0, viewport.height - 320),
      width: 94,
      height: Math.min(320, viewport.height)
    },
    { x: Math.max(0, viewport.width - 240), y: 0, width: 240, height: Math.min(74, viewport.height) }
  ];
}

async function addHudMasks(page: Page, rects: Array<{ x: number; y: number; width: number; height: number }>): Promise<void> {
  await page.evaluate((masks) => {
    document.getElementById("active-geo-map-censor")?.remove();
    const root = document.createElement("div");
    root.id = "active-geo-map-censor";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "pointer-events:none",
      "z-index:2147483647"
    ].join(";");

    for (const mask of masks) {
      const node = document.createElement("div");
      node.style.cssText = [
        "position:absolute",
        `left:${mask.x}px`,
        `top:${mask.y}px`,
        `width:${mask.width}px`,
        `height:${mask.height}px`,
        "background:#000"
      ].join(";");
      root.appendChild(node);
    }
    document.documentElement.appendChild(root);
  }, rects);
  await page.waitForTimeout(80);
}

async function removeHudMasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("active-geo-map-censor")?.remove();
  }).catch(() => undefined);
}

function shortestHeadingDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
