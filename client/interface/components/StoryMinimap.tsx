import { useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { hierarchy } from "d3-hierarchy";
import { flextree } from "d3-flextree";
import type { StoryNode } from "../types";
import { originDetail } from "../utils/originDisplay";

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
const Minibuffer = ({ text, node }: { text: string; node?: StoryNode | null }) => {
  // Authorship follows the cursor: the node you're standing on says whose it is,
  // in the line that already narrates it. No mark painted across the tree — you
  // learn who wrote a node the same way you learn everything here, by moving onto
  // it. Quiet muted tag; the full actor · via · model lives in the title.
  const who =
    node == null
      ? null
      : node.origin === "model"
        ? "model"
        : node.origin === "human"
          ? "you"
          : "unknown";
  return (
    <div
      className="minimap-minibuffer"
      title={node ? originDetail(node) : undefined}
    >
      <div className="minimap-minibuffer-text">
        {who && <span className="minimap-minibuffer-who">{who} · </span>}
        {text || "Navigate with arrow keys • A to generate • B to edit"}
      </div>
    </div>
  );
};

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
}: StoryMinimapProps) => {
  const { root } = tree;
  const coords = useCoords(root);
  const edges = useEdges(root);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastHighlightedNodeRef = useRef<string | null>(null);

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

  // Determine selected sibling (next depth)
  const selectedSibling = (() => {
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
  const svgWidth = isSingleNode
    ? SINGLE_NODE_SVG_WIDTH
    : Math.max(600, maxX - minX + padding * 2); // Ensure minimum width
  const svgHeight = isSingleNode
    ? SINGLE_NODE_SVG_HEIGHT
    : Math.max(maxY + MAX_NODE_HEIGHT, ROW_HEIGHT * 4);

  // Center the tree horizontally - offset all x coords so tree is centered
  const centerX = svgWidth / 2;
  const treeCenter = (minX + maxX) / 2;
  const rootOffset = centerX - treeCenter;

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
    if (
      !viewportRef.current ||
      !highlightedNode ||
      !coords[highlightedNode.id]
    ) {
      return;
    }

    const viewport = viewportRef.current;
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
  ]);

  return (
    <div className="minimap-container view-fade">
      <div
        ref={viewportRef}
        className={`minimap-viewport ${isSingleNode ? "single-node" : ""}`}
      >
        <div
          className={isSingleNode ? "minimap-single-node-canvas" : undefined}
          style={{ width: svgWidth, minWidth: "100%" }}
        >
          <svg width={svgWidth} height={svgHeight}>
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
            {isSingleNode ? (
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

              const ax = a.x + rootOffset;
              const bx = b.x + rootOffset;

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
              const isSelected = selectedSibling && id === selectedSibling.id;
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
                    x={c.x + rootOffset - NODE_WIDTH / 2}
                    y={isSingleNode ? SINGLE_NODE_Y : c.y}
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
          isSingleNode
            ? "A to branch from here"
            : selectedSibling
            ? selectedSibling.text.split("\n")[0]
            : highlightedNode.text.split("\n")[0]
        }
        node={isSingleNode ? null : (selectedSibling ?? highlightedNode)}
      />
    </div>
  );
};
