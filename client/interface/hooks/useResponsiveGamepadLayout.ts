import { useEffect, useRef, useState } from "react";

export function useResponsiveGamepadLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"portrait" | "landscape">("portrait");

  useEffect(() => {
    const checkLayout = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const aspectRatio = clientWidth / clientHeight;
      setLayout(aspectRatio >= 1.33 ? "landscape" : "portrait");
    };

    const resizeObserver = new ResizeObserver(checkLayout);
    const currentContainer = containerRef.current;

    if (currentContainer) {
      resizeObserver.observe(currentContainer);
      checkLayout();
    }

    return () => {
      if (currentContainer) {
        resizeObserver.unobserve(currentContainer);
      }
    };
  }, []);

  return { containerRef, layout };
}
