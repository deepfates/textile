import { useEffect, useRef, useState } from "react";

export type GamepadLayout = "portrait" | "landscape";
export type PortraitPhoneHeight = "compact" | "regular" | "tall";

export function getResponsiveGamepadLayout(
  width: number,
  height: number,
): {
  layout: GamepadLayout;
  portraitPhoneHeight: PortraitPhoneHeight | null;
} {
  const aspectRatio = width / height;
  const layout = aspectRatio >= 1.33 ? "landscape" : "portrait";
  const isPhonePortrait = layout === "portrait" && width <= 480;

  if (!isPhonePortrait) {
    return { layout, portraitPhoneHeight: null };
  }

  if (height < 760) {
    return { layout, portraitPhoneHeight: "compact" };
  }

  if (height < 840) {
    return { layout, portraitPhoneHeight: "regular" };
  }

  return { layout, portraitPhoneHeight: "tall" };
}

export function useResponsiveGamepadLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [responsiveLayout, setResponsiveLayout] = useState<{
    layout: GamepadLayout;
    portraitPhoneHeight: PortraitPhoneHeight | null;
  }>({ layout: "portrait", portraitPhoneHeight: null });

  useEffect(() => {
    const checkLayout = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      setResponsiveLayout(getResponsiveGamepadLayout(clientWidth, clientHeight));
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

  return { containerRef, ...responsiveLayout };
}
