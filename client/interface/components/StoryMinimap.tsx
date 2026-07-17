import { useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
import { hierarchy } from "d3-hierarchy";
import { flextree } from "d3-flextree";
import type { StoryNode } from "../types";

type LayoutStoryNode = {
  data: StoryNode;
  x?: number;
  y?: number;
  depth?: number;
  children?: LayoutStoryNode[];
};

/**
 * VISUAL DESIGN:
 * The minimap uses a gameboy/e-paper aesthetic with nodes as vertical "pages" of varying heights.
 * - Node height represents text length (taller = more text)
 * - Nodes are compact rectangles with crisp borders, like pages or circuit components
 * - Uses theme colors (--font-color, --primary-color) for intuitive connection with text view
 * - Visual hierarchy: Current node (solid) > Selected (primary) > Ancestors (diagonal pattern) > Path (dots) > Others (faint)
 * - Connectors are simple "wires" with squircle-style branches (strong shoulders, then straight down)
 * - Layout uses d3-flextree for variable node heights while preventing path crossings
 */
interface StoryMinimapProps {
  /**
   * The root of the story tree to render.
   */
  tree: { root: StoryNode };
  /**
   * Current depth in the main reader.
   */
  currentDepth: number;
  /**
   * Selected options at each depth.
   */
  selectedOptions: number[];
  /**
   * Set of node IDs currently generating.
   */
  inFlight: Set<string>;
  /**
   * Generation metadata (unused but kept for future features).
   */
  generatingInfo: { [nodeId: string]: { depth: number; index: number | null } };
  /**
   * Current path through the tree following favorite children.
   */
  currentPath: StoryNode[];
  /**
   * Callback when user clicks a node (optional, for future use).
   */
  onSelectNode?: (path: StoryNode[]) => void;
  /**
   * Whether the minimap is currently visible.
   */
  isVisible?: boolean;
  /**
   * The ID of the node that was highlighted when map was last opened.
   */
  lastMapNodeId: string | null;
  /**
   * The ID of the currently highlighted node.
   */
  currentNodeId: string;
  /**
   * Camera mode. Default (undefined) = the map's fly-over: an oversized,
   * scrollable canvas that chases the reader's cursor. "floor" = a specimen
   * camera: the WHOLE tree fitted into the container via a viewBox symmetric
   * about the root's x, so the root is pinned at the horizontal centre and the
   * silhouette is always fully visible (no scroll, no clip). Node/edge rendering
   * is identical in both modes — only the framing changes.
   */
  fit?: "floor";
  /**
   * Set to "descend" only when the map is entered by dropping in from the floor.
   * It opens the fly-over camera IN THE FLOOR'S FRAME — root pinned to the
   * horizontal centre (giving the chase-camera the slack to actually centre the
   * root, which it normally can't), no open fade, and the selected sibling
   * paints in a beat late ("the map wakes up") instead of popping. So the
   * floor→story handoff shows the same frame on both sides. Undefined (the
   * standalone map, opened with START) = byte-identical fly-over as before.
   */
  entry?: "descend";
}

/**
 * Size constants – tweak for aesthetics.
 */
const LANE_WIDTH = 30;
const ROW_HEIGHT = 40;
// Node heights adapt to the amount of text so the minimap
// conveys relative length at a glance.
const MIN_NODE_HEIGHT = 15;
const MAX_NODE_HEIGHT = 60;
// Exponent used to scale text length into a height signal. Values below 1
// keep very long passages from blowing up the layout while staying closer to a
// linear relationship than a logarithm.
const LENGTH_EXPONENT = 0.75;
const CONNECTOR_LENGTH = 12; // Fixed short connector between nodes
const NODE_WIDTH = 14; // Width of the pill-shaped nodes - compact
const NODE_RADIUS = 2; // Border radius for the pill shape - crisp corners
const SINGLE_NODE_SVG_WIDTH = 240;
const SINGLE_NODE_SVG_HEIGHT = 260;
const SINGLE_NODE_Y = 72;

/**
 * Tidy tree layout using d3-hierarchy - no overlaps, optimal spacing
 */
function useCoords(root: StoryNode) {
  return useMemo(() => {
    const coords: Record<
      string,
      {
        x: number;
        y: number;
        lane: number;
        depth: number;
        path: StoryNode[];
        length: number;
        nodeHeight: number;
      }
    > = {};

    // Handle empty tree
    if (!root) return coords;

    // Create hierarchy from StoryNode tree
    const rootHierarchy = hierarchy(root, (d) => d.continuations);

    // Calculate connector lengths based on text
    const descendants = rootHierarchy.descendants();
    // Cache scaled lengths to avoid redundant calculations
    const scaledLengthMap: Record<string, number> = {};
    descendants.forEach((node) => {
      scaledLengthMap[node.data.id] = Math.pow(
        (node.data.text || "").length + 1,
        LENGTH_EXPONENT,
      );
    });
    const scaledLengths = Object.values(scaledLengthMap);
    const minScaledLength =
      scaledLengths.length === 0 ? 0 : Math.min(...scaledLengths);
    const maxScaledLength =
      scaledLengths.length === 0 ? 0 : Math.max(...scaledLengths);
    const scaledRange = maxScaledLength - minScaledLength || 1;

    const getNodeHeight = (textLength: number) => {
      const scaledLength = Math.pow(textLength + 1, LENGTH_EXPONENT);
      const normalized =
        maxScaledLength === minScaledLength
          ? 0.5
          : (scaledLength - minScaledLength) / scaledRange;

      return (
        MIN_NODE_HEIGHT +
        normalized * (MAX_NODE_HEIGHT - MIN_NODE_HEIGHT)
      );
    };

    // Apply flextree layout with variable node sizes
    const treeLayout = flextree<StoryNode>({
      spacing: (a, b) => {
        // Tighter spacing for compact layout
        return a.parent === b.parent ? NODE_WIDTH * 1.2 : NODE_WIDTH * 0.8;
      },
      nodeSize: (node) => {
        const textLength = (node.data.text || "").length;
        const nodeHeight = getNodeHeight(textLength);
        // Total height is node height plus connector to next level
        return [NODE_WIDTH, nodeHeight + CONNECTOR_LENGTH];
      }
    });

    const rootPoint = treeLayout(rootHierarchy);
    // Build coords from flextree's calculated positions
    const buildPath = (node: LayoutStoryNode, path: StoryNode[] = []): StoryNode[] => {
      const currentPath = [...path, node.data];
      const textLength = (node.data.text || "").length;
      const nodeHeight = getNodeHeight(textLength);

      coords[node.data.id] = {
        x: node.x || 0,
        y: node.y || 0,  // Use flextree's calculated Y position
        lane: Math.round((node.x || 0) / LANE_WIDTH),
        depth: node.depth || 0,
        path: currentPath,
        length: textLength,
        nodeHeight,
      };

      // Recursively process children
      if (node.children) {

        node.children.forEach((child) =>
          buildPath(child, currentPath),
        );
      }

      return currentPath;
    };

    buildPath(rootPoint);

    return coords;
  }, [root]);
}

/**
 * Return a list of edges as pairs of {from, to, key}.
 */
function useEdges(root: StoryNode) {
  return useMemo(() => {
    const edges: { from: StoryNode; to: StoryNode; key: string }[] = [];
    const walk = (node: StoryNode) => {
      node.continuations?.forEach((child, idx) => {
        edges.push({ from: node, to: child, key: `${node.id}-${idx}` });
        walk(child);
      });
    };
    walk(root);
    return edges;
  }, [root]);
}

/**
 * Terminal-style minibuffer at bottom of map
 */
const Minibuffer = ({ text }: { text: string }) => (
  <div className="minimap-minibuffer">
    <div className="minimap-minibuffer-text">
      {text || "Navigate with arrow keys • A to generate • B to edit"}
    </div>
  </div>
);

/**
 * The actual component.
 */
export const StoryMinimap = ({
  tree,
  currentDepth,
  selectedOptions,
  currentPath,
  inFlight,
  generatingInfo,
  onSelectNode,
  isVisible,
  lastMapNodeId,
  currentNodeId,
  fit,
  entry,
}: StoryMinimapProps) => {
  const { root } = tree;
  const isFloor = fit === "floor";
  const isDescendEntry = entry === "descend" && !isFloor;
  // Widen the fly-over canvas to viewportW/2 of slack per side when entering from
  // the floor, so the root can actually be scrolled to the centre (the normal map
  // is only 600px wide, which clamps the root off-centre in a wider viewport).
  const [entryViewportW, setEntryViewportW] = useState(0);
  // The selected sibling paints one beat after a descend so the map "wakes up"
  // rather than popping a highlight in the handoff frame. Non-descend mounts
  // start settled (no flash).
  const [descendSettled, setDescendSettled] = useState(entry !== "descend");
  const coords = useCoords(root);
  const edges = useEdges(root);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastHighlightedNodeRef = useRef<string | null>(null);

  // Floor camera measures its container so the whole tree can be fitted at
  // scale ≤ 1 (shrink to fit, never magnify). Only used when isFloor.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!isFloor || !viewportRef.current) return;
    const el = viewportRef.current;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFloor]);

  // Measure the viewport width for the descend-entry canvas padding, before paint
  // (layout-effect setState flushes pre-paint, so no first-frame flash).
  useLayoutEffect(() => {
    if (!isDescendEntry || !viewportRef.current) return;
    setEntryViewportW(viewportRef.current.clientWidth);
  }, [isDescendEntry]);

  // On a fresh descend, hold the selected-sibling highlight back a beat.
  useEffect(() => {
    if (!isDescendEntry) {
      setDescendSettled(true);
      return;
    }
    setDescendSettled(false);
    const t = window.setTimeout(() => setDescendSettled(true), 150);
    return () => window.clearTimeout(t);
  }, [isDescendEntry]);

  // Determine node that matches current reader position for highlight
  const highlightedNode = (() => {
    let node = root;
    for (let depth = 0; depth < currentDepth; depth++) {
      const idx = selectedOptions[depth];
      const child = node.continuations?.[idx];
      if (!child) break;
      node = child;
    }
    return node;
  })();

  // Determine selected sibling (next depth). On the floor there is no
  // within-tree selection — the bloom is a specimen, not a live reader — so no
  // child is painted "selected" (fixes the old lie that always greened child 0).
  const selectedSibling = (() => {
    if (isFloor) return null;
    if (!highlightedNode.continuations?.length) return null;
    const idx = selectedOptions[currentDepth] ?? 0;
    return (
      highlightedNode.continuations[idx] || highlightedNode.continuations[0]
    );
  })();

  // Handle empty tree by rendering an empty viewport; dimensions below are guarded

  // Bounds for <svg> viewBox - ensure it's wide enough for scrolling
  const coordValues = Object.values(coords);
  const isSingleNode = coordValues.length === 1 && edges.length === 0;
  const xCoords = coordValues.map((c) => c.x);
  const minX = Math.min(...xCoords);
  const maxX = Math.max(...xCoords);
  const maxY = Math.max(...coordValues.map((c) => c.y));
  const singleNodeHeight = coordValues[0]?.nodeHeight ?? MAX_NODE_HEIGHT;


  // Add padding around the tree
  const padding = LANE_WIDTH * 2;
  // Descend-entry widens the canvas so there's slack to scroll the root to the
  // viewport centre (the normal 600px canvas clamps it off-centre).
  const entryPad = isDescendEntry
    ? Math.max(padding, entryViewportW / 2)
    : padding;
  const svgWidth = isSingleNode
    ? SINGLE_NODE_SVG_WIDTH
    : Math.max(600, maxX - minX + entryPad * 2); // Ensure minimum width
  const svgHeight = isSingleNode
    ? SINGLE_NODE_SVG_HEIGHT
    : Math.max(maxY + MAX_NODE_HEIGHT, ROW_HEIGHT * 4);

  // Center the tree horizontally - offset all x coords so tree is centered
  const centerX = svgWidth / 2;
  const treeCenter = (minX + maxX) / 2;
  const rootOffset = centerX - treeCenter;

  // FLOOR CAMERA: frame the whole tree in a viewBox symmetric about the ROOT's
  // x, so the root lands at the horizontal centre for every tree by arithmetic
  // (not by scroll-chasing). Height pins the root near the top. The viewBox is
  // grown to at least the container size so a small tree renders at scale 1
  // (never magnified) while a big one shrinks to fit — and its aspect matches
  // the container, so the tree fills width without letterboxing. In floor mode
  // nodes render at their raw x (no rootOffset).
  const effectiveRootOffset = isFloor ? 0 : rootOffset;
  let floorViewBox: string | undefined;
  if (isFloor) {
    const rootX = coords[root.id]?.x ?? 0;
    // Small top pad so the bloom's root hangs just under the dial's centred pill
    // (reads as "blooms beneath it"); generous side pad keeps wide trees off the
    // edges.
    const topPad = 14;
    const halfW = Math.max(rootX - minX, maxX - rootX) + padding;
    const treeW = Math.max(2 * halfW, 1);
    const treeH = Math.max(maxY + MAX_NODE_HEIGHT + topPad * 2, 1);
    const cw = box?.w ?? treeW;
    const ch = box?.h ?? treeH;
    const scale = Math.min(1, cw / treeW, ch / treeH);
    const vbW = cw / scale;
    const vbH = ch / scale;
    floorViewBox = `${rootX - vbW / 2} ${-topPad} ${vbW} ${vbH}`;
  }

  // Track initial positioning so opening the map doesn't animate
  const hasPositionedRef = useRef(false);
  // Reset hasPositionedRef when map becomes invisible
  useEffect(() => {
    if (!isVisible) {
      hasPositionedRef.current = false;
    }
  }, [isVisible]);

  // Position viewport to keep highlighted/selected in view
  // Use layout effect so the map appears already positioned on open
  useLayoutEffect(() => {
    // The floor camera has no scrollable canvas — the viewBox does the framing.
    if (isFloor) return;
    if (
      !viewportRef.current ||
      !highlightedNode ||
      !coords[highlightedNode.id]
    ) {
      return;
    }

    const viewport = viewportRef.current;

    // Descend-entry: open in the FLOOR'S frame — the root scrolled to the
    // horizontal centre (where the dial pill was), tree top at the top. Skip the
    // cursor-chasing dance so the handoff frame matches the floor exactly. Wait
    // for the viewport width to be measured (which widens the canvas) before
    // positioning, else we'd centre against the un-widened 600px canvas and clamp.
    if (isDescendEntry && !hasPositionedRef.current) {
      if (entryViewportW === 0) return;
      hasPositionedRef.current = true;
      const rootCanvasX = (coords[root.id]?.x ?? 0) + rootOffset;
      viewport.scrollLeft = Math.max(0, rootCanvasX - viewport.clientWidth / 2);
      viewport.scrollTop = 0;
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();

    // A function to calculate the ideal scroll position to center a node (and its sibling)
    const getTargetScrollPosition = (
      node: StoryNode,
      sibling: StoryNode | null,
    ) => {
      const nodeCoord = coords[node.id];
      const nodeX = nodeCoord.x + rootOffset;
      const nodeY = isSingleNode ? SINGLE_NODE_Y : nodeCoord.y;

      let minX = nodeX,
        maxX = nodeX,
        minY = nodeY,
        maxY = nodeY;

      if (sibling && coords[sibling.id]) {
        const siblingCoord = coords[sibling.id];
        const siblingX = siblingCoord.x + rootOffset;
        const siblingY = siblingCoord.y;
        minX = Math.min(minX, siblingX);
        maxX = Math.max(maxX, siblingX);
        minY = Math.min(minY, siblingY);
        maxY = Math.max(maxY, siblingY);
      }

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const targetLeft = centerX - viewportRect.width / 2;
      const targetTop = centerY - viewportRect.height / 2;

      return {
        left: Math.max(0, targetLeft),
        top: Math.max(0, targetTop),
      };
    };

    const isFirstPositioning = !hasPositionedRef.current;
    const nodeChangedSinceLastOpen =
      lastMapNodeId !== null && lastMapNodeId !== highlightedNode.id;

    // Calculate where we want to scroll TO
    const newTarget = getTargetScrollPosition(highlightedNode, selectedSibling);

    if (isFirstPositioning) {
      hasPositionedRef.current = true; // Mark as positioned

      if (nodeChangedSinceLastOpen && lastMapNodeId && coords[lastMapNodeId]) {
        // This is the key: we just opened the map after navigating.
        // We need to animate from the LAST position to the NEW one.
        const lastNode = coords[lastMapNodeId].path.slice(-1)[0];

        if (lastNode) {
          // 1. Calculate the scroll position of the OLD node.
          const oldTarget = getTargetScrollPosition(lastNode, null);

          // 2. JUMP to the old position instantly. The user won't see this frame.
          viewport.scrollLeft = oldTarget.left;
          viewport.scrollTop = oldTarget.top;

          // 3. In the NEXT frame, smoothly scroll to the new position.
          requestAnimationFrame(() => {
            viewport.scrollTo({
              left: newTarget.left,
              top: newTarget.top,
              behavior: "smooth",
            });
          });
        } else {
          // Fallback: last node not found, just jump to new position.
          viewport.scrollLeft = newTarget.left;
          viewport.scrollTop = newTarget.top;
        }
      } else {
        // It's the first time, but the node hasn't changed, or there's no history.
        // Just jump to the correct position without animation.
        viewport.scrollLeft = newTarget.left;
        viewport.scrollTop = newTarget.top;
      }
    } else {
      // The map is already open, so any change should be smooth.
      // This handles navigation within the map itself (if that feature is added)
      // or other reactive changes.
      if (
        viewport.scrollLeft !== newTarget.left ||
        viewport.scrollTop !== newTarget.top
      ) {
        viewport.scrollTo({
          left: newTarget.left,
          top: newTarget.top,
          behavior: "smooth",
        });
      }
    }
  }, [
    highlightedNode.id,
    selectedSibling?.id,
    coords,
    rootOffset,
    isSingleNode,
    isVisible,
    lastMapNodeId,
    isFloor,
    isDescendEntry,
    entryViewportW,
    root.id,
  ]);

  return (
    <div
      className={`minimap-container ${isDescendEntry ? "descend-entry" : "view-fade"}`}
    >
      <div
        ref={viewportRef}
        className={`minimap-viewport ${
          isSingleNode && !isFloor ? "single-node" : ""
        } ${isFloor ? "floor" : ""}`}
      >
        <div
          className={
            isSingleNode && !isFloor ? "minimap-single-node-canvas" : undefined
          }
          style={
            isFloor
              ? { width: "100%", height: "100%" }
              : { width: svgWidth, minWidth: "100%" }
          }
        >
          <svg
            {...(isFloor
              ? {
                  width: "100%",
                  height: "100%",
                  viewBox: floorViewBox,
                  preserveAspectRatio: "xMidYMid meet",
                  style: { display: "block" as const },
                }
              : { width: svgWidth, height: svgHeight })}
          >
            {/* Define patterns for different node states */}
            <defs>
              {/* Subtle stripe pattern for ancestors - they've been read */}
              <pattern id="ancestorPattern" patternUnits="userSpaceOnUse" width="4" height="4">
                <rect width="4" height="4" fill="var(--surface-color)" />
                <line x1="0" y1="0" x2="0" y2="4" stroke="var(--border-color)" strokeWidth="0.5" opacity="0.3"/>
                <line x1="2" y1="0" x2="2" y2="4" stroke="var(--border-color)" strokeWidth="0.5" opacity="0.3"/>
              </pattern>
              {/* Dots for favorite path - breadcrumb trail */}
              <pattern id="pathPattern" patternUnits="userSpaceOnUse" width="4" height="4">
                <rect width="4" height="4" fill="var(--surface-color)" />
                <circle cx="2" cy="2" r="0.4" fill="var(--secondary-color)"/>
              </pattern>
            </defs>
            {isSingleNode && !isFloor ? (
              <g className="minimap-single-node-affordance" aria-hidden="true">
                <path
                  d={`M${centerX},${SINGLE_NODE_Y + singleNodeHeight - NODE_RADIUS / 2} L${centerX},154`}
                  stroke="var(--border-color)"
                  strokeWidth={0.8}
                  strokeLinecap="square"
                  strokeDasharray="2 4"
                  fill="none"
                />
                {[-32, 0, 32].map((offset) => (
                  <g key={offset}>
                    <path
                      d={`M${centerX},154 Q${centerX},166 ${centerX + offset},166 L${centerX + offset},184`}
                      stroke="var(--border-color)"
                      strokeWidth={0.8}
                      strokeLinecap="square"
                      fill="none"
                    />
                    <rect
                      x={centerX + offset - NODE_WIDTH / 2}
                      y={184}
                      width={NODE_WIDTH}
                      height={20}
                      rx={NODE_RADIUS}
                      ry={NODE_RADIUS}
                      fill="none"
                      stroke="var(--font-color)"
                      strokeWidth={0.8}
                    />
                  </g>
                ))}
              </g>
            ) : null}
            {/* Render edges first so they sit behind nodes */}
            {edges.map(({ from, to, key }) => {
              const a = coords[from.id];
              const b = coords[to.id];

              // Check if this edge is part of the ancestor path
              const isAncestorEdge = highlightedNode &&
                currentPath.some(node => node.id === from.id) &&
                currentPath.some(node => node.id === to.id);

              const ax = a.x + effectiveRootOffset;
              const bx = b.x + effectiveRootOffset;

              // Start connector at bottom edge of parent pill (accounting for border radius)
              const startY = a.y + a.nodeHeight - NODE_RADIUS/2;
              // End connector at top edge of child pill (accounting for border radius)
              const endY = b.y + NODE_RADIUS/2;

              let path;

              if (a.lane === b.lane) {
                // Straight line for same lane
                path = `M${ax},${startY} L${bx},${endY}`;
              } else {
                // Squircle-style branch: curve early then straight down
                const branchPoint = startY + 6; // Fork happens just below parent node
                const curveRadius = 4; // Radius of the rounded corner - tighter

                if (bx > ax) {
                  // Branching to the right
                  path = `M${ax},${startY} L${ax},${branchPoint - curveRadius} Q${ax},${branchPoint} ${ax + curveRadius},${branchPoint} L${bx - curveRadius},${branchPoint} Q${bx},${branchPoint} ${bx},${branchPoint + curveRadius} L${bx},${endY}`;
                } else {
                  // Branching to the left
                  path = `M${ax},${startY} L${ax},${branchPoint - curveRadius} Q${ax},${branchPoint} ${ax - curveRadius},${branchPoint} L${bx + curveRadius},${branchPoint} Q${bx},${branchPoint} ${bx},${branchPoint + curveRadius} L${bx},${endY}`;
                }
              }

              return (
                <path
                  key={key}
                  d={path}
                  stroke={isAncestorEdge ? "var(--secondary-color)" : "var(--border-color)"}
                  strokeWidth={isAncestorEdge ? 1.2 : 0.8}
                  fill="none"
                  strokeLinecap="square"
                  opacity={isAncestorEdge ? 0.8 : 0.4}
                />
              );
            })}

            {/* Nodes */}
            {Object.entries(coords).map(([id, c]) => {
              const node = c.path[c.path.length - 1];
              const isHighlighted = id === highlightedNode.id;
              const isSelected =
                descendSettled && selectedSibling && id === selectedSibling.id;
              const isGenerating = inFlight.has(id);
              const isOnFavoritePath = currentPath.some(
                (pathNode) => pathNode.id === id,
              );
              // Check if this node is an ancestor of the highlighted node
              const isAncestor = coords[highlightedNode.id] &&
                id !== highlightedNode.id &&
                coords[highlightedNode.id].path.some((pathNode: StoryNode) => pathNode.id === id);

              return (
                <g
                  key={id}
                  onClick={() => onSelectNode?.(c.path)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Draw node as an elongated pill/capsule shape */}
                  <rect
                    className={`minimap-node ${isGenerating ? "generating" : ""}`}
                    x={c.x + effectiveRootOffset - NODE_WIDTH / 2}
                    y={isSingleNode && !isFloor ? SINGLE_NODE_Y : c.y}
                    width={NODE_WIDTH}
                    height={c.nodeHeight}
                    rx={NODE_RADIUS}
                    ry={NODE_RADIUS}
                    fill={
                      isHighlighted
                        ? "var(--surface-color)"  // Current - white/bright text color in dark mode
                        : isSelected
                          ? "var(--primary-color)"  // Next option - blue/primary
                          : isGenerating
                              ? "var(--primary-color)"  // Generating - pulsing blue
                              : isAncestor || isOnFavoritePath
                                ? "var(--surface-color)"  // Already read or on breadcrumb trail
                                : "var(--background-color)"  // Unvisited - empty
                    }
                    stroke="var(--font-color)"
                    strokeWidth={
                      isHighlighted || isSelected ? 1.5 : 0.8
                    }
                    opacity={
                      isHighlighted
                        ? 1  // Current - full brightness
                        : isSelected
                          ? 0.9  // Next - prominent but not current
                        : isGenerating
                            ? 1  // Generating - full brightness with pulse animation
                            : isAncestor
                              ? 0.6 // Already read - visible but less prominent
                              : isOnFavoritePath
                                ? 0.5  // Path - semi-visible
                                : 0.4  // Unvisited - barely visible
                    }
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <Minibuffer
        text={
          isFloor
            ? highlightedNode.text.split("\n")[0]
            : isSingleNode
            ? "A to branch from here"
            : descendSettled && selectedSibling
            ? selectedSibling.text.split("\n")[0]
            : highlightedNode.text.split("\n")[0]
        }
      />
    </div>
  );
};
