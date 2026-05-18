import { forwardRef, useEffect, useImperativeHandle, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

export interface PanoramaView {
  heading: number;
  pitch: number;
  zoom: number;
}

export interface PanoramaViewerHandle {
  captureJpeg: () => Promise<string>;
}

interface PanoramaViewerProps {
  imageUrl: string;
  view: PanoramaView;
  onReadyChange?: (ready: boolean) => void;
}

const MAX_PIXEL_RATIO = 1.5;
const JPEG_QUALITY = 0.88;

export const PanoramaViewer = forwardRef<PanoramaViewerHandle, PanoramaViewerProps>(
  function PanoramaViewer({ imageUrl, view, onReadyChange }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);
    const textureRef = useRef<THREE.Texture | null>(null);
    const viewRef = useRef(view);
    const readyRef = useRef(false);

    useImperativeHandle(ref, () => ({
      captureJpeg: async () => {
        const renderer = rendererRef.current;
        if (!renderer || !readyRef.current) {
          throw new Error("Panorama viewer is not ready.");
        }
        renderScene(rendererRef, sceneRef, cameraRef, viewRef.current);
        return canvasToDataUrl(renderer.domElement);
      }
    }), []);

    useEffect(() => {
      viewRef.current = view;
      renderScene(rendererRef, sceneRef, cameraRef, view);
    }, [view]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true
      });
      renderer.setClearColor(0x111111);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      renderer.domElement.className = "panoramaCanvas";
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      camera.position.set(0, 0, 0);

      const geometry = new THREE.SphereGeometry(500, 96, 48);
      geometry.scale(-1, 1, 1);
      const material = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const sphere = new THREE.Mesh(geometry, material);
      scene.add(sphere);

      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      materialRef.current = material;

      const resize = () => {
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
        renderer.setSize(width, height, false);
        renderScene(rendererRef, sceneRef, cameraRef, viewRef.current);
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();

      return () => {
        resizeObserver.disconnect();
        textureRef.current?.dispose();
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        rendererRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
        materialRef.current = null;
        textureRef.current = null;
      };
    }, []);

    useEffect(() => {
      const material = materialRef.current;
      if (!material) {
        return;
      }

      readyRef.current = false;
      onReadyChange?.(false);
      const loader = new THREE.TextureLoader();
      let cancelled = false;
      loader.load(
        imageUrl,
        (texture) => {
          if (cancelled) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          textureRef.current?.dispose();
          textureRef.current = texture;
          material.map = texture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
          readyRef.current = true;
          onReadyChange?.(true);
          renderScene(rendererRef, sceneRef, cameraRef, viewRef.current);
        },
        undefined,
        () => {
          if (!cancelled) {
            readyRef.current = false;
            onReadyChange?.(false);
          }
        }
      );

      return () => {
        cancelled = true;
      };
    }, [imageUrl, onReadyChange]);

    return <div ref={containerRef} className="panoramaViewer" />;
  }
);

function renderScene(
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>,
  sceneRef: MutableRefObject<THREE.Scene | null>,
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>,
  view: PanoramaView
): void {
  const renderer = rendererRef.current;
  const scene = sceneRef.current;
  const camera = cameraRef.current;
  if (!renderer || !scene || !camera) {
    return;
  }

  const size = renderer.getSize(new THREE.Vector2());
  const aspect = Math.max(0.01, size.x / Math.max(1, size.y));
  camera.aspect = aspect;
  camera.fov = horizontalFovToVerticalFov(zoomToFov(view.zoom), aspect);
  camera.updateProjectionMatrix();

  const heading = THREE.MathUtils.degToRad(view.heading);
  const pitch = THREE.MathUtils.degToRad(view.pitch);
  const target = new THREE.Vector3(
    Math.sin(heading) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(heading) * Math.cos(pitch)
  );
  camera.lookAt(target);
  renderer.render(scene, camera);
}

function zoomToFov(zoom: number): number {
  const fov = 100 - zoom * 19.5;
  return Math.max(18, Math.min(110, fov));
}

function horizontalFovToVerticalFov(horizontalFovDeg: number, aspect: number): number {
  const horizontal = THREE.MathUtils.degToRad(horizontalFovDeg);
  const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / aspect);
  return THREE.MathUtils.radToDeg(vertical);
}

function canvasToDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not capture panorama canvas."));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not encode panorama snapshot."));
        reader.readAsDataURL(blob);
      }, "image/jpeg", JPEG_QUALITY);
    } catch (error) {
      reject(error);
    }
  });
}
